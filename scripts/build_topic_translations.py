import argparse
import asyncio
import inspect
import json
import pathlib


ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT_DIR / "public" / "topic_translations.json"


def normalize_key(value):
    return str(value).strip().lower().replace("\u2018", "'").replace("\u2019", "'")


def read_topics(args):
    topics = list(args.topics)
    if args.input:
        input_path = pathlib.Path(args.input).expanduser()
        topics.extend(line.strip() for line in input_path.read_text(encoding="utf-8").splitlines())
    return sorted({topic.strip() for topic in topics if topic.strip()})


async def translate_topic(translator, topic, src, dest):
    result = translator.translate(topic, src=src, dest=dest)
    if inspect.isawaitable(result):
        result = await result
    return normalize_key(getattr(result, "text", ""))


async def translate_topics(topics, src, dest):
    try:
        from googletrans import Translator
    except ImportError as exc:
        raise SystemExit(
            "googletrans is required for topic translation. "
            "Install it with: pip install googletrans"
        ) from exc

    translator = Translator()
    translations = {}
    for topic in topics:
        translated = await translate_topic(translator, topic, src, dest)
        if translated:
            translations[normalize_key(topic)] = [translated]
            print(f"{topic} -> {translated}")
    return translations


def load_existing(output_path):
    if not output_path.exists():
        return {}
    data = json.loads(output_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"{output_path} must contain a JSON object.")
    return data


def merge_translations(existing, incoming):
    merged = dict(existing)
    for topic, values in incoming.items():
        current = merged.get(topic, [])
        if not isinstance(current, list):
            current = [current]
        merged[topic] = sorted({normalize_key(value) for value in [*current, *values] if normalize_key(value)})
    return merged


def main():
    parser = argparse.ArgumentParser(description="Build public/topic_translations.json with googletrans.")
    parser.add_argument("topics", nargs="*", help="Korean topic words to translate.")
    parser.add_argument("--input", help="Optional UTF-8 text file with one topic per line.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path.")
    parser.add_argument("--src", default="ko", help="Source language code.")
    parser.add_argument("--dest", default="en", help="Destination language code.")
    parser.add_argument("--no-merge", action="store_true", help="Overwrite instead of merging with existing output.")
    args = parser.parse_args()

    topics = read_topics(args)
    if not topics:
        raise SystemExit("Provide topics as arguments or with --input.")

    output_path = pathlib.Path(args.output).expanduser()
    incoming = asyncio.run(translate_topics(topics, args.src, args.dest))
    existing = {} if args.no_merge else load_existing(output_path)
    merged = merge_translations(existing, incoming)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(merged):,} topic translations to {output_path}")


if __name__ == "__main__":
    main()
