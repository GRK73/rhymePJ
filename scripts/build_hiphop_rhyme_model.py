import argparse
import collections
import json
import re
from pathlib import Path

from build_hiphop_stats import trim_counter, write_json


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT_DIR / "public" / "data" / "hiphop_corpus.jsonl"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "public" / "data"
DEFAULT_DICT = ROOT_DIR / "public" / "data" / "rhyme_dict_practical.json"

TOKEN_RE = re.compile(r"[\uAC00-\uD7A3]+|[A-Za-z][A-Za-z']*")
KO_RE = re.compile(r"^[\uAC00-\uD7A3]+$")
EN_RE = re.compile(r"^[a-z][a-z']*$")

KOREAN_CHO = ["k", "k*", "n", "t", "t*", "ɾ", "m", "p", "p*", "s", "s*", "", "tɕ", "tɕ*", "tɕʰ", "kʰ", "tʰ", "pʰ", "h"]
KOREAN_JUNG = ["a", "ɛ", "ja", "jɛ", "ʌ", "e", "jʌ", "je", "o", "wa", "wɛ", "we", "jo", "u", "wʌ", "we", "wi", "ju", "ɯ", "ɰi", "i"]
KOREAN_JONG_MAPPED = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ŋ", "t", "t", "k", "t", "p", "t"]

EN_FALLBACK_DIGRAPHS = {
    "ch": "tʃ",
    "sh": "ʃ",
    "th": "θ",
    "ph": "f",
    "ng": "ŋ",
    "ck": "k",
    "qu": "k",
    "oo": "u",
    "ee": "i",
    "ea": "i",
    "ai": "eɪ",
    "ay": "eɪ",
    "oa": "oʊ",
    "ow": "oʊ",
    "oi": "ɔɪ",
    "oy": "ɔɪ",
}
EN_FALLBACK_CHARS = {
    "a": "ɑ", "b": "b", "c": "k", "d": "d", "e": "ɛ", "f": "f", "g": "ɡ",
    "h": "h", "i": "ɪ", "j": "dʒ", "k": "k", "l": "l", "m": "m", "n": "n",
    "o": "o", "p": "p", "q": "k", "r": "ɹ", "s": "s", "t": "t", "u": "ʌ",
    "v": "v", "w": "w", "x": "k", "y": "i", "z": "z",
}

STOPWORDS = {
    "\ub098", "\ub09c", "\ub108", "\ub10c", "\uc6b0\ub9ac", "\ub0b4", "\ub124",
    "\ub2c8", "\uadf8", "\uc774", "\uc800", "\uac83", "\uc218", "\ub54c",
    "\ub610", "\ub354", "\ub2e4", "\ub2e4\uc2dc", "\uc544\uc9c1", "\uc774\uc81c",
    "\uc624\ub298", "a", "an", "the", "and", "or", "but", "to", "of", "in",
    "on", "at", "for", "with", "without", "i", "me", "my", "you", "your",
    "we", "our", "it", "is", "are", "was", "were",
}

SECTION_MARKER_RE = re.compile(
    r"^\s*(verse|ver\.?|hook|chorus|intro|outro|bridge|refrain|pre[- ]?hook|"
    r"\uc778\ud2b8\ub85c|\ud6c4\ub834|\ubc8c\uc2a4|\ube0c\ub9bf\uc9c0)"
    r"[\s#.:0-9()x\u00d7-]*$",
    re.IGNORECASE,
)


def iter_jsonl_documents(path):
    if not path.exists():
        raise SystemExit(f"Input JSONL not found: {path}")
    with path.open("r", encoding="utf-8", errors="ignore") as file:
        for line_no, line in enumerate(file, 1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                row = json.loads(stripped)
            except json.JSONDecodeError as error:
                raise SystemExit(f"Invalid JSONL at line {line_no}: {error}") from error

            text = row.get("lyrics") or row.get("text") or row.get("content") or ""
            title = row.get("title") or row.get("song") or row.get("id") or f"line:{line_no}"
            if isinstance(text, str) and text.strip():
                yield str(title), text


def normalize_token(raw):
    token = raw.strip().replace("\u2019", "'").replace("\u2018", "'")
    if not token:
        return ""
    if KO_RE.match(token):
        return token
    lowered = token.lower().strip("'")
    return lowered if EN_RE.match(lowered) else ""


def word_variants(word):
    variants = [word]
    if "'" in word:
        variants.append(word.replace("'", ""))
        variants.append(word.split("'")[0])
    if word.endswith("in'") and len(word) > 4:
        variants.append(word[:-3] + "ing")
    if word.endswith("'s") and len(word) > 3:
        variants.append(word[:-2])
    if word.endswith("s") and len(word) > 4:
        variants.append(word[:-1])
    if word.endswith("es") and len(word) > 5:
        variants.append(word[:-2])
    if word.endswith("ed") and len(word) > 5:
        variants.append(word[:-2])

    seen = set()
    deduped = []
    for variant in variants:
        if variant and variant not in seen:
            seen.add(variant)
            deduped.append(variant)
    return deduped


def load_phoneme_lookup(dict_path):
    lookup = {"ko": {}, "en": {}}
    path = Path(dict_path).expanduser()
    if not path.exists():
        return lookup

    data = json.loads(path.read_text(encoding="utf-8"))
    for item in data:
        lang = item.get("lang")
        if lang not in lookup:
            continue
        word = normalize_token(str(item.get("word", "")))
        phonemes = item.get("phonemes") or item.get("vowels") or []
        if not word or not isinstance(phonemes, list) or not phonemes:
            continue
        current = lookup[lang].get(word)
        if current is None or len(phonemes) > len(current):
            lookup[lang][word] = [str(phoneme) for phoneme in phonemes if phoneme]
    return lookup


def tokenize(line, keep_stopwords=False):
    tokens = []
    for raw in TOKEN_RE.findall(line):
        token = normalize_token(raw)
        if not token:
            continue
        if not keep_stopwords and token in STOPWORDS:
            continue
        tokens.append(token)
    return tokens


def korean_fallback_phonemes(word):
    phonemes = []
    for char in word:
        code = ord(char)
        if 0xAC00 <= code <= 0xD7A3:
            offset = code - 0xAC00
            final = offset % 28
            medial = ((offset - final) // 28) % 21
            initial = offset // (28 * 21)
            if KOREAN_CHO[initial]:
                phonemes.append(KOREAN_CHO[initial])
            phonemes.append(KOREAN_JUNG[medial])
            if KOREAN_JONG_MAPPED[final]:
                phonemes.append(KOREAN_JONG_MAPPED[final])
    return phonemes


def english_fallback_phonemes(word):
    normalized = re.sub(r"([a-z])\1{2,}", r"\1\1", word.lower().replace("'", ""))
    phonemes = []
    index = 0
    while index < len(normalized):
        pair = normalized[index:index + 2]
        if pair in EN_FALLBACK_DIGRAPHS:
            phonemes.append(EN_FALLBACK_DIGRAPHS[pair])
            index += 2
            continue
        phoneme = EN_FALLBACK_CHARS.get(normalized[index])
        if phoneme:
            phonemes.append(phoneme)
        index += 1
    return phonemes


def token_to_phonemes(token, lookup):
    normalized = normalize_token(token)
    if not normalized:
        return []
    if KO_RE.match(normalized):
        return lookup["ko"].get(normalized) or korean_fallback_phonemes(normalized)
    if EN_RE.match(normalized):
        for variant in word_variants(normalized):
            phonemes = lookup["en"].get(variant)
            if phonemes:
                return phonemes
        return english_fallback_phonemes(normalized)
    return []


def split_lyrics(text, max_line_chars):
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or SECTION_MARKER_RE.match(line):
            continue
        if max_line_chars and len(line) > max_line_chars:
            chunks = re.split(r"\s{2,}| / | \| ", line)
            for chunk in chunks:
                chunk = chunk.strip()
                if chunk and len(chunk) <= max_line_chars:
                    yield chunk
            continue
        yield line


def phoneme_signature(phonemes, width):
    if len(phonemes) < width:
        return ""
    return "|".join(phonemes[-width:])


def update_internal_rhymes(token_phonemes, signature_line_counts, signature_repeat_counts, max_width):
    has_internal = False
    for width in range(1, max_width + 1):
        signatures = [
            phoneme_signature(phonemes, width)
            for phonemes in token_phonemes
            if len(phonemes) >= width
        ]
        counter = collections.Counter(signature for signature in signatures if signature)
        for signature, count in counter.items():
            if count >= 2:
                signature_line_counts[width][signature] += 1
                signature_repeat_counts[width][signature] += count
                has_internal = True
    return has_internal


def trim_nested_signature_examples(signature_examples, min_count, top_n, examples_per_signature):
    rows = []
    for signature, counter in signature_examples.items():
        total = sum(counter.values())
        if total < min_count:
            continue
        examples = trim_counter(counter, 1, examples_per_signature)
        rows.append({
            "signature": signature,
            "count": total,
            "endingPhonemes": [[word, count] for word, count in examples],
        })
    rows.sort(key=lambda row: (row["count"], row["signature"]), reverse=True)
    return rows[:top_n] if top_n > 0 else rows


def build_model(args):
    input_path = Path(args.input_jsonl).expanduser()
    output_dir = Path(args.output_dir).expanduser()
    lookup = load_phoneme_lookup(args.dict)

    ending_counter = collections.Counter()
    phoneme_ngram_counters = {n: collections.Counter() for n in range(1, args.max_n + 1)}
    signature_counters = {width: collections.Counter() for width in range(1, args.max_width + 1)}
    signature_examples = {width: collections.defaultdict(collections.Counter) for width in range(1, args.max_width + 1)}
    transition_counter = collections.Counter()
    internal_line_counts = {width: collections.Counter() for width in range(1, args.max_width + 1)}
    internal_repeat_counts = {width: collections.Counter() for width in range(1, args.max_width + 1)}
    line_token_bucket = collections.Counter()
    language_counter = collections.Counter()

    document_count = 0
    line_count = 0
    usable_line_count = 0
    token_count = 0
    internal_rhyme_line_count = 0
    converted_token_count = 0
    fallback_token_count = 0
    skipped_token_count = 0
    previous_signature = None

    for _, text in iter_jsonl_documents(input_path):
        document_count += 1
        previous_signature = None
        for line in split_lyrics(text, args.max_line_chars):
            line_count += 1
            tokens_with_stopwords = tokenize(line, keep_stopwords=True)
            tokens = tokenize(line, keep_stopwords=False)
            if not tokens_with_stopwords:
                continue

            token_phonemes_with_stopwords = []
            token_phonemes = []
            for token in tokens_with_stopwords:
                phonemes = token_to_phonemes(token, lookup)
                if phonemes:
                    token_phonemes_with_stopwords.append(phonemes)
                else:
                    skipped_token_count += 1

            for token in tokens:
                had_direct_lookup = bool(
                    (KO_RE.match(token) and lookup["ko"].get(token))
                    or (EN_RE.match(token) and any(lookup["en"].get(variant) for variant in word_variants(token)))
                )
                phonemes = token_to_phonemes(token, lookup)
                if phonemes:
                    token_phonemes.append(phonemes)
                    converted_token_count += 1
                    if not had_direct_lookup:
                        fallback_token_count += 1
                else:
                    skipped_token_count += 1

            if not token_phonemes_with_stopwords:
                continue

            usable_line_count += 1
            token_count += len(tokens)
            line_phonemes = [phoneme for phonemes in token_phonemes for phoneme in phonemes]
            for n, counter in phoneme_ngram_counters.items():
                if len(line_phonemes) < n:
                    continue
                for index in range(len(line_phonemes) - n + 1):
                    counter[tuple(line_phonemes[index:index + n])] += 1

            for token in tokens:
                if KO_RE.match(token):
                    language_counter["ko"] += 1
                elif EN_RE.match(token):
                    language_counter["en"] += 1

            ending_phonemes = token_phonemes_with_stopwords[-1]
            ending_key = "|".join(ending_phonemes)
            ending_counter[ending_key] += 1
            for width, counter in signature_counters.items():
                signature = phoneme_signature(ending_phonemes, width)
                if signature:
                    counter[signature] += 1
                    signature_examples[width][signature][ending_key] += 1

            transition_signature = phoneme_signature(ending_phonemes, min(2, args.max_width))
            if previous_signature and transition_signature:
                transition_counter[(previous_signature, transition_signature)] += 1
            previous_signature = transition_signature or previous_signature

            if update_internal_rhymes(token_phonemes, internal_line_counts, internal_repeat_counts, args.max_width):
                internal_rhyme_line_count += 1

            bucket_key = str(min(len(tokens_with_stopwords), 24))
            line_token_bucket[bucket_key] += 1

        if document_count % 500 == 0:
            print(f"Processed {document_count:,} songs, {usable_line_count:,} usable lines...", flush=True)

    metadata = {
        "source": str(input_path),
        "rawTextIncluded": False,
        "documentCount": document_count,
        "lineCount": line_count,
        "usableLineCount": usable_line_count,
        "tokenCount": token_count,
        "internalRhymeLineCount": internal_rhyme_line_count,
        "internalRhymeLineRate": round(internal_rhyme_line_count / usable_line_count, 6) if usable_line_count else 0,
        "languageTokenCounts": dict(language_counter),
        "convertedTokenCount": converted_token_count,
        "fallbackTokenCount": fallback_token_count,
        "skippedTokenCount": skipped_token_count,
        "conversionRate": round(converted_token_count / token_count, 6) if token_count else 0,
        "minCount": args.min_count,
        "topN": args.top_n,
        "maxWidth": args.max_width,
        "maxN": args.max_n,
    }

    rhyme_model = {
        "metadata": metadata,
        "format": "phoneme-only line ending and rhyme signature counts; no raw lyric text or raw ending words",
        "lineEndings": [[key, count] for key, count in trim_counter(ending_counter, args.min_count, args.top_n)],
        "rhymeSignatures": {
            str(width): [[key, count] for key, count in trim_counter(counter, args.min_count, args.top_n)]
            for width, counter in signature_counters.items()
        },
        "signatureEndings": {
            str(width): trim_nested_signature_examples(
                signature_examples[width],
                args.min_count,
                args.top_n,
                args.examples_per_signature,
            )
            for width in range(1, args.max_width + 1)
        },
        "lineEndingTransitions": [
            [" -> ".join(key), count]
            for key, count in trim_counter(transition_counter, args.min_count, args.top_n)
        ],
        "lineTokenBuckets": dict(sorted(line_token_bucket.items(), key=lambda item: int(item[0]))),
    }

    phoneme_ngram_model = {
        "metadata": metadata,
        "format": "line-level mixed Korean/English phoneme n-gram -> count",
        "ngrams": {
            str(n): [["|".join(key), count] for key, count in trim_counter(counter, args.min_count, args.top_n)]
            for n, counter in phoneme_ngram_counters.items()
        },
    }

    internal_model = {
        "metadata": metadata,
        "format": "in-line repeated rhyme signature -> aggregate repeat count and line count",
        "signatures": {
            str(width): [
                {
                    "signature": signature,
                    "repeatCount": repeat_count,
                    "lineCount": internal_line_counts[width][signature],
                }
                for signature, repeat_count in trim_counter(counter, args.min_count, args.top_n)
            ]
            for width, counter in internal_repeat_counts.items()
        },
    }

    write_json(output_dir / "hiphop_rhyme_patterns_ko.json", rhyme_model)
    write_json(output_dir / "hiphop_internal_rhyme_patterns_ko.json", internal_model)
    write_json(output_dir / "hiphop_phoneme_ngram_ko.json", phoneme_ngram_model)
    return metadata


def main():
    parser = argparse.ArgumentParser(description="Build Korean hiphop rhyme models from a JSONL lyric corpus.")
    parser.add_argument("--input-jsonl", default=str(DEFAULT_INPUT), help="JSONL with a lyrics/text field.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for generated model JSON.")
    parser.add_argument("--dict", default=str(DEFAULT_DICT), help="Rhyme dictionary with Korean/English phonemes.")
    parser.add_argument("--min-count", type=int, default=3, help="Drop patterns below this count.")
    parser.add_argument("--top-n", type=int, default=50000, help="Maximum rows per output list. Use 0 for no cap.")
    parser.add_argument("--max-width", type=int, default=3, choices=[1, 2, 3], help="Max suffix/signature width.")
    parser.add_argument("--max-n", type=int, default=5, choices=[2, 3, 4, 5], help="Max phoneme n-gram size.")
    parser.add_argument("--max-line-chars", type=int, default=220, help="Skip or split unusually long raw lines.")
    parser.add_argument("--examples-per-signature", type=int, default=18, help="Ending words retained per signature.")
    args = parser.parse_args()

    metadata = build_model(args)
    print(
        "Built hiphop rhyme model: "
        f"{metadata['documentCount']:,} songs, "
        f"{metadata['usableLineCount']:,} usable lines, "
        f"{metadata['tokenCount']:,} kept tokens, "
        f"{metadata['conversionRate']:.1%} converted tokens, "
        f"{metadata['internalRhymeLineRate']:.1%} internal-rhyme lines."
    )


if __name__ == "__main__":
    main()
