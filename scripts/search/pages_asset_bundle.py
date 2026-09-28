"""Package the V2 search assets and restore a pinned bundle without overwriting app code.

The assets are generated (not in Git), so a deployment gets them from a Release zip:
  create : zip the files listed by build/pages-review/payload-files.json plus the reviewed
           allowlist (public/data/deployment-allowlist.json inside the zip)
  restore: check the zip's SHA-256, accept only search asset paths and the allowlist, and
           require the allowlist to be reviewed, before writing anything
Asset integrity and pins are checked afterwards by scripts/check_search_assets.js.
"""
import argparse
import hashlib
import json
import re
import shutil
import stat
import zipfile
from pathlib import Path

POLICY = 'public/data/deployment-allowlist.json'
PATTERNS = [
    r'public/assets/lexicon/v1/(?:lexicon\.json|lexicon\.bin\.gz)',
    r'public/assets/g2p/v1/(?:ko|en)/(?:model\.json|weights\.bin\.gz)',
    r'public/assets/topic/v1/(?:topic\.json|vectors\.bin\.gz|vectors-linked\.bin\.gz)',
    r'public/assets/linked/v2/(?:linked\.json|linked\.bin\.gz)',
]


def allowed(name):
    return name == POLICY or any(re.fullmatch(pattern, name) for pattern in PATTERNS)


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def create_bundle(root, inventory, policy, output):
    names = json.loads(Path(inventory).read_text(encoding='utf-8'))
    if len(set(names)) != len(names) or any(not allowed(name) or name == POLICY for name in names):
        raise ValueError('Invalid bundle inventory')
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(names):
            file = (root / name).resolve()
            if not file.is_relative_to(root.resolve()) or file.is_symlink():
                raise ValueError('Source escapes workspace')
            archive.write(file, name)
        archive.write(policy, POLICY)
    return digest(output)


def restore_bundle(root, archive_path, expected_sha256):
    if not re.fullmatch(r'[a-f0-9]{64}', expected_sha256) or digest(archive_path) != expected_sha256:
        raise ValueError('Bundle SHA-256 mismatch')
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or POLICY not in names:
            raise ValueError('Duplicate or missing bundle entries')
        if sum(entry.file_size for entry in entries) > 900 * 1024 * 1024:
            raise ValueError('Bundle is too large')
        for entry in entries:
            if not allowed(entry.filename) or entry.file_size > 95 * 1024 * 1024 or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError('Forbidden bundle entry: ' + entry.filename)
            # Check every final target before creating any files.
            if not (root / entry.filename).resolve().is_relative_to(root.resolve()):
                raise ValueError('Destination escapes workspace')
        policy = json.loads(archive.read(POLICY))
        if policy.get('schema_version') != 2 or policy.get('reviewed') is not True or not isinstance(policy.get('allowed_files'), list):
            raise ValueError('Bundle requires a reviewed deployment allowlist')
        for entry in entries:
            target = root / entry.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open('wb') as destination:
                shutil.copyfileobj(source, destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create')
    create.add_argument('--inventory', default='build/pages-review/payload-files.json')
    create.add_argument('--policy', default='build/pages-review/deployment-allowlist.draft.json')
    create.add_argument('--output', default='build/rhyme-search-assets.zip')
    restore = commands.add_parser('restore')
    restore.add_argument('--archive', required=True)
    restore.add_argument('--sha256', required=True)
    args = parser.parse_args()
    if args.command == 'create':
        print(json.dumps({'file': args.output, 'sha256': create_bundle(Path.cwd(), args.inventory, args.policy, args.output)}))
    else:
        restore_bundle(Path.cwd(), args.archive, args.sha256)
        print('Search assets restored; run npm run check:search-assets before deployment.')
