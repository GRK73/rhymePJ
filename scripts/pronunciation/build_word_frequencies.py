"""Zipf frequencies for every lexicon word, computed exactly as V1 did.

  ko: exact-token counts of [가-힣]+ runs in Korean Wikipedia (kowikitext 20200920
      train, the corpus scripts/filter_corpus.py used): zipf = log10(count/total) + 9.
  en: wordfreq.zipf_frequency(word, 'en').
Words the source does not contain get null; the engine then applies V1's default
(zipf 1.0). The script verifies that it reproduces V1's stored values.

Usage: python scripts/pronunciation/build_word_frequencies.py
Output: data/derived/lexicon/v1/frequencies.json
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

from wordfreq import zipf_frequency

ROOT = Path(__file__).resolve().parents[2]
CORPUS = Path.home() / "Korpora" / "kowikitext" / "kowikitext_20200920.train"
TABLE = ROOT / "data" / "derived" / "pronunciations_heami" / "v0" / "pronunciations.json"
V1_DICT = ROOT / "public" / "data" / "model" / "rhyme_dict_practical.json"
OUTPUT = ROOT / "data" / "derived" / "lexicon" / "v1" / "frequencies.json"


def korean_zipf(words: set[str]) -> dict[str, float | None]:
    counts = dict.fromkeys(words, 0)
    total = 0
    pattern = re.compile(r"[가-힣]+")
    with CORPUS.open(encoding="utf-8") as corpus:
        for line in corpus:
            for token in pattern.findall(line):
                total += 1
                if token in counts:
                    counts[token] += 1
    print(f"kowikitext tokens: {total:,}")
    return {w: round(math.log10(c / total) + 9, 4) if c else None for w, c in counts.items()}


def main() -> None:
    table = json.loads(TABLE.read_text(encoding="utf-8"))
    ko = korean_zipf(set(table["ko"]))
    en = {}
    for word in table["en_koreanized"]:
        value = zipf_frequency(word, "en")
        en[word] = round(value, 4) if value > 0 else None

    v1 = json.loads(V1_DICT.read_text(encoding="utf-8"))
    checked = mismatched = 0
    examples = []
    for item in v1:
        stored = item.get("zipf")
        computed = (ko if item["lang"] == "ko" else en).get(item["word"])
        if stored is None or computed is None and item["word"] not in (ko if item["lang"] == "ko" else en):
            continue
        checked += 1
        if computed is None or abs(computed - stored) > 1e-4:
            mismatched += 1
            if len(examples) < 10:
                examples.append((item["lang"], item["word"], stored, computed))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"schema_version": 1, "ko": ko, "en": en}, ensure_ascii=False), encoding="utf-8")
    summary = {
        "ko_words": len(ko), "ko_with_zipf": sum(v is not None for v in ko.values()),
        "en_words": len(en), "en_with_zipf": sum(v is not None for v in en.values()),
        "v1_checked": checked, "v1_mismatched": mismatched, "v1_mismatch_examples": examples,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
