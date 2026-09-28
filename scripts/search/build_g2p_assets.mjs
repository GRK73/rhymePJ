// Publish the Heami-imitating G2P models (models/g2p-heami/v1/<lang>) as browser assets:
//   public/assets/g2p/v1/<lang>/model.json      manifest + weights file hash
//   public/assets/g2p/v1/<lang>/weights.bin.gz  float32 weights, gzip
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

for (const lang of ['ko', 'en']) {
    const source = path.join(ROOT, 'models/g2p-heami/v1', lang);
    const target = path.join(ROOT, 'public/assets/g2p/v1', lang);
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
    const weights = fs.readFileSync(path.join(source, 'weights.bin'));
    const gzipped = zlib.gzipSync(weights, { level: 9 });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'weights.bin.gz'), gzipped);
    fs.writeFileSync(path.join(target, 'model.json'), JSON.stringify({
        ...manifest,
        weights: { file: 'weights.bin.gz', bytes: weights.length, gzip_bytes: gzipped.length, gzip_sha256: sha256(gzipped) },
    }));
    console.log(`${lang}: ${weights.length.toLocaleString()} bytes -> ${gzipped.length.toLocaleString()} gzip`);
}
