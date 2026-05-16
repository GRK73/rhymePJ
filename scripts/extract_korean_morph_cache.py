import json
import sys
from pathlib import Path


def is_hangul_word(word: str) -> bool:
    return bool(word) and all("\uac00" <= char <= "\ud7a3" for char in word)


def compact_token(token):
    return [token.form, token.tag, token.start, token.len]


def analyze_words(words):
    from kiwipiepy import Kiwi

    kiwi = Kiwi()
    cache = {}
    for word in words:
        try:
            analyzed = kiwi.analyze(word, top_n=1)
        except Exception:
            continue

        if not analyzed:
            continue

        tokens = analyzed[0][0]
        if not tokens:
            continue

        compact = [compact_token(token) for token in tokens]
        boundaries = []
        for index in range(len(compact) - 1):
            left = compact[index]
            right = compact[index + 1]
            split = left[2] + left[3]
            if split > 0 and split < len(word) and right[2] == split:
                boundaries.append([split, left[1], right[1], left[0], right[0]])

        whole_tag = compact[0][1] if len(compact) == 1 and compact[0][2] == 0 and compact[0][3] == len(word) else ""
        cache[word] = {
            "tag": whole_tag,
            "boundaries": boundaries,
        }

    return cache


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: python scripts/extract_korean_morph_cache.py <dict.json> <output.json>")

    dict_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    dictionary = json.loads(dict_path.read_text(encoding="utf-8"))
    words = sorted({
        item.get("word", "")
        for item in dictionary
        if item.get("lang") == "ko" and is_hangul_word(item.get("word", ""))
    })

    cache = analyze_words(words)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output_path}: {len(cache):,} analyzed Korean words.")


if __name__ == "__main__":
    main()
