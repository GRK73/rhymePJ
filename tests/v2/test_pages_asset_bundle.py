import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('pages_bundle', ROOT / 'scripts/search/pages_asset_bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
LEXICON = 'public/assets/lexicon/v1/lexicon.json'


class PagesBundleTests(unittest.TestCase):
    def make_archive(self, directory, reviewed=True, extra=None, schema=2):
        archive = directory / 'input.zip'
        with zipfile.ZipFile(archive, 'w') as output:
            output.writestr(bundle.POLICY, json.dumps({'schema_version': schema, 'reviewed': reviewed, 'allowed_files': []}))
            output.writestr(LEXICON, '{}')
            if extra:
                output.writestr(extra, 'unexpected')
        return archive, hashlib.sha256(archive.read_bytes()).hexdigest()

    def test_valid_restore_and_app_code_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'public/js/app.js'
            app.parent.mkdir(parents=True)
            app.write_text('original')
            archive, digest = self.make_archive(root)
            bundle.restore_bundle(root, archive, digest)
            self.assertEqual(app.read_text(), 'original')
            self.assertTrue((root / bundle.POLICY).exists())
            self.assertTrue((root / LEXICON).exists())

    def test_only_v2_asset_paths_are_accepted(self):
        self.assertTrue(bundle.allowed('public/assets/topic/v1/vectors-linked.bin.gz'))
        self.assertTrue(bundle.allowed('public/assets/g2p/v1/en/weights.bin.gz'))
        for name in ('public/assets/linked/v1/manifest.json', 'indexes/phoneme/v0/static/search-manifest.json',
                     'public/js/app.js', 'public/assets/topic/v1/other.bin.gz', 'public/data/corpus/lyrics.jsonl'):
            self.assertFalse(bundle.allowed(name), name)

    def test_reject_hash_draft_old_schema_traversal_and_code_before_writing(self):
        cases = [(False, None, False, 2), (True, None, True, 2), (True, None, False, 1),
                 (True, '../escape.json', False, 2), (True, 'public/js/app.js', False, 2)]
        for reviewed, extra, corrupt_hash, schema in cases:
            with self.subTest(reviewed=reviewed, extra=extra, corrupt_hash=corrupt_hash, schema=schema), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                archive, digest = self.make_archive(root, reviewed, extra, schema)
                with self.assertRaises(ValueError):
                    bundle.restore_bundle(root, archive, '0' * 64 if corrupt_hash else digest)
                self.assertFalse((root / bundle.POLICY).exists())
                self.assertFalse((root / 'public/assets').exists())
