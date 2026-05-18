import argparse
import collections
import json
import math
import re
from pathlib import Path

from build_hiphop_stats import DEFAULT_OUTPUT_DIR, trim_counter, write_json
from build_translated_hiphop_semantics import DEFAULT_DATASET, clean_english_line, iter_hiphop_lyrics, split_lyric_to_lines


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DICT = ROOT_DIR / "public" / "data" / "rhyme_dict_practical.json"

WORD_RE = re.compile(r"[A-Za-z][A-Za-z']*")
VOWEL_PHONEMES = {
    "i", "ɯ", "u", "ɛ", "ʌ", "o", "a", "ɑ", "æ", "e", "ɔ", "ɪ", "ʊ", "ə", "ɚ",
    "aɪ", "eɪ", "ɔɪ", "aʊ", "oʊ", "ju", "jʌ", "jo", "jɛ", "ja", "je",
    "wi", "wʌ", "wɛ", "wa", "we", "ɰi",
}


def normalize_word(raw):
    word = raw.strip().lower().replace("\u2019", "'").replace("\u2018", "'").strip("'")
    return re.sub(r"[^a-z']", "", word)


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
    for item in variants:
        if item and item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped


def load_english_phoneme_dict(dict_path):
    data = json.loads(dict_path.read_text(encoding="utf-8"))
    lookup = {}
    for item in data:
        if item.get("lang") != "en":
            continue
        word = normalize_word(str(item.get("word", "")))
        phonemes = item.get("phonemes") or item.get("vowels") or []
        if word and isinstance(phonemes, list) and phonemes:
            current = lookup.get(word)
            if current is None or len(phonemes) > len(current):
                lookup[word] = phonemes
    return lookup


def lookup_phonemes(word, phoneme_lookup):
    for variant in word_variants(word):
        phonemes = phoneme_lookup.get(variant)
        if phonemes:
            return phonemes
    return None


def extract_words(line):
    return [normalize_word(match) for match in WORD_RE.findall(line)]


def is_vowel(phoneme):
    return phoneme in VOWEL_PHONEMES


def bucket(value, size):
    if value <= 0:
        return "0"
    start = ((value - 1) // size) * size + 1
    end = start + size - 1
    return f"{start}-{end}"


def update_phoneme_ngrams(phonemes, counters, max_n):
    for n in range(1, max_n + 1):
        if len(phonemes) < n:
            continue
        counter = counters[n]
        for index in range(len(phonemes) - n + 1):
            counter[tuple(phonemes[index:index + n])] += 1


def trim_tuple_counter(counter, min_count, top_n):
    rows = [
        (key, count)
        for key, count in counter.items()
        if count >= min_count
    ]
    rows.sort(key=lambda item: (item[1], item[0]), reverse=True)
    if top_n > 0:
        rows = rows[:top_n]
    return rows


def build_phonetic_patterns(args):
    phoneme_lookup = load_english_phoneme_dict(Path(args.dict).expanduser())

    ngram_counters = {n: collections.Counter() for n in range(1, args.max_n + 1)}
    ending_counters = {width: collections.Counter() for width in range(1, args.max_suffix + 1)}
    ending_full_counter = collections.Counter()
    internal_suffix_counts = {width: collections.Counter() for width in range(1, args.max_suffix + 1)}
    internal_suffix_line_counts = {width: collections.Counter() for width in range(1, args.max_suffix + 1)}
    line_word_count_buckets = collections.Counter()
    line_phoneme_count_buckets = collections.Counter()
    line_vowel_count_buckets = collections.Counter()
    line_match_ratio_buckets = collections.Counter()
    unmatched_counter = collections.Counter()

    song_count = 0
    line_count = 0
    usable_line_count = 0
    word_count = 0
    matched_word_count = 0
    phoneme_count = 0
    vowel_count = 0
    internal_rhyme_line_count = 0

    for lyric in iter_hiphop_lyrics(args.dataset, args.genre, args.max_songs):
        song_count += 1
        for raw_line in split_lyric_to_lines(lyric, args.max_line_chars):
            line = clean_english_line(raw_line)
            words = [word for word in extract_words(line) if word]
            if not words:
                continue
            line_count += 1
            word_count += len(words)

            line_word_phonemes = []
            line_phonemes = []
            matched_words = 0
            for word in words:
                phonemes = lookup_phonemes(word, phoneme_lookup)
                if not phonemes:
                    unmatched_counter[word] += 1
                    continue
                matched_words += 1
                matched_word_count += 1
                line_word_phonemes.append(phonemes)
                line_phonemes.extend(phonemes)

            if not line_phonemes:
                continue

            usable_line_count += 1
            phoneme_count += len(line_phonemes)
            line_vowels = sum(1 for phoneme in line_phonemes if is_vowel(phoneme))
            vowel_count += line_vowels

            update_phoneme_ngrams(line_phonemes, ngram_counters, args.max_n)
            line_word_count_buckets[bucket(len(words), 4)] += 1
            line_phoneme_count_buckets[bucket(len(line_phonemes), 8)] += 1
            line_vowel_count_buckets[bucket(line_vowels, 4)] += 1
            match_ratio = matched_words / len(words)
            line_match_ratio_buckets[f"{math.floor(match_ratio * 10) / 10:.1f}"] += 1

            ending = line_word_phonemes[-1]
            ending_full_counter[tuple(ending)] += 1
            for width, counter in ending_counters.items():
                if len(ending) >= width:
                    counter[tuple(ending[-width:])] += 1

            line_has_internal_rhyme = False
            for width in range(1, args.max_suffix + 1):
                suffixes = [
                    tuple(phonemes[-width:])
                    for phonemes in line_word_phonemes
                    if len(phonemes) >= width
                ]
                suffix_counter = collections.Counter(suffixes)
                for suffix, count in suffix_counter.items():
                    if count >= 2:
                        internal_suffix_counts[width][suffix] += count
                        internal_suffix_line_counts[width][suffix] += 1
                        line_has_internal_rhyme = True
            if line_has_internal_rhyme:
                internal_rhyme_line_count += 1

        if song_count % 500 == 0:
            print(f"Processed {song_count:,} Hip Hop songs, {usable_line_count:,} phonetic lines...", flush=True)

    metadata = {
        "dataset": args.dataset,
        "genre": args.genre,
        "rawTextIncluded": False,
        "dict": str(Path(args.dict).expanduser()),
        "songCount": song_count,
        "lineCount": line_count,
        "usableLineCount": usable_line_count,
        "wordCount": word_count,
        "matchedWordCount": matched_word_count,
        "matchRate": round(matched_word_count / word_count, 6) if word_count else 0,
        "phonemeCount": phoneme_count,
        "vowelPhonemeCount": vowel_count,
        "internalRhymeLineCount": internal_rhyme_line_count,
        "internalRhymeLineRate": round(internal_rhyme_line_count / usable_line_count, 6) if usable_line_count else 0,
        "minCount": args.min_count,
        "topN": args.top_n,
        "maxN": args.max_n,
        "maxSuffix": args.max_suffix,
    }

    output_dir = Path(args.output_dir).expanduser()
    write_json(
        output_dir / "english_hiphop_ipa_ngram.json",
        {
            "metadata": metadata,
            "format": "phoneme n-gram -> count",
            "ngrams": {
                str(n): [["|".join(key), count] for key, count in trim_tuple_counter(counter, args.min_count, args.top_n)]
                for n, counter in ngram_counters.items()
            },
        },
    )

    write_json(
        output_dir / "english_hiphop_ending_phoneme_patterns.json",
        {
            "metadata": metadata,
            "format": "line ending phoneme suffix -> count",
            "fullEndings": [["|".join(key), count] for key, count in trim_tuple_counter(ending_full_counter, args.min_count, args.top_n)],
            "suffixes": {
                str(width): [["|".join(key), count] for key, count in trim_tuple_counter(counter, args.min_count, args.top_n)]
                for width, counter in ending_counters.items()
            },
        },
    )

    write_json(
        output_dir / "english_hiphop_internal_rhyme_patterns.json",
        {
            "metadata": metadata,
            "format": "repeated in-line phoneme suffix -> aggregate repeat count and line count",
            "suffixes": {
                str(width): [
                    {
                        "suffix": "|".join(key),
                        "repeatCount": count,
                        "lineCount": internal_suffix_line_counts[width][key],
                    }
                    for key, count in trim_tuple_counter(counter, args.min_count, args.top_n)
                ]
                for width, counter in internal_suffix_counts.items()
            },
        },
    )

    write_json(
        output_dir / "english_hiphop_flow_shape_stats.json",
        {
            "metadata": metadata,
            "lineWordCountBuckets": dict(sorted(line_word_count_buckets.items())),
            "linePhonemeCountBuckets": dict(sorted(line_phoneme_count_buckets.items())),
            "lineVowelCountBuckets": dict(sorted(line_vowel_count_buckets.items())),
            "lineMatchRatioBuckets": dict(sorted(line_match_ratio_buckets.items())),
            "topUnmatchedWords": [[word, count] for word, count in trim_counter(unmatched_counter, args.min_count, 500)],
        },
    )

    return metadata


def main():
    parser = argparse.ArgumentParser(description="Build English Hip Hop IPA rhyme and flow pattern statistics.")
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--genre", default="Hip Hop")
    parser.add_argument("--dict", default=str(DEFAULT_DICT))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--max-songs", type=int, default=0)
    parser.add_argument("--max-line-chars", type=int, default=220)
    parser.add_argument("--max-n", type=int, choices=[2, 3, 4, 5], default=5)
    parser.add_argument("--max-suffix", type=int, default=6)
    parser.add_argument("--min-count", type=int, default=3)
    parser.add_argument("--top-n", type=int, default=50000)
    args = parser.parse_args()

    metadata = build_phonetic_patterns(args)
    print(
        "Built English Hip Hop phonetic patterns: "
        f"{metadata['songCount']:,} songs, "
        f"{metadata['usableLineCount']:,} usable lines, "
        f"{metadata['matchRate']:.2%} word match rate."
    )


if __name__ == "__main__":
    main()
