import argparse
import collections
import hashlib
import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd
from huggingface_hub import hf_hub_download

from build_hiphop_stats import DEFAULT_OUTPUT_DIR, KO_RE, KO_STOPWORDS, TOKEN_RE, trim_counter, write_json


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = "juliensimon/autonlp-data-song-lyrics"
DEFAULT_MODEL = "google-translate"
DEFAULT_CACHE = ROOT_DIR / "scripts" / "cache" / "translated_hiphop_google_lines.jsonl"

EN_SECTION_RE = re.compile(r"\[[^\]]+\]|\([^)]+\)")
SENTENCE_SPLIT_RE = re.compile(r"(?:\n+|(?<=[.!?])\s+)")
LATIN_RE = re.compile(r"[A-Za-z]")


def clean_english_line(value):
    value = EN_SECTION_RE.sub(" ", str(value or ""))
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value


def split_lyric_to_lines(lyric, max_chars):
    lines = []
    for part in SENTENCE_SPLIT_RE.split(str(lyric or "")):
        line = clean_english_line(part)
        if len(line) < 4 or not LATIN_RE.search(line):
            continue
        if len(line) <= max_chars:
            lines.append(line)
            continue
        words = line.split()
        chunk = []
        chunk_len = 0
        for word in words:
            next_len = chunk_len + len(word) + (1 if chunk else 0)
            if chunk and next_len > max_chars:
                lines.append(" ".join(chunk))
                chunk = [word]
                chunk_len = len(word)
            else:
                chunk.append(word)
                chunk_len = next_len
        if chunk:
            lines.append(" ".join(chunk))
    return lines


def normalize_ko_tokens(text):
    tokens = []
    for raw in TOKEN_RE.findall(str(text or "")):
        if not KO_RE.match(raw):
            continue
        if raw in KO_STOPWORDS:
            continue
        tokens.append(raw)
    return tokens


def iter_hiphop_lyrics(dataset_name, genre, max_songs):
    csv_path = hf_hub_download(dataset_name, "raw/train2.csv", repo_type="dataset")
    used = 0
    for chunk in pd.read_csv(csv_path, chunksize=1000):
        if "Lyric" not in chunk.columns or "Genre0" not in chunk.columns:
            raise SystemExit(f"Expected Lyric and Genre0 columns in {csv_path}")
        for row in chunk.itertuples(index=False):
            row_genre = getattr(row, "Genre0")
            if str(row_genre).strip().lower() != genre.lower():
                continue
            lyric = getattr(row, "Lyric")
            if not isinstance(lyric, str) or not lyric.strip():
                continue
            used += 1
            yield lyric
            if max_songs and used >= max_songs:
                return


def load_translation_cache(cache_path):
    cache = {}
    if not cache_path or not cache_path.exists():
        return cache
    with cache_path.open("r", encoding="utf-8") as file:
        for line in file:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            source = row.get("sourceHash") or row.get("source")
            target = row.get("target")
            if isinstance(source, str) and isinstance(target, str):
                cache[source] = target
    return cache


def append_translation_cache(cache_path, rows):
    if not cache_path or not rows:
        return
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("a", encoding="utf-8", newline="\n") as file:
        for source_hash, target in rows:
            file.write(json.dumps({"sourceHash": source_hash, "target": target}, ensure_ascii=False) + "\n")


def source_hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def request_google_translation(text, timeout, retries):
    params = urllib.parse.urlencode({
        "client": "gtx",
        "sl": "en",
        "tl": "ko",
        "dt": "t",
        "q": text,
    })
    url = f"https://translate.googleapis.com/translate_a/single?{params}"
    last_error = None
    for attempt in range(retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            pieces = payload[0] if payload and payload[0] else []
            return "".join(part[0] for part in pieces if part and part[0]).strip()
        except Exception as exc:
            last_error = exc
            time.sleep(min(2.0, 0.35 * (attempt + 1)))
    raise RuntimeError(f"Google translation failed after {retries + 1} attempts: {last_error}")


def make_google_batches(lines, max_lines, max_chars):
    batch = []
    batch_chars = 0
    for line in lines:
        line_len = len(line) + 1
        if batch and (len(batch) >= max_lines or batch_chars + line_len > max_chars):
            yield batch
            batch = []
            batch_chars = 0
        batch.append(line)
        batch_chars += line_len
    if batch:
        yield batch


def make_local_translator(model_name, device, batch_size):
    try:
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    except ImportError as exc:
        raise SystemExit(
            "transformers, torch, sentencepiece, and sacremoses are required for local translation.\n"
            "Install them with: pip install transformers torch sentencepiece sacremoses"
        ) from exc

    resolved_device = "cpu" if device < 0 else f"cuda:{device}"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
    model.to(resolved_device)
    model.eval()
    return {
        "tokenizer": tokenizer,
        "model": model,
        "device": resolved_device,
        "torch": torch,
        "batch_size": batch_size,
    }


def translate_missing(lines, translator, batch_size):
    translations = []
    tokenizer = translator["tokenizer"]
    model = translator["model"]
    device = translator["device"]
    torch = translator["torch"]
    for index in range(0, len(lines), batch_size):
        batch = lines[index:index + batch_size]
        inputs = tokenizer(batch, return_tensors="pt", padding=True, truncation=True, max_length=256)
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.no_grad():
            generated = model.generate(**inputs, max_new_tokens=256, num_beams=4)
        outputs = tokenizer.batch_decode(generated, skip_special_tokens=True)
        translations.extend(output.strip() for output in outputs)
    return translations


def translate_missing_google(lines, timeout, retries, sleep_seconds, batch_lines, batch_chars):
    translations = []
    for batch in make_google_batches(lines, max_lines=batch_lines, max_chars=batch_chars):
        if len(batch) == 1:
            outputs = [request_google_translation(batch[0], timeout=timeout, retries=retries)]
        else:
            joined = "\n".join(batch)
            translated_text = request_google_translation(joined, timeout=timeout, retries=retries)
            outputs = [line.strip() for line in translated_text.splitlines()]
            if len(outputs) != len(batch):
                outputs = [
                    request_google_translation(line, timeout=timeout, retries=retries)
                    for line in batch
                ]
        translations.extend(outputs)
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)
    return translations


def collect_translated_lines(args):
    cache_path = Path(args.cache).expanduser() if args.cache else None
    cache = load_translation_cache(cache_path)
    local_translator = None
    translated_songs = []
    pending_cache_rows = []
    song_count = 0
    source_line_count = 0
    translated_line_count = 0

    for lyric in iter_hiphop_lyrics(args.dataset, args.genre, args.max_songs):
        song_count += 1
        source_lines = split_lyric_to_lines(lyric, args.max_line_chars)
        source_line_count += len(source_lines)
        translated_lines = []
        missing = []

        for line in source_lines:
            key = source_hash(line)
            cached = cache.get(key)
            if cached:
                translated_lines.append(cached)
            else:
                missing.append((key, line))

        if missing:
            missing_keys = [key for key, _ in missing]
            missing_lines = [line for _, line in missing]
            if args.translator == "local":
                if local_translator is None:
                    local_translator = make_local_translator(args.model, args.device, args.batch_size)
                translated = translate_missing(missing_lines, local_translator, args.batch_size)
            else:
                translated = translate_missing_google(
                    missing_lines,
                    timeout=args.timeout,
                    retries=args.retries,
                    sleep_seconds=args.sleep,
                    batch_lines=args.google_batch_lines,
                    batch_chars=args.google_batch_chars,
                )
            for key, target in zip(missing_keys, translated):
                cache[key] = target
                pending_cache_rows.append((key, target))
                translated_lines.append(target)
            if len(pending_cache_rows) >= 500:
                append_translation_cache(cache_path, pending_cache_rows)
                pending_cache_rows = []

        translated_lines = [line for line in translated_lines if line]
        translated_line_count += len(translated_lines)
        if translated_lines:
            translated_songs.append(translated_lines)

        if song_count % 100 == 0:
            print(f"Translated {song_count:,} Hip Hop songs, {translated_line_count:,} lines...", flush=True)

    append_translation_cache(cache_path, pending_cache_rows)
    return translated_songs, {
        "dataset": args.dataset,
        "genre": args.genre,
        "translator": args.translator,
        "translationModel": args.model if args.translator == "local" else "translate.googleapis.com",
        "rawTextIncluded": False,
        "cacheStoresSourceText": False,
        "cachePath": str(cache_path) if cache_path else "",
        "songCount": song_count,
        "translatedSongCount": len(translated_songs),
        "sourceLineCount": source_line_count,
        "translatedLineCount": translated_line_count,
        "minCount": args.min_count,
        "topN": args.top_n,
    }


def build_semantic_outputs(translated_songs, metadata, output_dir, min_count, top_n, cluster_count, cluster_terms):
    unigram = collections.Counter()
    bigram = collections.Counter()
    doc_freq = collections.Counter()
    cooccur = collections.defaultdict(collections.Counter)

    for song_lines in translated_songs:
        song_terms = set()
        for line in song_lines:
            tokens = normalize_ko_tokens(line)
            if not tokens:
                continue
            unigram.update(tokens)
            song_terms.update(tokens)
            for prev, nxt in zip(tokens, tokens[1:]):
                if prev != nxt:
                    bigram[(prev, nxt)] += 1
            unique_line_terms = sorted(set(tokens))
            for index, left in enumerate(unique_line_terms):
                for right in unique_line_terms[index + 1:]:
                    cooccur[left][right] += 1
                    cooccur[right][left] += 1
        doc_freq.update(song_terms)

    vocab_rows = trim_counter(unigram, min_count, top_n)
    total_count = sum(count for _, count in vocab_rows) or 1
    doc_total = max(1, metadata["translatedSongCount"])
    topic_rows = []

    for key, count in vocab_rows:
        word = key
        df = doc_freq[word]
        idf = math.log((doc_total + 1) / (df + 1)) + 1
        topic_rows.append({
            "word": word,
            "count": count,
            "songCount": df,
            "share": round(count / total_count, 8),
            "topicScore": round(count * idf, 4),
        })

    topic_rows.sort(key=lambda row: (row["topicScore"], row["count"]), reverse=True)
    topic_rows = topic_rows[:top_n] if top_n > 0 else topic_rows

    write_json(
        output_dir / "translated_hiphop_vocab_ko.json",
        {
            "metadata": metadata,
            "format": "word frequency from locally translated Hip Hop lyrics",
            "entries": [
                {
                    "word": key,
                    "count": count,
                    "share": round(count / total_count, 8),
                    "zipfLocal": round(math.log10(count / total_count) + 9, 4),
                }
                for key, count in vocab_rows
            ],
        },
    )

    write_json(
        output_dir / "translated_hiphop_bigram_ko.json",
        {
            "metadata": metadata,
            "format": "translated Korean bigram -> count",
            "entries": [[" ".join(key), count] for key, count in trim_counter(bigram, min_count, top_n)],
        },
    )

    write_json(
        output_dir / "translated_hiphop_topic_terms_ko.json",
        {
            "metadata": metadata,
            "format": "tf-idf-like topic terms from translated Hip Hop lyrics",
            "entries": topic_rows,
        },
    )

    used_terms = set()
    clusters = []
    for seed_row in topic_rows:
        seed = seed_row["word"]
        if seed in used_terms:
            continue
        related = [
            {"word": word, "cooccur": count}
            for word, count in trim_counter(cooccur[seed], min_count, cluster_terms)
            if word != seed and word not in used_terms
        ]
        if not related:
            continue
        cluster_words = [seed, *[row["word"] for row in related]]
        used_terms.update(cluster_words)
        clusters.append({
            "seed": seed,
            "seedScore": seed_row["topicScore"],
            "terms": [{"word": seed, "cooccur": None}, *related],
        })
        if len(clusters) >= cluster_count:
            break

    write_json(
        output_dir / "translated_hiphop_theme_clusters_ko.json",
        {
            "metadata": metadata,
            "format": "co-occurrence clusters seeded by translated topic terms",
            "clusters": clusters,
        },
    )


def main():
    parser = argparse.ArgumentParser(description="Translate English Hip Hop lyrics and build Korean semantic statistics.")
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--genre", default="Hip Hop")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--translator", choices=["google", "local"], default="google")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--cache", default=str(DEFAULT_CACHE), help="Translation cache path. Stores source hashes, not source text. Use empty string to disable.")
    parser.add_argument("--max-songs", type=int, default=0)
    parser.add_argument("--max-line-chars", type=int, default=220)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--device", type=int, default=-1, help="-1 for CPU, 0 for first CUDA device.")
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--sleep", type=float, default=0.05, help="Delay between Google Translate requests.")
    parser.add_argument("--google-batch-lines", type=int, default=32)
    parser.add_argument("--google-batch-chars", type=int, default=3500)
    parser.add_argument("--min-count", type=int, default=3)
    parser.add_argument("--top-n", type=int, default=50000)
    parser.add_argument("--cluster-count", type=int, default=24)
    parser.add_argument("--cluster-terms", type=int, default=24)
    args = parser.parse_args()

    if args.cache == "":
        args.cache = None

    translated_songs, metadata = collect_translated_lines(args)
    build_semantic_outputs(
        translated_songs,
        metadata,
        Path(args.output_dir).expanduser(),
        min_count=args.min_count,
        top_n=args.top_n,
        cluster_count=args.cluster_count,
        cluster_terms=args.cluster_terms,
    )
    print(
        "Built translated Hip Hop semantic outputs: "
        f"{metadata['translatedSongCount']:,} songs, "
        f"{metadata['translatedLineCount']:,} translated lines."
    )


if __name__ == "__main__":
    main()
