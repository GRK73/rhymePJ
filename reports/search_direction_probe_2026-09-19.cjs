'use strict';

// Research probe only: exact Korean surface-boundary retrieval, not full ranking.
// Run from any directory with: node reports/search_direction_probe_2026-09-19.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const source = path.join(ROOT, 'public/data/model/bigram_surface_ko.json');
const raw = fs.readFileSync(source);
const loadStart = performance.now();
const payload = JSON.parse(raw);
const heads = Object.entries(payload.entries);
const parseMs = performance.now() - loadStart;
const indexStart = performance.now();
const suffixIndex = new Map();
let pairCount = 0;
let postingCount = 0;
for (let id = 0; id < heads.length; id++) {
    const [head, data] = heads[id];
    pairCount += data[1].length;
    for (let width = 1; width <= Math.min(4, head.length); width++) {
        const key = head.slice(-width);
        if (!suffixIndex.has(key)) suffixIndex.set(key, []);
        suffixIndex.get(key).push(id);
        postingCount++;
    }
}
const buildMs = performance.now() - indexStart;
function retrieve(query, indexed) {
    const hits = [];
    for (let split = 1; split < query.length; split++) {
        const left = query.slice(0, split);
        const right = query.slice(split);
        const ids = indexed ? (suffixIndex.get(left) || []) : null;
        function visit(id) {
            const [head, data] = heads[id];
            if (!indexed && !head.endsWith(left)) return;
            for (let next = 0; next < data[1].length; next++) {
                if (data[1][next][0].startsWith(right)) hits.push(`${split}:${id}:${next}`);
            }
        }
        if (indexed) for (const id of ids) visit(id);
        else for (let id = 0; id < heads.length; id++) visit(id);
    }
    return hits;
}
function median(values) { return values.slice().sort((a, b) => a-b)[Math.floor(values.length/2)]; }
const cases = [];
for (const query of ['사랑','나비','바다','하늘','마음','미래','사상','바나나','에대해','를위해','이가','는나']) {
    const expected = retrieve(query, false);
    const actual = retrieve(query, true);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Mismatch: ${query}`);
    const scan = [], indexed = [];
    for (let run = 0; run < 9; run++) {
        // Alternate order to limit systematic warm-up bias.
        for (const mode of run % 2 ? [true, false] : [false, true]) {
            const start = performance.now();
            retrieve(query, mode);
            (mode ? indexed : scan).push(performance.now() - start);
        }
    }
    cases.push({query, exact_hits: actual.length, same_ordered_ids: true,
        scan_p50_ms: median(scan), indexed_p50_ms: median(indexed)});
}
const workerCases = [];
for (const query of ['사랑', 'time', '바나나']) {
    const result = JSON.parse(execFileSync(process.execPath, [
        path.join(ROOT, 'scripts/v2/run_static_search_worker.js'),
        path.join(ROOT, 'indexes/phoneme/v0/static/search-manifest.json'),
        JSON.stringify({query, target_languages:['ko','en'], limit:10, candidate_limit:800}),
        JSON.stringify({check_cancellation:false})
    ], {cwd:ROOT, maxBuffer: 8*1024*1024, encoding:'utf8'}));
    workerCases.push({query, init_ms:result.harness.init_ms,
        cold:result.cold.diagnostics, warm:result.warm.diagnostics,
        top5:result.warm.hits?.slice(0,5).map(x=>x.word),
        top5_results:result.warm.results?.slice(0,5).map(x=>x.word)});
}
const output = {
    date:'2026-09-19', node:process.version, platform:process.platform,
    scope:'Exact Korean surface retrieval only. Excludes phonetic fallback, ranking, network, rendering and English linked search. Not an application speedup measurement.',
    input_sha256:crypto.createHash('sha256').update(raw).digest('hex'),
    heads:heads.length, pairs:pairCount, source_bytes:raw.length, json_parse_ms:parseMs,
    suffix_index_build_ms:buildMs, suffix_keys:suffixIndex.size, postings:postingCount,
    uint32_postings_payload_bytes:postingCount*4,
    posting_size_excludes:'keys, offsets, metadata and browser object overhead',
    cases, current_worker_single_run:workerCases
};
const outDir = path.join(ROOT, 'reports/generated');
fs.mkdirSync(outDir, {recursive:true});
fs.writeFileSync(path.join(outDir, 'search_direction_probe_2026-09-19.json'), JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
