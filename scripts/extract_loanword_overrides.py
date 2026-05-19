import json
import pathlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict


ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
OUTPUT_FILE = ROOT_DIR / "public" / "data" / "model" / "loanword_overrides.json"
XLSX_PATTERN = "*외래어 표기법*.xlsx"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
CELL_REF_RE = re.compile(r"([A-Z]+)([0-9]+)")
SINGLE_WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'’.-]*$")
KOREAN_FORM_RE = re.compile(r"^[\uAC00-\uD7A3][\uAC00-\uD7A3\s·ㆍ-]*$")
ENGLISH_LABEL = "\uC601\uC5B4"


def col_to_idx(col):
    n = 0
    for ch in col:
        n = n * 26 + ord(ch) - 64
    return n


def cell_text(cell):
    if cell.get("t") == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//m:t", NS)).strip()

    value = cell.find("m:v", NS)
    return (value.text if value is not None else "").strip()


def normalize_key(value):
    value = value.strip().lower().replace("’", "'")
    value = re.sub(r"^the\s+", "", value)
    value = value.strip(" .,")
    return value if SINGLE_WORD_RE.match(value) else ""


def clean_korean_form(value):
    value = re.sub(r"\([^)]*\)", "", value).strip()
    value = re.sub(r"\s+", " ", value)
    return value if KOREAN_FORM_RE.match(value) else ""


def read_rows(xlsx_path):
    with zipfile.ZipFile(xlsx_path) as archive:
        root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    rows = []
    for row in root.findall(".//m:sheetData/m:row", NS):
        values = {}
        for cell in row.findall("m:c", NS):
            match = CELL_REF_RE.match(cell.get("r", ""))
            if not match:
                continue
            values[col_to_idx(match.group(1))] = cell_text(cell)

        if values:
            rows.append([values.get(i, "") for i in range(1, 18)])

    return rows


def build_overrides(rows):
    overrides = defaultdict(list)

    for row in rows[1:]:
        if ENGLISH_LABEL not in (row[5] or ""):
            continue

        key = normalize_key(row[3])
        if not key:
            continue

        for column_idx in [2, 6, 7, 8]:
            form = clean_korean_form(row[column_idx])
            if form and form not in overrides[key]:
                overrides[key].append(form)

    return dict(sorted(overrides.items()))


def resolve_input_path():
    if len(sys.argv) > 1:
        xlsx_path = pathlib.Path(sys.argv[1]).expanduser()
        if not xlsx_path.is_absolute():
            xlsx_path = ROOT_DIR / xlsx_path
        if not xlsx_path.exists():
            raise FileNotFoundError(f"Could not find {xlsx_path}")
        return xlsx_path

    candidates = sorted(ROOT_DIR.glob(XLSX_PATTERN), key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        raise FileNotFoundError(f"No xlsx file matching {XLSX_PATTERN!r} found in {ROOT_DIR}")

    return candidates[0]


def main():
    xlsx_path = resolve_input_path()

    rows = read_rows(xlsx_path)
    overrides = build_overrides(rows)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(
        json.dumps(overrides, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    form_count = sum(len(forms) for forms in overrides.values())
    print(f"Read source: {xlsx_path}")
    print(f"Saved {len(overrides):,} loanword keys and {form_count:,} forms to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
