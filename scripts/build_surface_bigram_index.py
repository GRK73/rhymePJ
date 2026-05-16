import argparse
import collections
import json
import math
import pathlib
import re


ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT_DIR / "public" / "data"
DEFAULT_DICT = DEFAULT_DATA_DIR / "rhyme_dict_practical.json"
DEFAULT_CORPUS = pathlib.Path.home() / "Korpora" / "kowikitext" / "kowikitext_20200920.train"
DEFAULT_OUTPUT = DEFAULT_DATA_DIR / "bigram_surface_ko.json"

HANGUL_RE = re.compile(r"[\uac00-\ud7a3]+")
NON_HANGUL_RE = re.compile(r"[^\uac00-\ud7a3]")

KO_SUFFIXES = sorted(
    [
        "\uc73c\ub85c\ubd80\ud130",
        "\uc5d0\uac8c\uc11c",
        "\uc5d0\uc11c",
        "\uc73c\ub85c",
        "\ubd80\ud130",
        "\uae4c\uc9c0",
        "\ucc98\ub7fc",
        "\ubcf4\ub2e4",
        "\uc5d0\uac8c",
        "\ud55c\ud14c",
        "\ub77c\uace0",
        "\ud558\uace0",
        "\uc774\ub098",
        "\uc774\ub098\ub9c8",
        "\ub77c\ub3c4",
        "\ub9c8\uc800",
        "\uc870\ucc28",
        "\ubc16\uc5d0",
        "\uaed8\uc11c",
        "\uc740",
        "\ub294",
        "\uc774",
        "\uac00",
        "\uc744",
        "\ub97c",
        "\uc758",
        "\uc5d0",
        "\ub85c",
        "\uc640",
        "\uacfc",
        "\ub3c4",
        "\ub9cc",
        "\ub098",
        "\ub791",
    ],
    key=len,
    reverse=True,
)

SHORT_PARTICLE_STEMS = {
    "\ub098",
    "\ub108",
    "\ub0b4",
    "\ub124",
    "\uc800",
    "\uc81c",
    "\ub204",
    "\ubb50",
    "\uadf8",
    "\uc774",
}


def load_vocab():
    data = json.loads(DEFAULT_DICT.read_text(encoding="utf-8"))
    return {
        str(item.get("word", "")).lower()
        for item in data
        if item.get("lang") == "ko" and item.get("word")
    }


def normalize_surface_token(token, vocab, min_token_len, max_token_len, min_stem_len, min_particle_stem_len):
    surface = NON_HANGUL_RE.sub("", token)
    if len(surface) < min_token_len or len(surface) > max_token_len:
        return None

    if surface in vocab:
        return surface, surface

    for suffix in KO_SUFFIXES:
        if not surface.endswith(suffix):
            continue

        stem = surface[: -len(suffix)]
        if len(stem) >= min_stem_len and stem in vocab:
            return surface, stem
        if len(stem) >= min_particle_stem_len and stem in SHORT_PARTICLE_STEMS:
            return surface, stem

    return surface, ""


def tokenize_line(line, vocab, token_cache, min_token_len, max_token_len, min_stem_len, min_particle_stem_len):
    tokens = []
    for raw in HANGUL_RE.findall(line):
        cached = token_cache.get(raw)
        if cached is None:
            cached = normalize_surface_token(
                raw,
                vocab,
                min_token_len,
                max_token_len,
                min_stem_len,
                min_particle_stem_len,
            )
            token_cache[raw] = cached or ""
        if cached:
            tokens.append(cached)
    return tokens


def accepts_pair(prev, nxt, require_normalized):
    prev_norm = bool(prev[1])
    next_norm = bool(nxt[1])

    if require_normalized == "head":
        return prev_norm
    if require_normalized == "next":
        return next_norm
    if require_normalized == "both":
        return prev_norm and next_norm
    if require_normalized == "any":
        return prev_norm or next_norm
    return True


def build_counts(corpus_paths, vocab, args):
    next_counts = collections.defaultdict(collections.Counter)
    unigram_counts = collections.Counter()
    normalized_by_surface = {}
    token_cache = {}
    total_pairs = 0
    used_lines = 0
    seen_lines = 0

    for corpus_path in corpus_paths:
        print(f"Reading corpus: {corpus_path}", flush=True)
        with corpus_path.open("r", encoding="utf-8", errors="ignore") as file:
            for line in file:
                seen_lines += 1
                if args.max_lines and seen_lines > args.max_lines:
                    return next_counts, unigram_counts, normalized_by_surface, total_pairs, used_lines

                tokens = tokenize_line(
                    line,
                    vocab,
                    token_cache,
                    args.min_token_len,
                    args.max_token_len,
                    args.min_stem_len,
                    args.min_particle_stem_len,
                )
                if not tokens:
                    continue

                used_lines += 1
                for surface, normalized in tokens:
                    unigram_counts[surface] += 1
                    if normalized:
                        normalized_by_surface[surface] = normalized

                for prev, nxt in zip(tokens, tokens[1:]):
                    prev_surface, _ = prev
                    next_surface, _ = nxt
                    if prev_surface == next_surface:
                        continue
                    if not accepts_pair(prev, nxt, args.require_normalized):
                        continue

                    next_counts[prev_surface][next_surface] += 1
                    total_pairs += 1

                if seen_lines % args.progress_interval == 0:
                    print(
                        f"Processed {seen_lines:,} lines, {total_pairs:,} accepted surface bigrams...",
                        flush=True,
                    )

    return next_counts, unigram_counts, normalized_by_surface, total_pairs, used_lines


def score_followers(next_counts, unigram_counts, normalized_by_surface, args):
    index = {}
    total_unigrams = sum(unigram_counts.values()) or 1

    for head_surface, followers in next_counts.items():
        head_total = sum(followers.values())
        ranked = []

        for next_surface, count in followers.items():
            if count < args.min_count:
                continue

            conditional = count / head_total
            expected = unigram_counts[next_surface] / total_unigrams
            pmi = math.log2(conditional / expected) if expected > 0 else 0
            score = round(conditional * max(1.0, pmi), 6)

            row = [next_surface, count, score]
            next_normalized = normalized_by_surface.get(next_surface, "")
            if next_normalized and next_normalized != next_surface:
                row.append(next_normalized)
            ranked.append(row)

        ranked.sort(key=lambda item: (item[2], item[1]), reverse=True)
        if ranked:
            head_normalized = normalized_by_surface.get(head_surface, "")
            index[head_surface] = [head_normalized, ranked[: args.top_n]]

    return index


def format_source(source):
    if isinstance(source, (list, tuple)):
        return [str(item) for item in source]
    return str(source)


def write_index(output_path, source_path, index, total_pairs, used_lines, args):
    payload = {
        "lang": "ko",
        "source": format_source(source_path),
        "format": "surface_head -> [normalized_head, [[surface_next,count,score,normalized_next?]]]",
        "topN": args.top_n,
        "minCount": args.min_count,
        "requireNormalized": args.require_normalized,
        "minTokenLength": args.min_token_len,
        "maxTokenLength": args.max_token_len,
        "minStemLength": args.min_stem_len,
        "minParticleStemLength": args.min_particle_stem_len,
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
    parser = argparse.ArgumentParser(description="Build a compact Korean surface bigram index with particle-bearing eojeols.")
    parser.add_argument("--corpus", nargs="*", default=None, help="One or more plain-text Korean corpus paths.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--top-n", type=int, default=30)
    parser.add_argument("--min-count", type=int, default=5)
    parser.add_argument("--min-token-len", type=int, default=2)
    parser.add_argument("--max-token-len", type=int, default=12)
    parser.add_argument("--min-stem-len", type=int, default=2)
    parser.add_argument(
        "--min-particle-stem-len",
        type=int,
        default=1,
        help="Minimum dictionary stem length when a surface token is normalized by stripping a Korean particle.",
    )
    parser.add_argument(
        "--require-normalized",
        choices=["head", "next", "both", "any", "none"],
        default="head",
        help="Require a dictionary-normalized token on the selected side before accepting a pair.",
    )
    parser.add_argument("--max-lines", type=int, default=0)
    parser.add_argument("--progress-interval", type=int, default=500000)
    args = parser.parse_args()

    corpus_paths = [pathlib.Path(path).expanduser() for path in args.corpus] if args.corpus else [DEFAULT_CORPUS]
    output_path = pathlib.Path(args.output).expanduser()
    missing_paths = [path for path in corpus_paths if not path.exists()]
    if missing_paths:
        raise SystemExit(f"Corpus file not found: {missing_paths[0]}")

    vocab = load_vocab()
    print(f"Loaded {len(vocab):,} Korean vocabulary words.")
    next_counts, unigram_counts, normalized_by_surface, total_pairs, used_lines = build_counts(corpus_paths, vocab, args)
    print(f"Scoring {len(next_counts):,} surface heads...")
    index = score_followers(next_counts, unigram_counts, normalized_by_surface, args)
    source = corpus_paths if len(corpus_paths) > 1 else corpus_paths[0]
    write_index(output_path, source, index, total_pairs, used_lines, args)
    print(f"Wrote {len(index):,} heads to {output_path}")


if __name__ == "__main__":
    main()
