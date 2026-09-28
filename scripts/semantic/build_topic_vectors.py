"""Build the topic vectors from the LaBSE embeddings.

One shared ko/en meaning space for every lexicon word, in lexicon order:
  centre (subtract the mean vector) -> PCA to 128 dims -> L2-normalise -> 4 bits per value
  (symmetric per-row scale, -7..7), two values per byte.
Cosine of the dequantised rows is the topic similarity; the per-row scale cancels out.
Centring removes the direction every LaBSE vector shares, so unrelated words land near 0
and related words near 1 without any rescaling. PCA128 4-bit was chosen over PCA96 8-bit
(2026-09-28, evaluate_topic_quantization.py): closer to the full vectors and 44% smaller.

Output: public/assets/topic/v1/{topic.json, vectors.bin.gz}. topic.json records the lexicon
binary it was built for; the Worker refuses vectors built for another lexicon. Row w is
lexicon word w. With --extra, vectors-linked.bin.gz holds the meaning words of linked
search that the lexicon lacks (build_linked_surfaces.mjs topic_words.tsv), projected with
the same mean and basis; they continue the row numbering after the lexicon words and are
only downloaded by linked search. Rebuild the linked asset afterwards (build_linked_lexicon.mjs
records these vectors' hash).

Usage:
  node scripts/semantic/export_lexicon_words.mjs WORDS.tsv
  python scripts/semantic/embed_labse.py WORDS.tsv data/derived/semantic_labse/v0
  python scripts/semantic/build_topic_vectors.py WORDS.tsv
  (linked search: python scripts/semantic/embed_labse.py data/derived/linked/v1/topic_words.tsv
   data/derived/semantic_labse/v0-linked, then add --extra data/derived/semantic_labse/v0-linked)
"""
import argparse, gzip, hashlib, json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TAB, NL = chr(9), chr(10)
parser = argparse.ArgumentParser()
parser.add_argument('words', help='fresh export of the current lexicon (export_lexicon_words.mjs)')
parser.add_argument('--embeddings', default=str(ROOT / 'data/derived/semantic_labse/v0'))
parser.add_argument('--dims', type=int, default=128)
parser.add_argument('--extra', help='embeddings directory of extra words (appended rows)')
parser.add_argument('--out', default=str(ROOT / 'public/assets/topic/v1'))
args = parser.parse_args()
if args.dims % 2:
    raise SystemExit('dims must be even (two 4-bit values per byte)')

source = Path(args.embeddings)
embedded = [line.split(TAB)[:2] for line in (source / 'words.tsv').read_text(encoding='utf-8').split(NL) if line]
current = [line.split(TAB)[:2] for line in Path(args.words).read_text(encoding='utf-8').split(NL) if line]
if embedded != current:
    raise SystemExit('embeddings were made for a different lexicon; re-run embed_labse.py')

X = np.load(source / 'embeddings.f16.npy').astype(np.float32)
mean = X.mean(0)
centred = X - mean
sample = np.random.default_rng(1).choice(len(centred), min(60000, len(centred)), replace=False)
_, _, basis = np.linalg.svd(centred[sample], full_matrices=False)


def project(M):
    """Rows as signed 4-bit values (-7..7) in an int8 array."""
    P = (M - mean) @ basis[:args.dims].T
    P /= np.linalg.norm(P, axis=1, keepdims=True)
    Q = np.round(P / (np.abs(P).max(1, keepdims=True) / 7)).astype(np.int8)
    if not (np.abs(Q.astype(np.int16)).max(1) > 0).all():
        raise SystemExit('zero vector after quantisation')
    return Q


def pack(Q):
    """Two values per byte: value + 8 in each nibble, the even dimension in the high nibble."""
    U = (Q.astype(np.int16) + 8).astype(np.uint8)
    return (U[:, 0::2] << 4) | U[:, 1::2]


Q = project(X)
extra_words, E = [], None
if args.extra:
    extra = Path(args.extra)
    extra_words = [line.split(TAB)[:2] for line in (extra / 'words.tsv').read_text(encoding='utf-8').split(NL) if line]
    E = project(np.load(extra / 'embeddings.f16.npy').astype(np.float32))

# Quality record: agreement with the centred full vectors on a few topics.
D = Q.astype(np.float32); D /= np.linalg.norm(D, axis=1, keepdims=True)
Cn = centred / np.linalg.norm(centred, axis=1, keepdims=True)
index = {}
for i, key in enumerate(current): index.setdefault(tuple(key), i)
probe = [index[k] for k in [('ko', '사랑'), ('ko', '돈'), ('ko', '바다'), ('en', 'night'), ('en', 'party')] if k in index]
check = np.random.default_rng(0).choice(len(D), 20000, replace=False)
agreement = float(np.mean([np.corrcoef(Cn[check] @ Cn[t], D[check] @ D[t])[0, 1] for t in probe]))

out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)


def write(name, rows):
    raw = pack(rows).tobytes()
    packed = gzip.compress(raw, 9, mtime=0)
    (out / name).write_bytes(packed)
    return {'file': name, 'gzip_bytes': len(packed), 'gzip_sha256': hashlib.sha256(packed).hexdigest(),
            'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


lexicon = json.loads((ROOT / 'public/assets/lexicon/v1/lexicon.json').read_text(encoding='utf-8'))
manifest = {
    'schema_version': 2, 'model': 'sentence-transformers/LaBSE', 'transform': f'centre, pca{args.dims}, l2, int4-row',
    'dims': args.dims, 'bits': 4, 'packing': 'two values per byte, value + 8, even dimension in the high nibble',
    'count': len(Q), 'lexicon_sha256': lexicon['bin']['sha256'],
    'agreement_with_full_vectors': round(agreement, 4),
    'bin': write('vectors.bin.gz', Q),
}
if E is not None:
    manifest['linked'] = {'count': len(E), 'words_sha256': hashlib.sha256(NL.join(TAB.join(w) for w in extra_words).encode()).hexdigest(),
                          'bin': write('vectors-linked.bin.gz', E)}
(out / 'topic.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + NL, encoding='utf-8', newline=NL)
print(json.dumps({k: v for k, v in manifest.items() if k not in ('bin', 'linked')} | {
    'gzip_mb': round(manifest['bin']['gzip_bytes'] / 1e6, 1),
    'linked_gzip_mb': round(manifest['linked']['bin']['gzip_bytes'] / 1e6, 1) if E is not None else None}, ensure_ascii=False, indent=1))
