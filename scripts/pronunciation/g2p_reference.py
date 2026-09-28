"""Dump PyTorch greedy predictions so the JavaScript runtime can be checked against them.

Usage: python scripts/pronunciation/g2p_reference.py --model-dir DIR --lang ko --limit 2000 --out preds.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from train_g2p import BOS, EOS, G2P, read_pairs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--lang", choices=["ko", "en"], required=True)
    parser.add_argument("--limit", type=int, default=2000)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    checkpoint = torch.load(Path(args.model_dir) / "model.pt", weights_only=True)
    src_items, tgt_items = checkpoint["src"], checkpoint["tgt"]
    model = G2P(len(src_items), len(tgt_items))
    model.load_state_dict(checkpoint["state"])
    model.eval()
    src_index = {token: i for i, token in enumerate(src_items)}
    bos, eos = tgt_items.index(BOS), tgt_items.index(EOS)
    rows = []
    for tokens, _, word in read_pairs(args.lang, "test")[:args.limit]:
        ids = [src_index[t] for t in tokens if t in src_index]
        if not ids:
            continue
        out = model.greedy(torch.tensor([ids]), torch.tensor([len(ids)]), len(ids) * 2 + 8, bos, eos)[0].tolist()
        rows.append({"word": word, "phonemes": [tgt_items[t] for t in (out[:out.index(eos)] if eos in out else out)]})
    Path(args.out).write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"{len(rows)} predictions")


if __name__ == "__main__":
    main()
