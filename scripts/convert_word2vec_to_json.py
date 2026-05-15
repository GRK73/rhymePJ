import argparse
import bz2
import csv
import gzip
import json
import pathlib


ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_OUTPUTS = {
    "ko": ROOT_DIR / "public" / "semantic_vectors_ko.json",
    "en": ROOT_DIR / "public" / "semantic_vectors_en.json",
    "all": ROOT_DIR / "public" / "semantic_vectors.json",
}
DEFAULT_DICT = ROOT_DIR / "public" / "rhyme_dict_practical.json"
DEFAULT_LOANWORDS = ROOT_DIR / "public" / "loanword_overrides.json"


def normalize_key(value):
    return str(value).strip().lower().replace("\u2018", "'").replace("\u2019", "'")


def add_vocab_word(vocab, value):
    key = normalize_key(value)
    if key:
        vocab.add(key)


def load_vocab(language, include_all, max_vocab):
    if include_all:
        return None

    vocab = set()

    dictionary = json.loads(DEFAULT_DICT.read_text(encoding="utf-8"))
    for item in dictionary:
        item_lang = item.get("lang")
        if language != "all" and item_lang != language:
            continue
        add_vocab_word(vocab, item.get("word", ""))
        add_vocab_word(vocab, item.get("display", ""))

    if DEFAULT_LOANWORDS.exists():
        loanwords = json.loads(DEFAULT_LOANWORDS.read_text(encoding="utf-8"))
        for key, forms in loanwords.items():
            if language in {"en", "all"}:
                add_vocab_word(vocab, key)
            if language in {"ko", "all"}:
                for form in forms:
                    add_vocab_word(vocab, form)

    if max_vocab:
        return set(sorted(vocab)[:max_vocab])
    return vocab


def filter_and_write_vectors(vectors_iter, output_path, vocab, precision=4):
    vectors = {}
    dims = None

    for word, vector in vectors_iter:
        word = normalize_key(word)
        if vocab is not None and word not in vocab:
            continue

        vector = [round(float(value), precision) for value in vector]
        if dims is None:
            dims = len(vector)
        if len(vector) != dims:
            continue

        vectors[word] = vector

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps({"dims": dims, "words": vectors}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Saved {len(vectors):,} vectors ({dims} dims) to {output_path}")


def open_text_vector_file(input_path):
    if input_path.suffix == ".bz2":
        return bz2.open(input_path, "rt", encoding="utf-8", errors="ignore")
    if input_path.suffix == ".gz":
        return gzip.open(input_path, "rt", encoding="utf-8", errors="ignore")
    return input_path.open("r", encoding="utf-8", errors="ignore")


def split_vector_line(line, prefer_csv=False):
    if prefer_csv or ("," in line and len(line.split(",")) > len(line.split())):
        return next(csv.reader([line]))
    return line.rstrip().split()


def iter_text_word2vec(input_path):
    dims = None
    prefer_csv = ".csv" in input_path.suffixes

    with open_text_vector_file(input_path) as file:
        first = file.readline()
        first_line = split_vector_line(first, prefer_csv)
        if len(first_line) == 2 and all(part.isdigit() for part in first_line):
            dims = int(first_line[1])
        else:
            file.seek(0)

        for line in file:
            parts = split_vector_line(line, prefer_csv)
            if len(parts) < 3:
                continue

            try:
                vector = [float(value) for value in parts[1:]]
            except ValueError:
                continue

            if dims is not None and len(vector) != dims:
                continue

            yield parts[0], vector


def load_gensim_model(input_path, model_format):
    try:
        from gensim.models import KeyedVectors
    except ImportError as exc:
        raise SystemExit(
            "gensim is required for binary/gensim model formats. "
            "Install it with: pip install gensim"
        ) from exc

    if model_format == "gensim":
        return KeyedVectors.load(str(input_path), mmap="r")

    return KeyedVectors.load_word2vec_format(str(input_path), binary=model_format == "binary")


def iter_gensim_vectors(input_path, model_format):
    model = load_gensim_model(input_path, model_format)
    for word in model.index_to_key:
        yield word, model[word].tolist()


def resolve_model_format(input_path, model_format):
    if model_format != "auto":
        return model_format

    suffix = input_path.suffix.lower()
    if suffix == ".bin":
        return "binary"
    if suffix in {".kv", ".model"}:
        return "gensim"
    return "text"


def convert(input_path, output_path, language="en", include_all=False, max_vocab=None, model_format="auto", precision=4):
    vocab = load_vocab(language, include_all, max_vocab)
    resolved_format = resolve_model_format(input_path, model_format)

    if resolved_format == "text":
        vectors_iter = iter_text_word2vec(input_path)
    else:
        vectors_iter = iter_gensim_vectors(input_path, resolved_format)

    filter_and_write_vectors(vectors_iter, output_path, vocab, precision=precision)


def main():
    parser = argparse.ArgumentParser(description="Convert a word2vec/gensim model into browser-ready semantic vector JSON.")
    parser.add_argument("input", help="Path to a text, binary word2vec, or gensim KeyedVectors model.")
    parser.add_argument("--lang", choices=["ko", "en", "all"], default="en", help="Which project vocabulary to keep.")
    parser.add_argument("--output", default=None, help="Output JSON path. Defaults to public/semantic_vectors_<lang>.json.")
    parser.add_argument("--format", choices=["auto", "text", "binary", "gensim"], default="auto", help="Input model format.")
    parser.add_argument("--include-all", action="store_true", help="Keep every vector instead of filtering to project vocabulary.")
    parser.add_argument("--max-vocab", type=int, default=None, help="Optional cap for project vocabulary filtering.")
    parser.add_argument("--precision", type=int, default=4, help="Decimal places to keep in output vectors.")
    args = parser.parse_args()

    output = pathlib.Path(args.output).expanduser() if args.output else DEFAULT_OUTPUTS[args.lang]
    convert(
        pathlib.Path(args.input).expanduser(),
        output,
        language=args.lang,
        include_all=args.include_all,
        max_vocab=args.max_vocab,
        model_format=args.format,
        precision=args.precision,
    )


if __name__ == "__main__":
    main()
