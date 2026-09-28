"""How much topic quality each compression of the LaBSE vectors loses.

Reference: the full 768-dim LaBSE vectors, centred (the space the topic score lives in).
Each scheme stores every lexicon word; similarity is the cosine of the stored vectors.
Measured over ~200 topic words (the old Korean topic list and their English translations):
  corr      correlation of topic similarities with the reference (20k random words)
  top1000   share of the reference's 1000 most related words the scheme also ranks in its top 1000
  |Δs|      mean / 99th-percentile absolute similarity error; at topic weight 10 a word's score
            changes by score * 0.35 * Δs, so "Δ90p99" is that change for a 90-point word
  vs_now    top-1000 overlap with the shipped scheme (pca96 int8), i.e. what users would notice
  ko→en@10  Korean topic finds its English translation in the top 10 of all English words
  gzip_mb   download size of the codes (+ codebooks)

Usage: python scripts/semantic/evaluate_topic_quantization.py WORDS.tsv [--out report.json]
"""
import argparse, gzip, json, time
from pathlib import Path
import numpy as np
from sklearn.cluster import MiniBatchKMeans

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('words')
parser.add_argument('--embeddings', default=str(ROOT / 'data/derived/semantic_labse/v0'))
parser.add_argument('--topics', default=str(ROOT / 'data/derived/semantic_labse/topic_eval_words.json'))
parser.add_argument('--out', default=str(ROOT / 'reports/generated/topic_quantization.json'))
args = parser.parse_args()

rows = [line.split('\t')[:2] for line in Path(args.words).read_text(encoding='utf-8').split('\n') if line]
X = np.load(Path(args.embeddings) / 'embeddings.f16.npy').astype(np.float32)
assert len(rows) == len(X)
index = {}
for i, key in enumerate(rows): index.setdefault(tuple(key), i)
lang = np.array([r[0] for r in rows])
en_ids = np.where(lang == 'en')[0]

mean = X.mean(0)
C = X - mean
R = C / np.linalg.norm(C, axis=1, keepdims=True)
sample = np.random.default_rng(1).choice(len(C), 60000, replace=False)
_, _, basis = np.linalg.svd(C[sample], full_matrices=False)

pairs = json.loads(Path(args.topics).read_text(encoding='utf-8'))  # {ko: [en, ...]}
topics = sorted({index[('ko', k)] for k in pairs if ('ko', k) in index}
                | {index[('en', v)] for vs in pairs.values() for v in vs if ('en', v) in index})
test = [(index[('ko', k)], index[('en', v)]) for k, vs in pairs.items() for v in vs if ('ko', k) in index and ('en', v) in index]
check = np.random.default_rng(0).choice(len(R), 20000, replace=False)
print(f'{len(topics)} topics, {len(test)} ko-en pairs')

def top_sets(M, k=1000):
    S = M[topics] @ M.T                                        # topics x words
    return [set(np.argpartition(-row, k)[:k]) for row in S], S

ref_top, ref_S = top_sets(R)

def row_quant(P, bits):
    """Symmetric per-row quantisation to `bits` (per-row scale cancels in the cosine)."""
    levels = 2 ** (bits - 1) - 1
    scale = np.abs(P).max(1, keepdims=True) / levels
    return np.round(P / scale).astype(np.int8)

def packed_size(Q, bits):
    if bits == 8: return len(gzip.compress(Q.tobytes(), 6))
    U = (Q.astype(np.int16) + 8).astype(np.uint8)              # 4-bit: two per byte
    if U.shape[1] % 2: U = np.pad(U, ((0, 0), (0, 1)))
    return len(gzip.compress((U[:, 0::2] << 4 | U[:, 1::2]).tobytes(), 6))

def pca(dims):
    P = C @ basis[:dims].T
    return P / np.linalg.norm(P, axis=1, keepdims=True)

def pq(P, m, ks=256):
    """Product quantisation: m subspaces, 256 centroids each (one byte per subspace)."""
    d = P.shape[1] // m
    codes = np.zeros((len(P), m), dtype=np.uint8)
    recon = np.zeros_like(P)
    books = []
    for j in range(m):
        part = P[:, j * d:(j + 1) * d]
        km = MiniBatchKMeans(n_clusters=ks, batch_size=8192, n_init=3, random_state=j, max_iter=60).fit(part[sample])
        codes[:, j] = km.predict(part)
        recon[:, j * d:(j + 1) * d] = km.cluster_centers_[codes[:, j]]
        books.append(km.cluster_centers_.astype(np.float32))
    size = len(gzip.compress(codes.tobytes(), 6)) + sum(b.nbytes for b in books)
    return recon, size

schemes = {}
def add(name, M, size):
    M = M.astype(np.float32)
    M /= np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-12)
    schemes[name] = (M, size)

started = time.time()
P96 = pca(96)
Q = row_quant(P96, 8); add('pca96 int8 (지금)', Q, packed_size(Q, 8))
Q = row_quant(P96, 4); add('pca96 int4', Q, packed_size(Q, 4))
P64 = pca(64)
Q = row_quant(P64, 8); add('pca64 int8', Q, packed_size(Q, 8))
P128 = pca(128)
Q = row_quant(P128, 4); add('pca128 int4', Q, packed_size(Q, 4))
Q = row_quant(pca(192), 4); add('pca192 int4', Q, packed_size(Q, 4))
for m in (48, 32, 24):
    recon, size = pq(P96, m); add(f'pca96 PQ{m}', recon, size)
recon, size = pq(P128, 32); add('pca128 PQ32', recon, size)
recon, size = pq(P128, 64); add('pca128 PQ64', recon, size)
print(f'built {len(schemes)} schemes in {time.time() - started:.0f}s')

now_top = None
report = []
for name, (M, size) in schemes.items():
    tops, S = top_sets(M)
    if now_top is None: now_top = tops
    overlap = np.mean([len(a & b) / 1000 for a, b in zip(tops, ref_top)])
    vs_now = np.mean([len(a & b) / 1000 for a, b in zip(tops, now_top)])
    corr = np.mean([np.corrcoef(ref_S[t][check], S[t][check])[0, 1] for t in range(len(topics))])
    err = np.abs(ref_S[:, check] - S[:, check])
    Me = M[en_ids]
    ranks = [(Me @ M[q] > M[t] @ M[q]).sum() for q, t in test]
    row = {'scheme': name, 'gzip_mb': round(size / 1e6, 1), 'corr': round(float(corr), 3), 'top1000': round(float(overlap), 3),
           'vs_now': round(float(vs_now), 3), 'mean_abs_ds': round(float(err.mean()), 4), 'p99_abs_ds': round(float(np.percentile(err, 99)), 4),
           'd90_p99_points': round(float(90 * 0.35 * np.percentile(err, 99)), 2), 'ko_en_at10': round(float(np.mean(np.array(ranks) < 10)), 3)}
    report.append(row)
    print(json.dumps(row, ensure_ascii=False))
Path(args.out).parent.mkdir(parents=True, exist_ok=True)
Path(args.out).write_text(json.dumps({'topics': len(topics), 'pairs': len(test), 'schemes': report}, ensure_ascii=False, indent=1), encoding='utf-8')
