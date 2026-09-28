"""Embed every lexicon word with LaBSE into one shared ko/en meaning space.

Input: a TSV of `lang\tword\tzipf` in lexicon order (export_lexicon_words.mjs). Output (float16, L2-normalised, 768 dims):
  <out>/embeddings.f16.npy, <out>/words.tsv
LaBSE pipeline as in sentence-transformers: BERT CLS -> Dense(768, tanh) -> normalise.

Usage: python scripts/semantic/embed_labse.py WORDS.tsv OUT_DIR [--threads 12]
"""
import argparse, os, time
import numpy as np
import torch
from huggingface_hub import snapshot_download
from safetensors.torch import load_file
from transformers import AutoModel, AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument('words')
parser.add_argument('out')
parser.add_argument('--threads', type=int, default=12)
parser.add_argument('--batch', type=int, default=512)
args = parser.parse_args()
torch.set_num_threads(args.threads)

path = snapshot_download('sentence-transformers/LaBSE', local_files_only=True)
tok = AutoTokenizer.from_pretrained(path)
bert = AutoModel.from_pretrained(path).eval()
dense = load_file(os.path.join(path, '2_Dense/model.safetensors'))

rows = [line.split('\t') for line in open(args.words, encoding='utf-8').read().split('\n') if line]
words = [row[1] for row in rows]
# Sorting by length keeps padding small; results go back to lexicon order.
order = sorted(range(len(words)), key=lambda i: len(words[i]))
out = np.zeros((len(words), 768), dtype=np.float16)
started = time.time()
with torch.inference_mode():
    for start in range(0, len(order), args.batch):
        index = order[start:start + args.batch]
        enc = tok([words[i] for i in index], padding=True, truncation=True, max_length=32, return_tensors='pt')
        cls = bert(**enc).last_hidden_state[:, 0]
        x = torch.nn.functional.normalize(torch.tanh(cls @ dense['linear.weight'].T + dense['linear.bias']), dim=1)
        out[index] = x.numpy().astype(np.float16)
        if (start // args.batch) % 50 == 0:
            done = start + len(index)
            print(f'{done}/{len(words)} {time.time() - started:.0f}s', flush=True)

os.makedirs(args.out, exist_ok=True)
np.save(os.path.join(args.out, 'embeddings.f16.npy'), out)
with open(os.path.join(args.out, 'words.tsv'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(f'{row[0]}\t{row[1]}' for row in rows) + '\n')
print(f'DONE {len(words)} words in {time.time() - started:.0f}s')
