"""Zipf frequencies for the linked-search Korean surfaces, computed like the lexicon's
(exact-token counts in kowikitext, build_word_frequencies.korean_zipf).

Usage: python scripts/search/build_linked_frequencies.py
Input : data/derived/linked/v1/surfaces.tsv (build_linked_surfaces.mjs)
Output: data/derived/linked/v1/zipf.json  {surface: zipf | null}
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'pronunciation'))
from build_word_frequencies import korean_zipf  # noqa: E402

DIR = ROOT / 'data' / 'derived' / 'linked' / 'v1'
surfaces = {line.split('\t')[0] for line in (DIR / 'surfaces.tsv').read_text(encoding='utf-8').split('\n') if line}
zipf = korean_zipf(surfaces)
(DIR / 'zipf.json').write_text(json.dumps(zipf, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'surfaces': len(zipf), 'with_zipf': sum(v is not None for v in zipf.values())}))
