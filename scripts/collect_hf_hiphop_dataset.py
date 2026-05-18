import argparse
import shutil
import tempfile
from pathlib import Path

from build_hiphop_stats import DEFAULT_OUTPUT_DIR, build_stats


DEFAULT_DATASET = "sungmogi/en2ko_hiphop"
DEFAULT_COLUMNS = ["translation.ko"]


def load_hf_dataset(dataset_name, split):
    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise SystemExit(
            "The Hugging Face datasets package is required.\n"
            "Install it with: pip install datasets pyarrow"
        ) from exc

    return load_dataset(dataset_name, split=split)


def get_nested_value(row, column):
    value = row
    for part in column.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def pick_columns(row, requested_columns):
    if requested_columns:
        return [column for column in requested_columns if get_nested_value(row, column)]

    for candidates in (["translation.ko"], ["ko"], ["lyrics"], ["text"], ["translation.en"], ["en"]):
        selected = [column for column in candidates if get_nested_value(row, column)]
        if selected:
            return selected

    return [
        key for key, value in row.items()
        if isinstance(value, str) and value.strip()
    ]


def write_dataset_to_temp_files(dataset, columns, temp_dir, max_rows):
    output_path = temp_dir / "hf_hiphop_lines.txt"
    used_rows = 0
    written_lines = 0
    selected_columns = None

    with output_path.open("w", encoding="utf-8", newline="\n") as file:
        for index, row in enumerate(dataset):
            if max_rows and index >= max_rows:
                break

            if selected_columns is None:
                selected_columns = pick_columns(row, columns)
                if not selected_columns:
                    raise SystemExit("Could not find usable text columns in the dataset.")

            parts = []
            for column in selected_columns:
                value = get_nested_value(row, column)
                if isinstance(value, str) and value.strip():
                    parts.append(value.strip())

            if not parts:
                continue

            used_rows += 1
            for part in parts:
                file.write(part.replace("\r\n", "\n").replace("\r", "\n"))
                file.write("\n")
                written_lines += 1

    return {
        "path": output_path,
        "rows": used_rows,
        "lines": written_lines,
        "columns": selected_columns or columns,
    }


def collect_and_build_stats(dataset_name, split, columns, output_dir, min_count, top_n, max_n, max_rows):
    dataset = load_hf_dataset(dataset_name, split)
    temp_root = Path(tempfile.mkdtemp(prefix="rhymePJ_hf_hiphop_"))

    try:
        input_dir = temp_root / "raw"
        input_dir.mkdir(parents=True, exist_ok=True)
        write_info = write_dataset_to_temp_files(dataset, columns, input_dir, max_rows)
        stats = build_stats(
            input_dir,
            output_dir,
            min_count=min_count,
            top_n=top_n,
            max_n=max_n,
        )
        return {
            "dataset": dataset_name,
            "split": split,
            "columns": write_info["columns"],
            "rows": write_info["rows"],
            "lines": write_info["lines"],
            "stats": stats,
        }
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(
        description="Collect a Hugging Face hiphop lyrics dataset into non-raw statistics."
    )
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--split", default="train")
    parser.add_argument("--columns", nargs="*", default=DEFAULT_COLUMNS, help="Text columns to use. Dot paths are supported. Defaults to translation.ko.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--min-count", type=int, default=3)
    parser.add_argument("--top-n", type=int, default=50000)
    parser.add_argument("--max-n", type=int, choices=[2, 3], default=3)
    parser.add_argument("--max-rows", type=int, default=0, help="Optional cap for quick tests.")
    args = parser.parse_args()

    result = collect_and_build_stats(
        dataset_name=args.dataset,
        split=args.split,
        columns=args.columns,
        output_dir=Path(args.output_dir).expanduser(),
        min_count=args.min_count,
        top_n=args.top_n,
        max_n=args.max_n,
        max_rows=args.max_rows,
    )

    print(
        "Collected HF hiphop corpus without preserving raw text: "
        f"{result['dataset']}[{result['split']}], "
        f"columns={','.join(result['columns'])}, "
        f"rows={result['rows']:,}, lines={result['lines']:,}."
    )


if __name__ == "__main__":
    main()
