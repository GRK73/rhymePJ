import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(timeoutMs = 1000) {
    const ctx = vm.createContext({ URL, setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync('public/js/search/word-runtime.js', 'utf8'), ctx);
    const workers = [];
    const runtime = new ctx.RhymeWordSearchRuntime({ timeoutMs, workerUrl: 'http://local/word-worker.js', workerFactory: () => {
        const worker = { messages: [], postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
        workers.push(worker);
        return worker;
    } });
    const last = (worker, type) => worker.messages.filter(message => !type || message.type === type).at(-1);
    const reply = (worker, message, type, payload = {}) => worker.onmessage({ data: { type, request_id: message.request_id, ...payload } });
    return { runtime, workers, last, reply };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function ready({ runtime, workers, last, reply }) {
    const init = runtime.init();
    reply(workers[0], last(workers[0], 'init'), 'ready', { status: { words: 1 } });
    await init;
}

test('search resolves with the worker result and relays progress', async () => {
    const env = setup();
    await ready(env);
    const phases = [];
    const search = env.runtime.search({ query: '사랑' }, { onProgress: progress => phases.push(progress.phase) });
    await tick();
    const message = env.last(env.workers[0], 'search');
    assert.equal(message.request.query, '사랑');
    env.reply(env.workers[0], message, 'progress', { progress: { phase: 'compute' } });
    env.reply(env.workers[0], message, 'result', { result: { total: 3 } });
    assert.deepEqual(await search, { total: 3 });
    assert.deepEqual(phases, ['compute']);
});

test('cancel releases the caller at once, keeps the worker and ignores the late reply', async () => {
    const env = setup();
    await ready(env);
    const controller = new AbortController();
    const cancelled = env.runtime.search({ query: 'time' }, { signal: controller.signal });
    await tick();
    const stale = env.last(env.workers[0], 'search');
    controller.abort();
    await assert.rejects(cancelled, error => error.code === 'search_cancelled');
    assert.equal(env.last(env.workers[0], 'cancel').target, stale.request_id, 'the Worker is told to drop the search');
    const next = env.runtime.search({ query: 'love' });
    await tick();
    env.reply(env.workers[0], stale, 'result', { result: { stale: true } });
    env.reply(env.workers[0], env.last(env.workers[0], 'search'), 'result', { result: { query: 'love' } });
    assert.deepEqual(await next, { query: 'love' });
    assert.equal(env.workers.length, 1, 'a cancel must not discard the loaded lexicon');
    assert.equal(env.workers[0].terminated, undefined);
});

test('worker crash or timeout rejects pending work and the next call starts a new worker', async () => {
    for (const failure of ['crash', 'decode', 'timeout']) {
        const env = setup(failure === 'timeout' ? 20 : 1000);
        await ready(env);
        const search = env.runtime.search({ query: 'time' });
        const rejected = assert.rejects(search, error => ['word_worker_failed', 'search_timeout'].includes(error.code));
        await tick();
        if (failure === 'crash') env.workers[0].onerror({ message: 'crashed' });
        if (failure === 'decode') env.workers[0].onmessageerror();
        await rejected;
        assert.equal(env.workers[0].terminated, true);
        const next = env.runtime.search({ query: 'love' });
        assert.equal(env.workers.length, 2);
        env.reply(env.workers[1], env.last(env.workers[1], 'init'), 'ready', { status: {} });
        await tick();
        env.reply(env.workers[1], env.last(env.workers[1], 'search'), 'result', { result: { query: 'love' } });
        assert.deepEqual(await next, { query: 'love' });
    }
});

test('a cancelled caller does not cancel the shared lexicon load', async () => {
    const env = setup();
    const controller = new AbortController();
    const first = env.runtime.init({ signal: controller.signal, onProgress: () => {} });
    const phases = [];
    const second = env.runtime.init({ onProgress: progress => phases.push(progress.phase) });
    controller.abort();
    await assert.rejects(first, error => error.code === 'search_cancelled');
    const init = env.last(env.workers[0], 'init');
    env.reply(env.workers[0], init, 'progress', { progress: { phase: 'lexicon' } });
    env.reply(env.workers[0], init, 'ready', { status: { words: 1 } });
    await second;
    assert.deepEqual(phases, ['lexicon']);
    assert.equal(env.workers[0].messages.filter(message => message.type === 'init').length, 1);
});

test('worker errors reject only that request', async () => {
    const env = setup();
    await ready(env);
    const search = env.runtime.search({ query: '' });
    await tick();
    env.reply(env.workers[0], env.last(env.workers[0], 'search'), 'error', { error: { code: 'no_pronunciation', message: 'none' } });
    await assert.rejects(search, error => error.code === 'no_pronunciation');
    const page = env.runtime.page('word_1', 0, 99);
    assert.equal(env.last(env.workers[0], 'page').searchId, 'word_1', 'a page names the search it belongs to');
    env.reply(env.workers[0], env.last(env.workers[0], 'page'), 'page', { items: [1] });
    assert.deepEqual(await page, [1]);
});

test('progress messages restart the timeout, so a slow download is not cut off', async () => {
    const env = setup(200); // 4 gaps of 120ms: far past the timeout in total, well inside it each time
    await ready(env);
    const search = env.runtime.search({ query: '사랑' });
    await tick();
    const message = env.last(env.workers[0], 'search');
    for (let i = 0; i < 4; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 120));
        env.reply(env.workers[0], message, 'progress', { progress: { phase: 'topic', completed: i, total: 4 } });
    }
    env.reply(env.workers[0], message, 'result', { result: { total: 1 } });
    assert.deepEqual(await search, { total: 1 });
    assert.equal(env.workers.length, 1);
    assert.ok(!env.workers[0].terminated);
});
