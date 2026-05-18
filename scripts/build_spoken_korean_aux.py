import argparse
import collections
import csv
import io
import json
import math
import re
import zipfile
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_DIR = ROOT_DIR / "자료"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "public" / "data"

TOKEN_RE = re.compile(r"[\uAC00-\uD7A3]+|[A-Za-z][A-Za-z']*")
KO_RE = re.compile(r"^[\uAC00-\uD7A3]+$")
EN_RE = re.compile(r"^[a-z][a-z']*$")
LINE_END_RE = re.compile(r"[\uAC00-\uD7A3A-Za-z']+")
SENTENCE_SPLIT_RE = re.compile(r"[\r\n]+|(?<=[.!?\u3002\uFF01\uFF1F])\s+|(?<=[\uB2E4\uC694\uC8E0\uC9C0])\s{2,}")

KO_STOPWORDS = {
    "나", "난", "너", "넌", "우리", "저", "제", "그", "그게", "이", "저게",
    "것", "수", "때", "또", "더", "다", "다시", "아직", "이제", "오늘",
    "내", "네", "니", "그리고", "하지만", "그래서", "그러나", "이런", "저런",
    "그런", "정도", "정말", "진짜", "아주", "너무", "많이", "조금", "좀",
    "한", "두", "세", "등", "및", "또는", "있는", "없는", "합니다",
    "했다", "하는", "하고", "하면", "해서", "한다", "라고", "라는",
}

EN_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "at", "for",
    "from", "with", "without", "is", "are", "was", "were", "be", "been", "being",
    "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "they", "their",
    "it", "its", "this", "that", "these", "those", "do", "does", "did", "done",
    "have", "has", "had", "not", "no", "so", "just", "yeah", "uh", "oh",
}


def normalize_token(token):
    token = token.strip().replace("\u2019", "'").replace("\u2018", "'")
    if not token:
        return ""
    if KO_RE.match(token):
        return token
    lowered = token.lower().strip("'")
    return lowered if EN_RE.match(lowered) else ""


def tokenize(text, keep_stopwords=False, topic_mode=False):
    tokens = []
    for raw in TOKEN_RE.findall(text):
        token = normalize_token(raw)
        if not token:
            continue
        if not keep_stopwords and (token in KO_STOPWORDS or token in EN_STOPWORDS):
            continue
        if topic_mode and len(token) < 2:
            continue
        tokens.append(token)
    return tokens


def split_text_units(text):
    for unit in SENTENCE_SPLIT_RE.split(text):
        stripped = unit.strip()
        if stripped:
            yield stripped


def get_line_ending(text):
    matches = LINE_END_RE.findall(text)
    return normalize_token(matches[-1]) if matches else ""


def get_ending_pattern(token, width):
    return "".join(list(token)[-width:]) if token else ""


def update_ngram_counts(tokens, counters, max_n):
    for n in range(1, max_n + 1):
        if len(tokens) < n:
            continue
        counter = counters[n]
        for index in range(len(tokens) - n + 1):
            counter[tuple(tokens[index:index + n])] += 1


def trim_counter(counter, min_count, top_n):
    rows = [(key, count) for key, count in counter.items() if count >= min_count]
    rows.sort(key=lambda item: (item[1], item[0]), reverse=True)
    return rows[:top_n] if top_n > 0 else rows


def maybe_prune(counter, max_size):
    if len(counter) <= max_size:
        return
    for key, count in list(counter.items()):
        if count <= 1:
            del counter[key]


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def find_zip_files(input_dir, include_validation):
    zips = sorted(input_dir.rglob("*.zip"))
    prefixes = ("TS_", "VS_") if include_validation else ("TS_",)
    spoken_121 = [
        path for path in zips
        if path.name.endswith(".zip") and "구어체" in path.name and path.name.startswith(prefixes)
    ]
    dialogue_045 = [
        path for path in zips
        if path.name.startswith(prefixes) and any(part.startswith("045.") for part in path.parts)
    ]
    return spoken_121, dialogue_045


def clipped_text(text, max_chars):
    if max_chars and max_chars > 0 and len(text) > max_chars:
        return text[:max_chars]
    return text


def iter_121_documents(zip_paths, max_chars_per_document):
    for zip_path in zip_paths:
        print(f"Reading 121 spoken ZIP: {zip_path.name}", flush=True)
        with zipfile.ZipFile(zip_path) as archive:
            members = sorted(
                (info for info in archive.infolist() if not info.is_dir() and info.filename.endswith(".json")),
                key=lambda info: info.filename,
            )
            for info in members:
                print(f"  JSON member: {info.filename} ({info.file_size / 1024 / 1024:.1f} MB)", flush=True)
                with archive.open(info) as handle:
                    payload = json.load(io.TextIOWrapper(handle, encoding="utf-8", errors="ignore"))
                for row in payload.get("data_info", []):
                    text = row.get("contents")
                    if not isinstance(text, str) or not text.strip():
                        continue
                    category = row.get("data_category") or {}
                    label = "121"
                    for key in ("main", "middle", "sub"):
                        value = category.get(key)
                        if value:
                            label = f"121:{value}"
                            break
                    yield {
                        "source": "121_spoken",
                        "category": label,
                        "text": clipped_text(text, max_chars_per_document),
                    }


def iter_045_documents(zip_paths, max_chars_per_document):
    for zip_path in zip_paths:
        print(f"Reading 045 dialogue ZIP: {zip_path.name}", flush=True)
        category = zip_path.stem.replace("TS_", "").replace("VS_", "")
        with zipfile.ZipFile(zip_path) as archive:
            members = sorted(
                (info for info in archive.infolist() if not info.is_dir() and info.filename.endswith(".tsv")),
                key=lambda info: info.filename,
            )
            for info in members:
                with archive.open(info) as handle:
                    wrapper = io.TextIOWrapper(handle, encoding="utf-8-sig", errors="ignore", newline="")
                    reader = csv.DictReader(wrapper, delimiter="\t")
                    for row in reader:
                        text = row.get("text") or ""
                        if text.strip():
                            yield {
                                "source": "045_dialogue",
                                "category": f"045:{category}",
                                "text": clipped_text(text, max_chars_per_document),
                            }


def iter_documents(input_dir, include_validation, max_chars_per_document):
    spoken_121, dialogue_045 = find_zip_files(input_dir, include_validation)
    if not spoken_121 and not dialogue_045:
        raise SystemExit(f"No 121 spoken or 045 dialogue ZIP files found in: {input_dir}")
    yield from iter_121_documents(spoken_121, max_chars_per_document)
    yield from iter_045_documents(dialogue_045, max_chars_per_document)


def update_source_stats(stats, source, category, text, unit_count, token_count):
    source_row = stats[source]
    source_row["documents"] += 1
    source_row["units"] += unit_count
    source_row["tokens"] += token_count
    source_row["chars"] += len(text)
    category_row = source_row["categories"][category]
    category_row["documents"] += 1
    category_row["units"] += unit_count
    category_row["tokens"] += token_count


def build_stats(input_dir, output_dir, min_count, top_n, max_n, include_validation, max_chars_per_document, surface_top_heads):
    ngram_counters = {n: collections.Counter() for n in range(1, max_n + 1)}
    surface_bigram = collections.defaultdict(collections.Counter)
    ending_counter = collections.Counter()
    ending_width_counters = {1: collections.Counter(), 2: collections.Counter(), 3: collections.Counter()}
    doc_frequency = collections.Counter()
    category_token_counts = collections.defaultdict(collections.Counter)
    language_counter = collections.Counter()
    source_stats = collections.defaultdict(lambda: {
        "documents": 0,
        "units": 0,
        "tokens": 0,
        "chars": 0,
        "categories": collections.defaultdict(lambda: {"documents": 0, "units": 0, "tokens": 0}),
    })

    document_count = 0
    text_unit_count = 0
    token_count = 0

    for document in iter_documents(input_dir, include_validation, max_chars_per_document):
        document_count += 1
        text = document["text"]
        source = document["source"]
        category = document["category"]
        document_tokens = []
        unit_count = 0
        document_token_count = 0

        for unit in split_text_units(text):
            unit_count += 1
            text_unit_count += 1
            tokens_with_stopwords = tokenize(unit, keep_stopwords=True)
            tokens = tokenize(unit, keep_stopwords=False)

            if tokens_with_stopwords:
                for prev, nxt in zip(tokens_with_stopwords, tokens_with_stopwords[1:]):
                    if prev != nxt:
                        surface_bigram[prev][nxt] += 1

            if tokens:
                token_count += len(tokens)
                document_token_count += len(tokens)
                document_tokens.extend(tokens)
                update_ngram_counts(tokens, ngram_counters, max_n)
                for token in tokens:
                    if KO_RE.match(token):
                        language_counter["ko"] += 1
                    elif EN_RE.match(token):
                        language_counter["en"] += 1

            ending = get_line_ending(unit)
            if ending:
                ending_counter[ending] += 1
                for width, counter in ending_width_counters.items():
                    pattern = get_ending_pattern(ending, width)
                    if pattern:
                        counter[pattern] += 1

        topic_tokens = [token for token in document_tokens if len(token) >= 2]
        unique_topic_tokens = set(topic_tokens)
        doc_frequency.update(unique_topic_tokens)
        category_token_counts[category].update(topic_tokens)
        update_source_stats(source_stats, source, category, text, unit_count, document_token_count)

        if document_count % 10000 == 0:
            print(f"Processed {document_count:,} documents, {text_unit_count:,} text units, {token_count:,} kept tokens...", flush=True)
            for counter in ngram_counters.values():
                maybe_prune(counter, 1_500_000)
            maybe_prune(ending_counter, 500_000)

    metadata = {
        "source": ["121_spoken", "045_dialogue"],
        "rawTextIncluded": False,
        "documentCount": document_count,
        "textUnitCount": text_unit_count,
        "tokenCount": token_count,
        "minCount": min_count,
        "topN": top_n,
        "maxN": max_n,
        "includeValidation": include_validation,
        "maxCharsPerDocument": max_chars_per_document,
        "surfaceTopHeads": surface_top_heads,
        "sources": {
            source: {
                **{key: value for key, value in row.items() if key != "categories"},
                "categories": dict(row["categories"]),
            }
            for source, row in source_stats.items()
        },
    }

    vocab_rows = trim_counter(ngram_counters[1], min_count, top_n)
    total_vocab_count = sum(count for _, count in vocab_rows) or 1
    write_json(output_dir / "spoken_korean_vocab_ko.json", {
        "metadata": metadata,
        "languageTokenCounts": dict(language_counter),
        "entries": [
            {
                "word": key[0],
                "count": count,
                "share": round(count / total_vocab_count, 8),
                "zipfLocal": round(math.log10(count / total_vocab_count) + 9, 4),
            }
            for key, count in vocab_rows
        ],
    })

    for n in range(2, max_n + 1):
        rows = trim_counter(ngram_counters[n], min_count, top_n)
        write_json(output_dir / f"spoken_korean_{n}gram_ko.json", {
            "metadata": metadata,
            "format": f"{n}-gram -> count",
            "entries": [[" ".join(key), count] for key, count in rows],
        })

    surface_rows = []
    for head, followers in surface_bigram.items():
        rows = trim_counter(followers, min_count, 30)
        if rows:
            surface_rows.append((head, sum(count for _, count in rows), rows))
    surface_rows.sort(key=lambda row: (row[1], row[0]), reverse=True)
    if surface_top_heads > 0:
        surface_rows = surface_rows[:surface_top_heads]
    surface_entries = {
        head: [[key, count] for key, count in rows]
        for head, _, rows in surface_rows
    }
    write_json(output_dir / "spoken_korean_surface_bigram_ko.json", {
        "metadata": metadata,
        "format": "surface_head -> [[surface_next, count]]",
        "entries": surface_entries,
    })

    write_json(output_dir / "spoken_korean_line_endings_ko.json", {
        "metadata": metadata,
        "lineEndings": [[key, count] for key, count in trim_counter(ending_counter, min_count, top_n)],
        "endingPatterns": {
            str(width): [[key, count] for key, count in trim_counter(counter, min_count, top_n)]
            for width, counter in ending_width_counters.items()
        },
    })

    topic_rows = []
    for key, count in ngram_counters[1].items():
        token = key[0]
        if len(token) < 2 or count < min_count:
            continue
        docs = doc_frequency.get(token, 0)
        if docs <= 0:
            continue
        idf = math.log((document_count + 1) / (docs + 1)) + 1
        score = math.log1p(count) * idf
        topic_rows.append((token, count, docs, score))
    topic_rows.sort(key=lambda row: (row[3], row[1], row[0]), reverse=True)
    if top_n > 0:
        topic_rows = topic_rows[:top_n]
    write_json(output_dir / "spoken_korean_topic_terms_ko.json", {
        "metadata": metadata,
        "format": "tf-idf-like topic terms from 121 spoken + 045 dialogue",
        "entries": [
            {"term": token, "count": count, "documentCount": docs, "score": round(score, 6)}
            for token, count, docs, score in topic_rows
        ],
    })

    cluster_payload = {}
    for category, counter in category_token_counts.items():
        rows = trim_counter(counter, min_count, 100)
        if rows:
            cluster_payload[category] = [[key, count] for key, count in rows]
    write_json(output_dir / "spoken_korean_source_clusters_ko.json", {
        "metadata": metadata,
        "format": "source/category -> top spoken terms",
        "clusters": cluster_payload,
    })

    return metadata


def main():
    parser = argparse.ArgumentParser(description="Build auxiliary spoken Korean models from 121 spoken corpus and 045 dialogue corpus.")
    parser.add_argument("--input-dir", default=str(DEFAULT_INPUT_DIR), help="Directory containing the remaining corpus ZIP files.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for generated JSON files.")
    parser.add_argument("--min-count", type=int, default=5, help="Drop n-grams and patterns below this count.")
    parser.add_argument("--top-n", type=int, default=50000, help="Maximum rows per output list. Use 0 for no cap.")
    parser.add_argument("--max-n", type=int, choices=[2, 3], default=3, help="Maximum n-gram size to store.")
    parser.add_argument("--include-validation", action="store_true", help="Also include validation ZIP files. Training ZIP files are used by default.")
    parser.add_argument("--max-chars-per-document", type=int, default=2000, help="Clip each source document to this many characters before tokenization. Use 0 for no clipping.")
    parser.add_argument("--surface-top-heads", type=int, default=150000, help="Maximum number of surface bigram head tokens to keep. Use 0 for no cap.")
    args = parser.parse_args()

    metadata = build_stats(
        Path(args.input_dir).expanduser(),
        Path(args.output_dir).expanduser(),
        min_count=args.min_count,
        top_n=args.top_n,
        max_n=args.max_n,
        include_validation=args.include_validation,
        max_chars_per_document=args.max_chars_per_document,
        surface_top_heads=args.surface_top_heads,
    )
    print(
        "Built spoken Korean auxiliary models: "
        f"{metadata['documentCount']:,} documents, "
        f"{metadata['textUnitCount']:,} text units, "
        f"{metadata['tokenCount']:,} kept tokens."
    )


if __name__ == "__main__":
    main()
