import argparse
import json
import math
from pathlib import Path

from build_hiphop_stats import write_json


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT_DIR / "public" / "data" / "model"


def load_json(path):
    path = Path(path).expanduser()
    if not path.exists():
        raise SystemExit(f"Model not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_count(count, max_count):
    if not count or not max_count:
        return 0
    return round(math.log1p(count) / math.log1p(max_count), 6)


def rows_from_pair_list(rows):
    for row in rows or []:
        if not isinstance(row, list) or len(row) < 2:
            continue
        signature = str(row[0] or "")
        count = int(row[1] or 0)
        if signature and count > 0:
            yield signature, count


def rows_from_object_list(rows, signature_key):
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        signature = str(row.get(signature_key) or row.get("signature") or "")
        repeat_count = int(row.get("repeatCount") or row.get("count") or 0)
        line_count = int(row.get("lineCount") or 0)
        if signature and (repeat_count > 0 or line_count > 0):
            yield signature, repeat_count, line_count


def collect_korean_sources(ending_model, internal_model):
    ending_by_width = {}
    for width, rows in (ending_model.get("rhymeSignatures") or {}).items():
        ending_by_width[str(width)] = {signature: count for signature, count in rows_from_pair_list(rows)}

    internal_by_width = {}
    for width, rows in (internal_model.get("signatures") or {}).items():
        internal_by_width[str(width)] = {
            signature: {"repeatCount": repeat_count, "lineCount": line_count}
            for signature, repeat_count, line_count in rows_from_object_list(rows, "signature")
        }
    return ending_by_width, internal_by_width


def collect_english_sources(ending_model, internal_model):
    ending_by_width = {}
    for width, rows in (ending_model.get("suffixes") or {}).items():
        ending_by_width[str(width)] = {signature: count for signature, count in rows_from_pair_list(rows)}

    internal_by_width = {}
    for width, rows in (internal_model.get("suffixes") or {}).items():
        internal_by_width[str(width)] = {
            signature: {"repeatCount": repeat_count, "lineCount": line_count}
            for signature, repeat_count, line_count in rows_from_object_list(rows, "suffix")
        }
    return ending_by_width, internal_by_width


def build_rows(ending_by_width, internal_by_width, min_count, top_n):
    widths = sorted(
        set(ending_by_width) | set(internal_by_width),
        key=lambda value: int(value) if str(value).isdigit() else value,
    )
    ending_rows = {}
    internal_rows = {}
    combined_rows = {}

    for width in widths:
        ending = ending_by_width.get(width, {})
        internal = internal_by_width.get(width, {})
        max_ending = max(ending.values(), default=0)
        max_internal_repeat = max((row["repeatCount"] for row in internal.values()), default=0)
        max_internal_line = max((row["lineCount"] for row in internal.values()), default=0)

        ending_list = []
        for signature, count in ending.items():
            if count < min_count:
                continue
            ending_list.append({
                "signature": signature,
                "count": count,
                "score": normalize_count(count, max_ending),
            })
        ending_list.sort(key=lambda row: (row["score"], row["count"], row["signature"]), reverse=True)
        ending_rows[width] = ending_list[:top_n] if top_n > 0 else ending_list

        internal_list = []
        for signature, row in internal.items():
            if max(row["repeatCount"], row["lineCount"]) < min_count:
                continue
            repeat_score = normalize_count(row["repeatCount"], max_internal_repeat)
            line_score = normalize_count(row["lineCount"], max_internal_line)
            internal_list.append({
                "signature": signature,
                "repeatCount": row["repeatCount"],
                "lineCount": row["lineCount"],
                "score": round(max(repeat_score, line_score), 6),
            })
        internal_list.sort(key=lambda row: (row["score"], row["lineCount"], row["repeatCount"], row["signature"]), reverse=True)
        internal_rows[width] = internal_list[:top_n] if top_n > 0 else internal_list

        signatures = set(ending) | set(internal)
        combined_list = []
        for signature in signatures:
            ending_count = ending.get(signature, 0)
            internal_row = internal.get(signature, {"repeatCount": 0, "lineCount": 0})
            if max(ending_count, internal_row["repeatCount"], internal_row["lineCount"]) < min_count:
                continue
            ending_score = normalize_count(ending_count, max_ending)
            repeat_score = normalize_count(internal_row["repeatCount"], max_internal_repeat)
            line_score = normalize_count(internal_row["lineCount"], max_internal_line)
            score = round(max(ending_score * 0.9, repeat_score * 0.75, line_score), 6)
            role = "both" if ending_count and internal_row["lineCount"] else "ending" if ending_count else "internal"
            combined_list.append({
                "signature": signature,
                "endingCount": ending_count,
                "internalRepeatCount": internal_row["repeatCount"],
                "internalLineCount": internal_row["lineCount"],
                "score": score,
                "role": role,
            })
        combined_list.sort(
            key=lambda row: (
                row["score"],
                row["internalLineCount"],
                row["endingCount"],
                row["internalRepeatCount"],
                row["signature"],
            ),
            reverse=True,
        )
        combined_rows[width] = combined_list[:top_n] if top_n > 0 else combined_list

    return ending_rows, internal_rows, combined_rows


def build_model(language, ending_model, internal_model, min_count, top_n):
    if language == "ko":
        ending_by_width, internal_by_width = collect_korean_sources(ending_model, internal_model)
    elif language == "en":
        ending_by_width, internal_by_width = collect_english_sources(ending_model, internal_model)
    else:
        raise SystemExit(f"Unsupported language: {language}")

    ending_rows, internal_rows, combined_rows = build_rows(ending_by_width, internal_by_width, min_count, top_n)
    source_meta = {
        "ending": ending_model.get("metadata") or {},
        "internal": internal_model.get("metadata") or {},
    }
    return {
        "metadata": {
            "language": language,
            "rawTextIncluded": False,
            "sourceModels": source_meta,
            "minCount": min_count,
            "topN": top_n,
            "widths": sorted(combined_rows.keys(), key=lambda value: int(value) if str(value).isdigit() else value),
        },
        "format": "structural rhyme rule model; phoneme suffix signatures scored for ending and internal span use",
        "weights": {
            "ending": 0.9,
            "internalRepeat": 0.75,
            "internalLine": 1.0,
        },
        "ending": ending_rows,
        "internal": internal_rows,
        "combined": combined_rows,
    }


def main():
    parser = argparse.ArgumentParser(description="Build structural rhyme rule models from existing English/Korean rhyme statistics.")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    parser.add_argument("--min-count", type=int, default=3)
    parser.add_argument("--top-n", type=int, default=50000)
    args = parser.parse_args()

    data_dir = Path(args.data_dir).expanduser()
    builds = [
        (
            "ko",
            data_dir / "hiphop_rhyme_patterns_ko.json",
            data_dir / "hiphop_internal_rhyme_patterns_ko.json",
            data_dir / "structural_rhyme_rules_ko.json",
        ),
        (
            "en",
            data_dir / "english_hiphop_ending_phoneme_patterns.json",
            data_dir / "english_hiphop_internal_rhyme_patterns.json",
            data_dir / "structural_rhyme_rules_en.json",
        ),
    ]

    for language, ending_path, internal_path, output_path in builds:
        model = build_model(
            language,
            load_json(ending_path),
            load_json(internal_path),
            args.min_count,
            args.top_n,
        )
        write_json(output_path, model)
        combined_count = sum(len(rows) for rows in model["combined"].values())
        print(f"Built {language} structural rhyme rules: {combined_count:,} combined signatures -> {output_path}")


if __name__ == "__main__":
    main()
