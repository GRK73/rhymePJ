// Chrome measurement of the staged site (V2검색엔진설계.md §7, §8-5).
// Launches local Chrome (headless, fresh profile = empty cache) against build/preview served
// by a local server that can limit bandwidth and add latency to every response (the limit
// covers the Worker's downloads too, which DevTools throttling may not). Each profile runs:
//   first visit -> first word search right away -> more word / topic / linked searches
//   -> revisit in a new tab (HTTP cache warm)
// and records user-visible times (search call until results are rendered), bytes downloaded
// per step, and page / Worker JS heap.
//
// Usage: node scripts/search/measure_chrome.mjs [--profiles local,fast4g,slow4g] [--cpu 1] [--out FILE]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stagePreview } from './preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
// Bandwidth in bytes/s and added latency per request (approximate DevTools presets).
const PROFILES = {
    local: { bytesPerSecond: Infinity, latencyMs: 0, label: '제한 없음 (로컬)' },
    fast4g: { bytesPerSecond: 9e6 / 8, latencyMs: 60, label: '빠른 4G (9Mbps, 60ms)' },
    slow4g: { bytesPerSecond: 1.6e6 / 8, latencyMs: 150, label: '느린 4G (1.6Mbps, 150ms)' },
};
const profiles = option('--profiles', 'local,fast4g,slow4g').split(',');
const cpuRate = Number(option('--cpu', 1));
const out = option('--out', path.join(ROOT, 'reports/generated/chrome_measure.json'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css',
    '.json': 'application/json', '.gz': 'application/gzip', '.png': 'image/png' };

// ---- Throttled static server (one shared link, like a real connection) -------------------
function throttledServer(root, profile) {
    const stats = { bytes: 0, requests: 0 };
    const active = new Set();
    const tickMs = 20;
    let timer = null, last = 0;
    const pump = () => {
        if (!active.size) { clearInterval(timer); timer = null; return; }
        // Budget from the real elapsed time: timers fire late on Windows.
        const now = performance.now();
        let budget = profile.bytesPerSecond * (now - last) / 1000;
        last = now;
        const share = budget / active.size;
        for (const job of [...active]) {
            const size = Math.min(job.data.length - job.sent, Math.max(1, Math.floor(share)));
            job.response.write(job.data.subarray(job.sent, job.sent + size));
            job.sent += size; budget -= size;
            if (job.sent >= job.data.length) { job.response.end(); active.delete(job); }
        }
    };
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const relative = decodeURIComponent(url.pathname.replace(/^\/rhymePJ\/?/, '')) || 'index.html';
        const file = path.resolve(root, relative);
        if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
        const data = fs.readFileSync(file);
        stats.bytes += data.length; stats.requests += 1;
        // Same caching as GitHub Pages: short max-age; the app asks force-cache for hashed assets.
        response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Content-Length': data.length, 'Cache-Control': 'max-age=600' });
        setTimeout(() => {
            if (!Number.isFinite(profile.bytesPerSecond)) { response.end(data); return; }
            active.add({ response, data, sent: 0 });
            if (!timer) { last = performance.now(); timer = setInterval(pump, tickMs); }
        }, profile.latencyMs);
    });
    return { server, stats };
}

// ---- Chrome over CDP -------------------------------------------------------------------------
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

class Cdp {
    constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.handlers = []; }
    async connect() {
        this.socket = new WebSocket(this.url);
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(String(event.data));
            if (!message.id) { this.handlers.forEach(handler => handler(message)); return; }
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
        });
        await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    }
    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
}

async function launchChrome(profileDir) {
    const binary = [process.env.CHROME_PATH, path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe')].find(p => p && fs.existsSync(p));
    if (!binary) throw new Error('Chrome not found; set CHROME_PATH');
    const port = await freePort();
    const child = spawn(binary, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
        `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let browserUrl;
    for (let i = 0; i < 200 && !browserUrl; i += 1) {
        try { browserUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; }
        catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!browserUrl) { child.kill(); throw new Error('Chrome did not start'); }
    const cdp = new Cdp(browserUrl);
    await cdp.connect();
    return { cdp, child };
}

// A page session with its dedicated Worker attached (for the Worker's heap).
async function openPage(cdp, url) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = { sessionId, workers: [] };
    cdp.handlers.push(message => {
        if (message.method === 'Target.attachedToTarget' && message.sessionId === sessionId && message.params.targetInfo.type === 'worker') {
            page.workers.push(message.params.sessionId);
        }
    });
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate }, sessionId);
    page.evaluate = async expression => {
        const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    };
    page.heap = async () => {
        const mb = value => Math.round(value / 1e5) / 10;
        const main = await cdp.send('Runtime.getHeapUsage', {}, sessionId);
        let worker = null;
        for (const workerSession of page.workers) {
            try { worker = await cdp.send('Runtime.getHeapUsage', {}, workerSession); } catch { /* worker gone */ }
        }
        return { page_mb: mb(main.usedSize), worker_mb: worker ? mb(worker.usedSize) : null };
    };
    page.started = Date.now();
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    return page;
}

// In-page helpers: run a search through the real UI handlers and time until results render.
const HELPERS = `window.__measure = {
    async search({ mode, query, lang, topic = '', topicWeight = 0, frequencyWeight = 1, pronunciation = 'hybrid' }) {
        document.querySelector('[data-search-mode="' + mode + '"]').click();
        document.getElementById('searchInput').value = query;
        topicInput.value = topic; topicWeightInput.value = String(topicWeight);
        freqWeightInput.value = String(frequencyWeight);
        document.querySelector('input[name="lang"][value="' + lang + '"]').checked = true;
        document.querySelector('input[name="pronunciationMode"][value="' + pronunciation + '"]').checked = true;
        const started = performance.now();
        await handleSearch();
        while (activeWordSearch) await new Promise(resolve => setTimeout(resolve, 5));
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        return { ms: Math.round(performance.now() - started), status: statusEl.textContent,
            results: document.querySelectorAll('.result-item').length };
    },
};`;

const STEPS = [
    { name: '단어: 사랑 (전체, 첫 검색)', mode: 'word', query: '사랑', lang: 'all' },
    { name: '단어: time (영어)', mode: 'word', query: 'time', lang: 'en' },
    { name: '단어: love (전체)', mode: 'word', query: 'love', lang: 'all' },
    { name: '단어: 맛있다 (한국어)', mode: 'word', query: '맛있다', lang: 'ko' },
    { name: '단어: 사전에 없는 말 뷁뛁 (발음 모델 ko 첫 사용)', mode: 'word', query: '뷁뛁', lang: 'all' },
    { name: '단어: 사전에 없는 말 glorptastic (발음 모델 en 첫 사용)', mode: 'word', query: 'glorptastic', lang: 'all' },
    { name: '단어: time + 주제 사랑 (주제 자료 첫 사용)', mode: 'word', query: 'time', lang: 'all', topic: '사랑', topicWeight: 5 },
    { name: '단어: 주제 가중치만 변경 (재채점)', mode: 'word', query: 'time', lang: 'all', topic: '사랑', topicWeight: 9 },
    { name: '단어: 빈도 가중치만 변경 (재채점)', mode: 'word', query: 'time', lang: 'all', topic: '사랑', topicWeight: 9, frequencyWeight: 8 },
    { name: '연결: 사랑해 (한국어, 연결 자료 첫 사용)', mode: 'linked', query: '사랑해', lang: 'ko' },
    { name: '연결: whatever (영어)', mode: 'linked', query: 'whatever', lang: 'en' },
    { name: '연결: 사랑해 (전체)', mode: 'linked', query: '사랑해', lang: 'all' },
    { name: '연결: 사랑해 + 주제 이별 (연결 주제 자료 첫 사용)', mode: 'linked', query: '사랑해', lang: 'all', topic: '이별', topicWeight: 5 },
    { name: '연결: 빈도 가중치만 변경 (재채점)', mode: 'linked', query: '사랑해', lang: 'all', topic: '이별', topicWeight: 5, frequencyWeight: 6 },
];

async function waitReady(page, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try { if (await page.evaluate('typeof isReady !== "undefined" && isReady === true')) return Date.now() - page.started; } catch { /* navigating */ }
        if (Date.now() > deadline) throw new Error('page did not become ready');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

const report = { measured_at: new Date().toISOString(), cpu_throttling: cpuRate, profiles: [] };
const staged = stagePreview();
for (const name of profiles) {
    const profile = PROFILES[name];
    if (!profile) throw new Error(`unknown profile ${name}`);
    const { server, stats } = throttledServer(staged.output, profile);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/rhymePJ/`;
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhyme-measure-'));
    const { cdp, child } = await launchChrome(profileDir);
    const entry = { profile: name, label: profile.label, steps: [] };
    try {
        console.log(`\n== ${profile.label}`);
        const page = await openPage(cdp, url);
        entry.ready_ms = await waitReady(page);
        const bytesAtReady = stats.bytes;
        await page.evaluate(HELPERS);
        console.log(`  준비: ${entry.ready_ms}ms (${(bytesAtReady / 1e6).toFixed(2)}MB)`);
        for (const step of STEPS) {
            const before = stats.bytes;
            const result = await page.evaluate(`window.__measure.search(${JSON.stringify(step)})`);
            const row = { name: step.name, ms: result.ms, downloaded_mb: +((stats.bytes - before) / 1e6).toFixed(2), results: result.results, status: result.status };
            entry.steps.push(row);
            console.log(`  ${row.name}: ${row.ms}ms, ${row.downloaded_mb}MB — ${row.status}`);
        }
        entry.heap = await page.heap();
        entry.total_downloaded_mb = +(stats.bytes / 1e6).toFixed(1);
        console.log(`  메모리: ${JSON.stringify(entry.heap)}, 총 ${entry.total_downloaded_mb}MB`);
        // Revisit in a new tab: same profile, HTTP cache warm.
        const bytesBefore = stats.bytes;
        const again = await openPage(cdp, url);
        entry.revisit_ready_ms = await waitReady(again);
        await again.evaluate(HELPERS);
        const first = await again.evaluate(`window.__measure.search(${JSON.stringify(STEPS[0])})`);
        entry.revisit_first_search_ms = first.ms;
        entry.revisit_downloaded_mb = +((stats.bytes - bytesBefore) / 1e6).toFixed(2);
        console.log(`  재방문: 준비 ${entry.revisit_ready_ms}ms, 첫 검색 ${first.ms}ms, 받은 양 ${entry.revisit_downloaded_mb}MB`);
    } finally {
        child.kill();
        server.close();
        await new Promise(resolve => setTimeout(resolve, 500));
        try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* Chrome may hold a file briefly */ }
    }
    report.profiles.push(entry);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nsaved ${out}`);
