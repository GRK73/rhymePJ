'use strict';

// Integrity of the V2 search assets before they are staged for Pages.
//   - every data file listed by a manifest exists, sits next to it, and matches its
//     gzip size and SHA-256; the decompressed bytes match the recorded raw SHA-256 when
//     the manifest has one
//   - the assets belong together: topic vectors and linked data were built for this
//     lexicon, and the linked data for these linked topic rows (the Worker refuses a mix)
//   - with pins (the reviewed allowlist's search_assets.manifest_sha256), every manifest
//     file must match its pin, and nothing may be pinned that is not checked
// Returns the public-relative files to publish and each manifest's SHA-256.
//
// Usage: node scripts/check_search_assets.js [--public-root public] [--allowlist FILE]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MANIFESTS = [
    { path: 'assets/lexicon/v1/lexicon.json', bins: manifest => [manifest.bin] },
    { path: 'assets/g2p/v1/ko/model.json', bins: manifest => [manifest.weights] },
    { path: 'assets/g2p/v1/en/model.json', bins: manifest => [manifest.weights] },
    { path: 'assets/topic/v1/topic.json', bins: manifest => [manifest.bin, manifest.linked?.bin] },
    { path: 'assets/linked/v2/linked.json', bins: manifest => [manifest.bin] },
];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fail(message) {
    throw new Error(message);
}

function checkSearchAssets(publicRoot, pins = null) {
    const root = path.resolve(publicRoot);
    const files = [];
    const manifests = {};
    const parsed = {};
    let bytes = 0;
    for (const entry of MANIFESTS) {
        const manifestPath = path.join(root, entry.path);
        if (!fs.existsSync(manifestPath)) fail(`Search asset manifest is missing: ${entry.path}`);
        const raw = fs.readFileSync(manifestPath);
        manifests[entry.path] = sha256(raw);
        const manifest = JSON.parse(raw);
        parsed[entry.path] = manifest;
        files.push(entry.path);
        bytes += raw.length;
        for (const bin of entry.bins(manifest)) {
            if (!bin || typeof bin.file !== 'string' || !/^[A-Za-z0-9._-]+$/.test(bin.file)) fail(`Invalid data file in ${entry.path}`);
            const relative = `${path.posix.dirname(entry.path)}/${bin.file}`;
            const file = path.join(root, relative);
            if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) fail(`Search asset is missing: ${relative}`);
            const data = fs.readFileSync(file);
            if (data.length !== bin.gzip_bytes || sha256(data) !== bin.gzip_sha256) fail(`Search asset integrity failure: ${relative}`);
            const inflated = zlib.gunzipSync(data);
            if (inflated.length !== bin.bytes || (bin.sha256 && sha256(inflated) !== bin.sha256)) {
                fail(`Search asset content does not match its manifest: ${relative}`);
            }
            files.push(relative);
            bytes += data.length;
        }
    }

    const lexicon = parsed['assets/lexicon/v1/lexicon.json'];
    const topic = parsed['assets/topic/v1/topic.json'];
    const linked = parsed['assets/linked/v2/linked.json'];
    if (!topic.linked) fail('Topic vectors have no linked-search rows');
    if (topic.lexicon_sha256 !== lexicon.bin.sha256) fail('Topic vectors were built for another lexicon');
    if (linked.lexicon_sha256 !== lexicon.bin.sha256) fail('Linked data was built for another lexicon');
    if (linked.topic_linked_sha256 !== topic.linked.bin.sha256) fail('Linked data was built for other linked topic vectors');

    if (pins) {
        const pinned = Object.keys(pins).sort(), checked = Object.keys(manifests).sort();
        if (JSON.stringify(pinned) !== JSON.stringify(checked)) fail('Pinned search asset manifests do not match the checked set');
        for (const [relative, digest] of Object.entries(manifests)) {
            if (pins[relative] !== digest) fail(`Search asset manifest differs from the reviewed pin: ${relative}`);
        }
    }
    return { files, manifests, bytes };
}

function parseArgs(argv) {
    const result = { publicRoot: 'public', allowlist: null };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--public-root' && argv[index + 1]) result.publicRoot = argv[++index];
        else if (argv[index] === '--allowlist' && argv[index + 1]) result.allowlist = argv[++index];
        else fail(`Unknown or incomplete argument: ${argv[index]}`);
    }
    return result;
}

if (require.main === module) {
    try {
        const args = parseArgs(process.argv.slice(2));
        const pins = args.allowlist ? JSON.parse(fs.readFileSync(args.allowlist, 'utf8')).search_assets?.manifest_sha256 : null;
        if (args.allowlist && !pins) fail('The allowlist does not pin search_assets.manifest_sha256');
        const result = checkSearchAssets(args.publicRoot, pins);
        console.log(`Search assets passed: ${result.files.length} files, ${(result.bytes / 1e6).toFixed(1)} MB${pins ? ', pins match' : ''}`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = { checkSearchAssets, SEARCH_ASSET_MANIFESTS: MANIFESTS.map(entry => entry.path) };
