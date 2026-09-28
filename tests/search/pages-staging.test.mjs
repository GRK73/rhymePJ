import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stagePagesArtifact } = require('../../scripts/stage_pages_artifact.js');
const { checkSearchAssets } = require('../../scripts/check_search_assets.js');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// A public/ tree with the five V2 asset manifests and tiny data files that fit together.
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhyme-pages-'));
    const pub = path.join(root, 'public');
    const write = (relative, data) => { const file = path.join(pub, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
    const bin = (relative, text) => {
        const raw = Buffer.from(text), packed = zlib.gzipSync(raw);
        write(relative, packed);
        return { file: path.basename(relative), bytes: raw.length, sha256: sha256(raw), gzip_bytes: packed.length, gzip_sha256: sha256(packed) };
    };
    for (const [file, text] of Object.entries({ 'index.html': '<!doctype html><script src="js/app.js"></script>', 'style.css': 'body{}',
        'js/app.js': 'void 0;', 'assets/sound_icon.png': 'png', 'secret.txt': 'must not ship' })) write(file, text);
    const lexicon = { bin: bin('assets/lexicon/v1/lexicon.bin.gz', 'lexicon') };
    write('assets/lexicon/v1/lexicon.json', JSON.stringify(lexicon));
    for (const lang of ['ko', 'en']) {
        const { sha256: _, ...weights } = bin(`assets/g2p/v1/${lang}/weights.bin.gz`, `model ${lang}`);
        write(`assets/g2p/v1/${lang}/model.json`, JSON.stringify({ weights }));
    }
    const topic = { lexicon_sha256: lexicon.bin.sha256, bin: bin('assets/topic/v1/vectors.bin.gz', 'topic'),
        linked: { count: 1, bin: bin('assets/topic/v1/vectors-linked.bin.gz', 'topic linked') } };
    write('assets/topic/v1/topic.json', JSON.stringify(topic));
    const linked = { lexicon_sha256: lexicon.bin.sha256, topic_linked_sha256: topic.linked.bin.sha256, bin: bin('assets/linked/v2/linked.bin.gz', 'linked') };
    write('assets/linked/v2/linked.json', JSON.stringify(linked));
    const policy = { schema_version: 2, reviewed: true, search_assets: { manifest_sha256: checkSearchAssets(pub).manifests },
        allowed_files: ['index.html', 'style.css', 'js/app.js', 'assets/sound_icon.png', 'data/deployment-allowlist.json'] };
    const allowlist = path.join(root, 'allowlist.json');
    const savePolicy = value => fs.writeFileSync(allowlist, JSON.stringify(value));
    savePolicy(policy);
    const stage = () => stagePagesArtifact({ publicRoot: pub, outputRoot: path.join(root, 'build/pages'), allowlistPath: allowlist });
    return { root, pub, policy, savePolicy, stage, write };
}

test('staging copies the allowlisted app files and every pinned search asset, nothing else', () => {
    const env = fixture();
    try {
        const result = env.stage();
        const out = path.join(env.root, 'build/pages');
        const listed = JSON.parse(fs.readFileSync(path.join(out, 'data/deployment-allowlist.json'), 'utf8'));
        assert.equal(result.fileCount, 5 + 11);
        assert.ok(fs.existsSync(path.join(out, 'assets/topic/v1/vectors-linked.bin.gz')));
        assert.ok(!fs.existsSync(path.join(out, 'secret.txt')));
        assert.equal(Object.keys(listed.staged_search_assets.manifests).length, 5);
        env.stage(); // re-staging replaces the generated artifact
    } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('staging refuses tampered, mismatched, unpinned or unreviewed assets', () => {
    const failures = [
        ['a changed data file', env => env.write('assets/linked/v2/linked.bin.gz', zlib.gzipSync(Buffer.from('other')))],
        ['a manifest that differs from its pin', env => env.write('assets/lexicon/v1/lexicon.json',
            fs.readFileSync(path.join(env.pub, 'assets/lexicon/v1/lexicon.json'), 'utf8') + ' ')],
        ['assets built for another lexicon', env => {
            const file = path.join(env.pub, 'assets/topic/v1/topic.json');
            const topic = JSON.parse(fs.readFileSync(file, 'utf8'));
            topic.lexicon_sha256 = '0'.repeat(64);
            fs.writeFileSync(file, JSON.stringify(topic));
            env.savePolicy({ ...env.policy, search_assets: { manifest_sha256: { ...env.policy.search_assets.manifest_sha256,
                'assets/topic/v1/topic.json': sha256(fs.readFileSync(file)) } } });
        }],
        ['an unmanifested asset in the allowlist', env => {
            env.write('assets/lexicon/v1/extra.bin', 'x');
            env.savePolicy({ ...env.policy, allowed_files: [...env.policy.allowed_files, 'assets/lexicon/v1/extra.bin'] });
        }],
        ['an unreviewed allowlist', env => env.savePolicy({ ...env.policy, reviewed: false })],
        ['an old-format allowlist', env => env.savePolicy({ ...env.policy, schema_version: 1 })],
    ];
    for (const [label, breakIt] of failures) {
        const env = fixture();
        try {
            breakIt(env);
            assert.throws(() => env.stage(), undefined, label);
            assert.ok(!fs.existsSync(path.join(env.root, 'build/pages')), label);
        } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
    }
});

test('staging never replaces a directory it did not generate', () => {
    const env = fixture();
    try {
        fs.mkdirSync(path.join(env.root, 'build/pages'), { recursive: true });
        fs.writeFileSync(path.join(env.root, 'build/pages/keep.txt'), 'user file');
        assert.throws(() => env.stage(), /not a generated Pages artifact/);
        assert.ok(fs.existsSync(path.join(env.root, 'build/pages/keep.txt')));
    } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});
