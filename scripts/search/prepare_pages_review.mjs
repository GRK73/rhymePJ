// Produce an unapproved release inventory for review. Never turns a draft into approval.
//   build/pages-review/deployment-allowlist.draft.json  app files + pinned search asset manifests
//                                                        (reviewed: false; a person sets true)
//   build/pages-review/payload-files.json                asset files for the Release bundle
//   build/pages-review/source-inventory.json             hashes and the data sources to review
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkSearchAssets } = require('../check_search_assets.js');
const root = process.cwd();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(path.join(root, file));

const assets = checkSearchAssets(path.join(root, 'public'));
const files = new Set(['index.html', 'style.css', 'assets/sound_icon.png', 'data/deployment-allowlist.json']);
function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, 'public', relative), { withFileTypes: true })) {
        const file = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) throw Error(`Symlink not allowed: ${file}`);
        if (entry.isDirectory()) walk(file); else files.add(file);
    }
}
for (const directory of ['js', 'workers']) walk(directory);
for (const file of files) if (file !== 'data/deployment-allowlist.json') read(`public/${file}`);

// Where each published asset's content comes from; the reviewer decides what may be public.
const SOURCES = [
    { asset: 'assets/lexicon/v1', content: 'Korean readings and Korean-style English readings', source: 'Microsoft Heami (Windows ko-KR TTS voice) phoneme events', check: 'Windows / Speech Platform terms for publishing derived phoneme transcriptions' },
    { asset: 'assets/lexicon/v1', content: 'English words and native IPA', source: 'CMU Pronouncing Dictionary (via V1 build_dict.js)', check: 'BSD-style licence, attribution' },
    { asset: 'assets/lexicon/v1', content: 'Korean word list', source: 'NIKL Standard Korean Dictionary word list (V1 scrape_nikl.js) and lyric-corpus words', check: 'NIKL terms; the lyric corpus itself is not published, only word forms' },
    { asset: 'assets/lexicon/v1', content: 'Korean frequencies (zipf)', source: 'Korean Wikipedia (Korpora kowikitext 20200920) token counts', check: 'CC BY-SA 3.0 attribution' },
    { asset: 'assets/lexicon/v1', content: 'English frequencies (zipf)', source: 'wordfreq', check: 'wordfreq data licence (CC BY-SA 4.0) attribution' },
    { asset: 'assets/lexicon/v1', content: 'Loanword spellings used for Korean-style readings', source: 'National Institute of Korean Language loanword usage list', check: 'NIKL terms' },
    { asset: 'assets/g2p/v1', content: 'Pronunciation models', source: 'Trained on the Heami readings above', check: 'same as the Heami readings' },
    { asset: 'assets/topic/v1', content: 'Meaning vectors', source: 'sentence-transformers/LaBSE embeddings', check: 'Apache-2.0' },
    { asset: 'assets/linked/v2', content: 'Korean word pairs (surface bigrams)', source: 'Korean Wikipedia (kowikitext 20200920)', check: 'CC BY-SA 3.0 attribution' },
    { asset: 'assets/linked/v2', content: 'English word pairs (bigram_next_en.json)', source: 'Open-source English corpus with a permissive licence (V1 build_bigram_index.py --corpus); confirmed by the project owner 2026-09-28', check: 'Confirmed; credited in the site footer' },
];

const output = path.join(root, 'build/pages-review');
fs.mkdirSync(output, { recursive: true });
const policy = {
    schema_version: 2, reviewed: false,
    review_notes: '배포 후보 목록입니다. source-inventory.json의 자료 출처별 공개·재배포 조건을 확인한 뒤 공개 가능한 파일만 남기고 reviewed를 true로 바꿔야 합니다.',
    search_assets: { manifest_sha256: assets.manifests },
    allowed_files: [...files].sort(),
};
const outputs = {
    'deployment-allowlist.draft.json': policy,
    'payload-files.json': assets.files.map(file => `public/${file}`).sort(),
    'source-inventory.json': {
        generated_at: new Date().toISOString(), sources: SOURCES,
        search_assets: Object.fromEntries(assets.files.map(file => [file, hash(read(`public/${file}`))])),
        app_files: [...files].filter(file => file !== 'data/deployment-allowlist.json').sort()
            .map(file => ({ path: file, sha256: hash(read(`public/${file}`)) })),
    },
};
for (const [file, data] of Object.entries(outputs)) fs.writeFileSync(path.join(output, file), `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({ output, reviewed: false, app_files: files.size, asset_files: assets.files.length, asset_mb: +(assets.bytes / 1e6).toFixed(1) }));
