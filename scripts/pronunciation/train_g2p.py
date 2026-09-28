"""Train a Heami-imitating G2P model (word -> project phonemes) for one language.

Character-level seq2seq: bidirectional GRU encoder, GRU decoder with Luong
attention and input feeding. Kept deliberately small and free of layer types that
are awkward to reimplement, because inference runs in plain browser JavaScript.

Korean input is decomposed into initial/medial/final jamo tokens so unseen
syllables generalize; English input is characters.

Usage: python scripts/pronunciation/train_g2p.py --lang ko [--epochs 30]
Outputs models/g2p-heami/v1/<lang>/{model.pt,weights.bin,manifest.json,report.json}
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "derived" / "g2p_heami" / "v1"
OUT = ROOT / "models" / "g2p-heami" / "v1"
PAD, BOS, EOS = "<pad>", "<s>", "</s>"


def input_tokens(word: str, lang: str) -> list[str]:
    if lang != "ko":
        return list(word)
    tokens: list[str] = []
    for char in word:
        code = ord(char) - 0xAC00
        if 0 <= code <= 11171:
            tokens += [f"C{code // 588}", f"V{(code % 588) // 28}"]
            if code % 28:
                tokens.append(f"J{code % 28}")
        else:
            tokens.append(char)
    return tokens


def read_pairs(lang: str, part: str) -> list[tuple[list[str], list[str], str]]:
    rows = []
    for line in (DATA / f"{lang}.{part}.tsv").read_text(encoding="utf-8").splitlines():
        word, phonemes = line.split("\t")
        rows.append((input_tokens(word, lang), phonemes.split(" "), word))
    return rows


class Vocab:
    def __init__(self, sequences, specials):
        self.items = list(specials) + sorted({token for seq in sequences for token in seq} - set(specials))
        self.index = {token: i for i, token in enumerate(self.items)}

    def encode(self, tokens):
        return [self.index[token] for token in tokens if token in self.index]


class G2P(nn.Module):
    def __init__(self, n_in, n_out, emb=128, enc=192, dec=256):
        super().__init__()
        self.src_embed = nn.Embedding(n_in, emb, padding_idx=0)
        self.encoder = nn.GRU(emb, enc, batch_first=True, bidirectional=True)
        self.bridge = nn.Linear(2 * enc, dec)
        self.tgt_embed = nn.Embedding(n_out, emb, padding_idx=0)
        self.decoder = nn.GRUCell(emb + dec, dec)
        self.attn = nn.Linear(dec, 2 * enc, bias=False)
        self.combine = nn.Linear(dec + 2 * enc, dec)
        self.out = nn.Linear(dec, n_out)
        self.dec_size = dec

    def encode(self, src, src_len):
        packed = nn.utils.rnn.pack_padded_sequence(self.src_embed(src), src_len.cpu(), batch_first=True, enforce_sorted=False)
        memory, _ = self.encoder(packed)
        memory, _ = nn.utils.rnn.pad_packed_sequence(memory, batch_first=True, total_length=src.size(1))
        mask = src != 0
        mean = (memory * mask.unsqueeze(-1)).sum(1) / src_len.unsqueeze(-1)
        return memory, mask, torch.tanh(self.bridge(mean))

    def step(self, token, hidden, feed, memory, mask):
        hidden = self.decoder(torch.cat([self.tgt_embed(token), feed], -1), hidden)
        scores = torch.bmm(memory, self.attn(hidden).unsqueeze(-1)).squeeze(-1).masked_fill(~mask, -1e9)
        context = torch.bmm(torch.softmax(scores, -1).unsqueeze(1), memory).squeeze(1)
        feed = torch.tanh(self.combine(torch.cat([hidden, context], -1)))
        return self.out(feed), hidden, feed

    def forward(self, src, src_len, tgt_in):
        memory, mask, hidden = self.encode(src, src_len)
        feed = torch.zeros(src.size(0), self.dec_size)
        logits = []
        for t in range(tgt_in.size(1)):
            step_logits, hidden, feed = self.step(tgt_in[:, t], hidden, feed, memory, mask)
            logits.append(step_logits)
        return torch.stack(logits, 1)

    @torch.no_grad()
    def greedy(self, src, src_len, max_len, bos, eos):
        memory, mask, hidden = self.encode(src, src_len)
        feed = torch.zeros(src.size(0), self.dec_size)
        token = torch.full((src.size(0),), bos, dtype=torch.long)
        outputs, done = [], torch.zeros(src.size(0), dtype=torch.bool)
        for _ in range(max_len):
            logits, hidden, feed = self.step(token, hidden, feed, memory, mask)
            token = logits.argmax(-1)
            outputs.append(token)
            done |= token == eos
            if done.all():
                break
        return torch.stack(outputs, 1)


def batches(rows, size, shuffle):
    order = list(range(len(rows)))
    if shuffle:
        random.shuffle(order)
    else:
        order.sort(key=lambda i: len(rows[i][0]))
    for start in range(0, len(order), size):
        yield [rows[i] for i in order[start:start + size]]


def tensorize(batch, src_vocab, tgt_vocab):
    src = [src_vocab.encode(r[0]) or [0] for r in batch]
    tgt = [tgt_vocab.encode(r[1]) for r in batch]
    bos, eos = tgt_vocab.index[BOS], tgt_vocab.index[EOS]
    src_len = torch.tensor([len(s) for s in src])
    src_t = torch.zeros(len(batch), max(map(len, src)), dtype=torch.long)
    width = max(map(len, tgt)) + 1
    tgt_in = torch.zeros(len(batch), width, dtype=torch.long)
    tgt_out = torch.zeros(len(batch), width, dtype=torch.long)
    for i, (s, t) in enumerate(zip(src, tgt)):
        src_t[i, :len(s)] = torch.tensor(s)
        tgt_in[i, :len(t) + 1] = torch.tensor([bos] + t)
        tgt_out[i, :len(t) + 1] = torch.tensor(t + [eos])
    return src_t, src_len, tgt_in, tgt_out


def edit_distance(a, b):
    row = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, row[0] = row[0], i
        for j in range(1, len(b) + 1):
            cur = row[j]
            row[j] = min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return row[-1]


def evaluate(model, rows, src_vocab, tgt_vocab, keep_errors=0):
    model.eval()
    exact = errors = total = 0
    samples = []
    eos = tgt_vocab.index[EOS]
    for batch in batches(rows, 512, False):
        src, src_len, _, _ = tensorize(batch, src_vocab, tgt_vocab)
        out = model.greedy(src, src_len, max(len(r[1]) for r in batch) + 8, tgt_vocab.index[BOS], eos)
        for row, seq in zip(batch, out.tolist()):
            pred = [tgt_vocab.items[t] for t in (seq[:seq.index(eos)] if eos in seq else seq)]
            distance = edit_distance(pred, row[1])
            exact += distance == 0
            errors += distance
            total += len(row[1])
            if distance and len(samples) < keep_errors:
                samples.append({"word": row[2], "heami": " ".join(row[1]), "model": " ".join(pred)})
    model.train()
    return {"exact_rate": exact / len(rows), "phoneme_error_rate": errors / max(total, 1), "count": len(rows)}, samples


def export(model, src_vocab, tgt_vocab, lang, out_dir):
    tensors, offset, chunks = [], 0, []
    for name, value in model.state_dict().items():
        array = value.detach().to(torch.float32).contiguous().numpy()
        tensors.append({"name": name, "shape": list(array.shape), "offset": offset})
        chunks.append(array.tobytes())
        offset += array.nbytes
    (out_dir / "weights.bin").write_bytes(b"".join(chunks))
    (out_dir / "manifest.json").write_text(json.dumps({
        "schema_version": 1, "lang": lang, "dtype": "float32", "byte_order": "little",
        "architecture": "bigru-luong-inputfeed", "dec_size": model.dec_size,
        "input_vocab": src_vocab.items, "output_vocab": tgt_vocab.items,
        "specials": {"pad": PAD, "bos": BOS, "eos": EOS}, "tensors": tensors,
    }, ensure_ascii=False), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["ko", "en"], required=True)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--patience", type=int, default=4)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="smoke test: use only the first N training pairs")
    parser.add_argument("--out", default="", help="override output directory")
    args = parser.parse_args()
    random.seed(7)
    torch.manual_seed(7)
    torch.set_num_threads(args.threads)

    train, dev, test = (read_pairs(args.lang, p) for p in ("train", "dev", "test"))
    if args.limit:
        train, dev, test = train[:args.limit], dev[:args.limit // 10], test[:args.limit // 10]
    src_vocab = Vocab([r[0] for r in train], [PAD])
    tgt_vocab = Vocab([r[1] for r in train], [PAD, BOS, EOS])
    model = G2P(len(src_vocab.items), len(tgt_vocab.items))
    params = sum(p.numel() for p in model.parameters())
    print(f"{args.lang}: train {len(train)}, dev {len(dev)}, test {len(test)}, params {params:,}", flush=True)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss(ignore_index=0)
    out_dir = Path(args.out) if args.out else OUT / args.lang
    out_dir.mkdir(parents=True, exist_ok=True)

    best, stale, history = -1.0, 0, []
    for epoch in range(1, args.epochs + 1):
        started, total_loss, steps = time.time(), 0.0, 0
        for batch in batches(train, args.batch, True):
            src, src_len, tgt_in, tgt_out = tensorize(batch, src_vocab, tgt_vocab)
            logits = model(src, src_len, tgt_in)
            loss = loss_fn(logits.reshape(-1, logits.size(-1)), tgt_out.reshape(-1))
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += loss.item()
            steps += 1
        metrics, _ = evaluate(model, dev, src_vocab, tgt_vocab)
        history.append({"epoch": epoch, "loss": total_loss / steps, "dev": metrics, "seconds": time.time() - started})
        print(f"epoch {epoch}: loss {total_loss / steps:.4f} dev exact {metrics['exact_rate']:.4f} "
              f"PER {metrics['phoneme_error_rate']:.4f} ({time.time() - started:.0f}s)", flush=True)
        if metrics["exact_rate"] > best:
            best, stale = metrics["exact_rate"], 0
            torch.save({"state": model.state_dict(), "src": src_vocab.items, "tgt": tgt_vocab.items}, out_dir / "model.pt")
        else:
            stale += 1
            if stale >= args.patience:
                break
        if epoch in (8, 16):
            for group in optimizer.param_groups:
                group["lr"] *= 0.5

    checkpoint = torch.load(out_dir / "model.pt", weights_only=True)
    model.load_state_dict(checkpoint["state"])
    test_metrics, errors = evaluate(model, test, src_vocab, tgt_vocab, keep_errors=60)
    export(model, src_vocab, tgt_vocab, args.lang, out_dir)
    report = {"lang": args.lang, "params": params, "best_dev_exact": best, "test": test_metrics,
              "history": history, "test_error_examples": errors}
    (out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"test": test_metrics, "best_dev_exact": best}), flush=True)


if __name__ == "__main__":
    main()
