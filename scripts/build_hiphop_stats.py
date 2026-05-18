import argparse
import collections
import json
import math
import re
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_DIR = ROOT_DIR / "raw_lyrics"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "public" / "data"

TOKEN_RE = re.compile(r"[\uAC00-\uD7A3]+|[A-Za-z][A-Za-z']*")
KO_RE = re.compile(r"^[\uAC00-\uD7A3]+$")
EN_RE = re.compile(r"^[a-z][a-z']*$")
LINE_END_RE = re.compile(r"[\uAC00-\uD7A3A-Za-z']+")

KO_STOPWORDS = {
    "\uB098", "\uB09C", "\uB108", "\uB10C", "\uC6B0\uB9AC", "\uC800", "\uC81C",
    "\uADF8", "\uADF8\uAC8C", "\uC774", "\uC800", "\uC800\uAC8C", "\uAC83", "\uC218",
    "\uB54C", "\uB610", "\uB354", "\uB2E4", "\uB2E4\uC2DC", "\uC544\uC9C1",
    "\uC774\uC81C", "\uC624\uB298", "\uB0B4", "\uB124", "\uB2C8",
}

EN_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "at", "for",
    "from", "with", "without", "is", "are", "was", "were", "be", "been", "being",
    "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "they", "their",
    "it", "its", "this", "that", "these", "those", "do", "does", "did", "done",
    "have", "has", "had", "not", "no", "so", "just", "yeah", "uh", "oh",
}


def iter_text_files(input_dir):
    if not input_dir.exists():
        raise SystemExit(f"Input directory not found: {input_dir}")
    return sorted(path for path in input_dir.rglob("*.txt") if path.is_file())


def normalize_token(token):
    token = token.strip().replace("\u2019", "'").replace("\u2018", "'")
    if not token:
        return ""
    if KO_RE.match(token):
        return token
    lowered = token.lower().strip("'")
    return lowered if EN_RE.match(lowered) else ""


def tokenize(line, keep_stopwords=False):
    tokens = []
    for raw in TOKEN_RE.findall(line):
        token = normalize_token(raw)
        if not token:
            continue
        if not keep_stopwords and (token in KO_STOPWORDS or token in EN_STOPWORDS):
            continue
        tokens.append(token)
    return tokens


def get_line_ending(line):
    matches = LINE_END_RE.findall(line)
    if not matches:
        return ""
    return normalize_token(matches[-1])


def get_ending_pattern(token, width):
    if not token:
        return ""
    chars = list(token)
    return "".join(chars[-width:])


def update_ngram_counts(tokens, counters, max_n):
    for n in range(1, max_n + 1):
        if len(tokens) < n:
            continue
        counter = counters[n]
        for index in range(len(tokens) - n + 1):
            counter[tuple(tokens[index:index + n])] += 1


def trim_counter(counter, min_count, top_n):
    rows = [
        (key, count)
        for key, count in counter.items()
        if count >= min_count
    ]
    rows.sort(key=lambda item: (item[1], item[0]), reverse=True)
    if top_n > 0:
        rows = rows[:top_n]
    return rows


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def build_stats(input_dir, output_dir, min_count, top_n, max_n):
    files = iter_text_files(input_dir)
    if not files:
        raise SystemExit(f"No .txt lyric files found in: {input_dir}")

    ngram_counters = {n: collections.Counter() for n in range(1, max_n + 1)}
    surface_bigram = collections.defaultdict(collections.Counter)
    ending_counter = collections.Counter()
    ending_width_counters = {1: collections.Counter(), 2: collections.Counter(), 3: collections.Counter()}
    language_counter = collections.Counter()
    line_count = 0
    nonempty_line_count = 0
    token_count = 0

    for path in files:
        text = path.read_text(encoding="utf-8", errors="ignore")
        for line in text.splitlines():
            line_count += 1
            stripped = line.strip()
            if not stripped:
                continue

            tokens_with_stopwords = tokenize(stripped, keep_stopwords=True)
            tokens = tokenize(stripped, keep_stopwords=False)
            if tokens_with_stopwords:
                nonempty_line_count += 1
                for prev, nxt in zip(tokens_with_stopwords, tokens_with_stopwords[1:]):
                    if prev != nxt:
                        surface_bigram[prev][nxt] += 1

            if tokens:
                token_count += len(tokens)
                update_ngram_counts(tokens, ngram_counters, max_n)
                for token in tokens:
                    if KO_RE.match(token):
                        language_counter["ko"] += 1
                    elif EN_RE.match(token):
                        language_counter["en"] += 1

            ending = get_line_ending(stripped)
            if ending:
                ending_counter[ending] += 1
                for width, counter in ending_width_counters.items():
                    pattern = get_ending_pattern(ending, width)
                    if pattern:
                        counter[pattern] += 1

    metadata = {
        "source": "local raw_lyrics text files",
        "rawTextIncluded": False,
        "fileCount": len(files),
        "lineCount": line_count,
        "nonemptyLineCount": nonempty_line_count,
        "tokenCount": token_count,
        "minCount": min_count,
        "topN": top_n,
        "maxN": max_n,
    }

    vocab_rows = trim_counter(ngram_counters[1], min_count, top_n)
    total_vocab_count = sum(count for _, count in vocab_rows) or 1
    vocab_stats = {
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
    }

    write_json(output_dir / "hiphop_vocab_stats_ko.json", vocab_stats)

    for n in range(2, max_n + 1):
        rows = trim_counter(ngram_counters[n], min_count, top_n)
        write_json(
            output_dir / f"hiphop_{n}gram_ko.json",
            {
                "metadata": metadata,
                "format": f"{n}-gram -> count",
                "entries": [[" ".join(key), count] for key, count in rows],
            },
        )

    surface_entries = {}
    for head, followers in surface_bigram.items():
        rows = trim_counter(followers, min_count, 30)
        if rows:
            surface_entries[head] = [[key, count] for key, count in rows]

    write_json(
        output_dir / "hiphop_surface_bigram_ko.json",
        {
            "metadata": metadata,
            "format": "surface_head -> [[surface_next, count]]",
            "entries": surface_entries,
        },
    )

    write_json(
        output_dir / "hiphop_rhyme_patterns_ko.json",
        {
            "metadata": metadata,
            "lineEndings": [[key, count] for key, count in trim_counter(ending_counter, min_count, top_n)],
            "endingPatterns": {
                str(width): [[key, count] for key, count in trim_counter(counter, min_count, top_n)]
                for width, counter in ending_width_counters.items()
            },
        },
    )

    return metadata


def main():
    parser = argparse.ArgumentParser(description="Build non-raw hiphop lyric statistics from local text files.")
    parser.add_argument("--input-dir", default=str(DEFAULT_INPUT_DIR), help="Directory containing local .txt lyric files.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for generated statistics JSON files.")
    parser.add_argument("--min-count", type=int, default=3, help="Drop n-grams and patterns below this count.")
    parser.add_argument("--top-n", type=int, default=50000, help="Maximum rows per output list. Use 0 for no cap.")
    parser.add_argument("--max-n", type=int, choices=[2, 3], default=3, help="Maximum n-gram size to store.")
    args = parser.parse_args()

    metadata = build_stats(
        Path(args.input_dir).expanduser(),
        Path(args.output_dir).expanduser(),
        min_count=args.min_count,
        top_n=args.top_n,
        max_n=args.max_n,
    )
    print(
        "Built hiphop lyric stats: "
        f"{metadata['fileCount']} files, "
        f"{metadata['nonemptyLineCount']} nonempty lines, "
        f"{metadata['tokenCount']} kept tokens."
    )


if __name__ == "__main__":
    main()
