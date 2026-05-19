import argparse
import csv
import collections
import json
import math
import os
import pathlib
import re


ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT_DIR / "public" / "data" / "model"
DEFAULT_DICT = DEFAULT_DATA_DIR / "rhyme_dict_practical.json"
DEFAULT_OUTPUTS = {
    "ko": DEFAULT_DATA_DIR / "bigram_next_ko.json",
    "en": DEFAULT_DATA_DIR / "bigram_next_en.json",
}
DEFAULT_KO_CORPUS = pathlib.Path.home() / "Korpora" / "kowikitext" / "kowikitext_20200920.train"

KO_SUFFIXES = sorted(
    [
        "으로부터", "에게서", "에서", "으로", "부터", "까지", "처럼", "보다", "에게", "한테",
        "라고", "하고", "이나", "이나마", "라도", "마저", "조차", "밖에", "께서",
        "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과", "도", "만", "나", "랑",
    ],
    key=len,
    reverse=True,
)


def load_vocab(lang):
    data = json.loads(DEFAULT_DICT.read_text(encoding="utf-8"))
    vocab = {
        str(item.get("word", "")).lower()
        for item in data
        if item.get("lang") == lang and item.get("word")
    }
    return vocab


def normalize_ko_token(token, vocab):
    token = re.sub(r"[^가-힣]", "", token)
    if not token:
        return None
    if token in vocab:
        return token

    for suffix in KO_SUFFIXES:
        if token.endswith(suffix) and len(token) > len(suffix) + 1:
            stem = token[: -len(suffix)]
            if stem in vocab:
                return stem

    return None


def normalize_en_token(token, vocab):
    token = re.sub(r"[^a-z']", "", token.lower()).strip("'")
    if token in {"s", "t", "d", "ll", "m", "re", "ve"}:
        return None
    if token and token in vocab:
        return token
    return None


def normalize_token(token, lang, vocab, cache):
    cached = cache.get(token)
    if cached is not None:
        return cached

    if lang == "ko":
        normalized = normalize_ko_token(token, vocab)
    else:
        normalized = normalize_en_token(token, vocab)

    cache[token] = normalized or ""
    return normalized


def tokenize_line(line, lang, vocab, cache):
    if lang == "ko":
        raw_tokens = re.findall(r"[가-힣]+", line)
    else:
        raw_tokens = re.findall(r"[A-Za-z']+", line)

    return [token for token in (normalize_token(raw, lang, vocab, cache) for raw in raw_tokens) if token]


def build_counts(corpus_paths, lang, vocab, max_lines=0):
    next_counts = collections.defaultdict(collections.Counter)
    unigram_counts = collections.Counter()
    token_cache = {}
    total_pairs = 0
    used_lines = 0
    seen_lines = 0

    for corpus_path in corpus_paths:
        print(f"Reading corpus: {corpus_path}", flush=True)
        with corpus_path.open("r", encoding="utf-8", errors="ignore") as file:
            for line in file:
                seen_lines += 1
                if max_lines and seen_lines > max_lines:
                    return next_counts, unigram_counts, total_pairs, used_lines

                tokens = tokenize_line(line, lang, vocab, token_cache)
                if not tokens:
                    continue

                used_lines += 1
                unigram_counts.update(tokens)
                for prev, nxt in zip(tokens, tokens[1:]):
                    if prev == nxt:
                        continue
                    next_counts[prev][nxt] += 1
                    total_pairs += 1

                if seen_lines % 500000 == 0:
                    print(f"Processed {seen_lines:,} lines, {total_pairs:,} accepted bigrams...", flush=True)

    return next_counts, unigram_counts, total_pairs, used_lines


def build_counts_from_ngram_csv(csv_path, lang, vocab, max_rows=0):
    next_counts = collections.defaultdict(collections.Counter)
    unigram_counts = collections.Counter()
    token_cache = {}
    total_pairs = 0
    used_rows = 0

    with csv_path.open("r", encoding="utf-8", errors="ignore", newline="") as file:
        reader = csv.DictReader(file)
        for row_number, row in enumerate(reader, 1):
            if max_rows and row_number > max_rows:
                break

            ngram = row.get("ngram") or row.get("bigram") or ""
            try:
                count = int(row.get("freq") or row.get("frequency") or row.get("count") or 0)
            except ValueError:
                continue

            tokens = tokenize_line(ngram, lang, vocab, token_cache)
            if len(tokens) != 2 or count <= 0:
                continue

            prev, nxt = tokens
            if prev == nxt:
                continue

            next_counts[prev][nxt] += count
            unigram_counts[prev] += count
            unigram_counts[nxt] += count
            total_pairs += count
            used_rows += 1

    return next_counts, unigram_counts, total_pairs, used_rows


def build_counts_from_parquet(parquet_paths, lang, vocab, text_column="text", max_rows=0):
    try:
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise SystemExit("pyarrow is required for parquet input. Install it with: pip install pyarrow") from exc

    next_counts = collections.defaultdict(collections.Counter)
    unigram_counts = collections.Counter()
    token_cache = {}
    total_pairs = 0
    used_rows = 0
    seen_rows = 0

    for parquet_path in parquet_paths:
        parquet_file = pq.ParquetFile(parquet_path)
        for batch in parquet_file.iter_batches(columns=[text_column], batch_size=10000):
            texts = batch.column(0).to_pylist()
            for text in texts:
                seen_rows += 1
                if max_rows and seen_rows > max_rows:
                    return next_counts, unigram_counts, total_pairs, used_rows

                tokens = tokenize_line(str(text or ""), lang, vocab, token_cache)
                if not tokens:
                    continue

                used_rows += 1
                unigram_counts.update(tokens)
                for prev, nxt in zip(tokens, tokens[1:]):
                    if prev == nxt:
                        continue
                    next_counts[prev][nxt] += 1
                    total_pairs += 1

                if seen_rows % 500000 == 0:
                    print(f"Processed {seen_rows:,} rows, {total_pairs:,} accepted bigrams...", flush=True)

    return next_counts, unigram_counts, total_pairs, used_rows


def score_followers(next_counts, unigram_counts, total_pairs, top_n, min_count):
    index = {}
    total_unigrams = sum(unigram_counts.values()) or 1

    for prev, followers in next_counts.items():
        prev_total = sum(followers.values())
        ranked = []

        for nxt, count in followers.items():
            if count < min_count:
                continue

            conditional = count / prev_total
            expected = unigram_counts[nxt] / total_unigrams
            pmi = math.log2(conditional / expected) if expected > 0 else 0
            score = round(conditional * max(1.0, pmi), 6)
            ranked.append([nxt, count, score])

        ranked.sort(key=lambda item: (item[2], item[1]), reverse=True)
        if ranked:
            index[prev] = ranked[:top_n]

    return index


def format_source(source):
    if isinstance(source, (list, tuple)):
        return [str(item) for item in source]
    return str(source)


def write_index(output_path, lang, source, index, total_pairs, used_lines, top_n, min_count):
    payload = {
        "lang": lang,
        "source": format_source(source),
        "format": "next_word -> [[word, count, score]]",
        "topN": top_n,
        "minCount": min_count,
        "totalPairs": total_pairs,
        "usedLines": used_lines,
        "entries": index,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def main():
    parser = argparse.ArgumentParser(description="Build a compact next-word bigram index for the rhyme app.")
    parser.add_argument("--lang", choices=["ko", "en"], default="ko")
    parser.add_argument("--corpus", nargs="*", default=None, help="One or more plain-text corpus paths. Defaults to local Korpora kowikitext for ko.")
    parser.add_argument("--ngram-csv", default=None, help="Pre-counted CSV with ngram/bigram and freq/frequency/count columns.")
    parser.add_argument("--parquet", nargs="*", default=None, help="One or more parquet files with a text column.")
    parser.add_argument("--text-column", default="text")
    parser.add_argument("--source-label", default=None, help="Optional source label or URL to write into the output metadata.")
    parser.add_argument("--output", default=None)
    parser.add_argument("--top-n", type=int, default=30)
    parser.add_argument("--min-count", type=int, default=3)
    parser.add_argument("--max-lines", type=int, default=0, help="Optional line cap for quick experiments.")
    args = parser.parse_args()

    output_path = pathlib.Path(args.output).expanduser() if args.output else DEFAULT_OUTPUTS[args.lang]
    vocab = load_vocab(args.lang)
    print(f"Loaded {len(vocab):,} {args.lang} vocabulary words.")

    if args.ngram_csv:
        source_path = pathlib.Path(args.ngram_csv).expanduser()
        if not source_path.exists():
            raise SystemExit(f"Ngram CSV file not found: {source_path}")
        next_counts, unigram_counts, total_pairs, used_lines = build_counts_from_ngram_csv(source_path, args.lang, vocab, args.max_lines)
    elif args.parquet:
        parquet_paths = [pathlib.Path(path).expanduser() for path in args.parquet]
        missing_paths = [path for path in parquet_paths if not path.exists()]
        if missing_paths:
            raise SystemExit(f"Parquet file not found: {missing_paths[0]}")
        source_path = ", ".join(str(path) for path in parquet_paths)
        next_counts, unigram_counts, total_pairs, used_lines = build_counts_from_parquet(
            parquet_paths,
            args.lang,
            vocab,
            text_column=args.text_column,
            max_rows=args.max_lines,
        )
    else:
        corpus_paths = [pathlib.Path(path).expanduser() for path in args.corpus] if args.corpus else [DEFAULT_KO_CORPUS]
        missing_paths = [path for path in corpus_paths if not path.exists()]
        if missing_paths:
            raise SystemExit(f"Corpus file not found: {missing_paths[0]}")
        source_path = corpus_paths if len(corpus_paths) > 1 else corpus_paths[0]
        next_counts, unigram_counts, total_pairs, used_lines = build_counts(corpus_paths, args.lang, vocab, args.max_lines)

    index = score_followers(next_counts, unigram_counts, total_pairs, args.top_n, args.min_count)
    source_label = args.source_label or source_path
    write_index(output_path, args.lang, source_label, index, total_pairs, used_lines, args.top_n, args.min_count)

    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"Saved {len(index):,} bigram heads, {total_pairs:,} accepted pairs to {output_path} ({size_mb:.2f} MB).")


if __name__ == "__main__":
    main()
