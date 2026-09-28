// Main-thread client for public/workers/word-worker.js.
// Searches take well under a second once the lexicon is loaded, so a cancelled or
// superseded request is released immediately and its late reply is ignored; the
// Worker (and its loaded lexicon) is only replaced after an error or a timeout.
// The timeout counts silence, not total time: every progress message (download bytes,
// phases) restarts it, so a slow connection can finish a long download.
(function (root) {
    'use strict';
    const scriptUrl = typeof document !== 'undefined' ? document.currentScript?.src : null;
    const defaultWorkerUrl = scriptUrl ? new URL('../../workers/word-worker.js?v=20260928-jamo1', scriptUrl).href : null;
    const failure = (code, message) => Object.assign(new Error(message), { code });

    class WordSearchRuntime {
        constructor({ workerUrl = defaultWorkerUrl, workerFactory = url => new Worker(url), timeoutMs = 180000 } = {}) {
            this.workerUrl = workerUrl;
            this.workerFactory = workerFactory;
            this.timeoutMs = timeoutMs;
            this.worker = null;
            this.pending = new Map();
            this.nextId = 0;
            this.initPromise = null;
            this.initListeners = new Set();
        }

        _stop(error) {
            const worker = this.worker;
            this.worker = null;
            this.initPromise = null;
            worker?.terminate();
            for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
            this.pending.clear();
        }

        _ensureWorker() {
            if (this.worker) return this.worker;
            const worker = this.workerFactory(this.workerUrl);
            this.worker = worker;
            worker.onmessage = event => { if (this.worker === worker) this._handle(event.data || {}); };
            worker.onerror = event => {
                if (this.worker === worker) this._stop(failure('word_worker_failed', event.message || 'word search worker failed'));
            };
            worker.onmessageerror = () => {
                if (this.worker === worker) this._stop(failure('word_worker_failed', 'word search response could not be decoded'));
            };
            return worker;
        }

        _handle(message) {
            const pending = this.pending.get(message.request_id);
            if (!pending) return;
            if (message.type === 'progress') { pending.arm(); pending.onProgress?.(message.progress); return; }
            this.pending.delete(message.request_id);
            clearTimeout(pending.timer);
            if (message.type === 'error') pending.reject(failure(message.error?.code || 'word_search_failed', message.error?.message || 'word search failed'));
            else pending.resolve(message);
        }

        // Resolves with the Worker's reply message; abort releases the caller at once.
        _request(type, payload = {}, { signal, onProgress } = {}) {
            if (signal?.aborted) return Promise.reject(failure('search_cancelled', 'search cancelled'));
            let worker;
            try { worker = this._ensureWorker(); } catch (error) { this._stop(error); return Promise.reject(error); }
            const requestId = `word_${++this.nextId}`;
            return new Promise((resolve, reject) => {
                const release = () => {
                    const pending = this.pending.get(requestId);
                    if (!pending) return;
                    this.pending.delete(requestId);
                    clearTimeout(pending.timer);
                    // The Worker drops the search (and never keeps its results for paging).
                    if (this.worker === worker) try { worker.postMessage({ type: 'cancel', target: requestId }); } catch { /* worker gone */ }
                    reject(failure('search_cancelled', 'search cancelled'));
                };
                const entry = {
                    onProgress, timer: null,
                    arm: () => {
                        clearTimeout(entry.timer);
                        entry.timer = setTimeout(() => {
                            if (this.worker === worker && this.pending.has(requestId)) this._stop(failure('search_timeout', 'word search timed out'));
                        }, this.timeoutMs);
                    },
                    resolve: value => { signal?.removeEventListener('abort', release); resolve(value); },
                    reject: error => { signal?.removeEventListener('abort', release); reject(error); },
                };
                entry.arm();
                this.pending.set(requestId, entry);
                signal?.addEventListener('abort', release, { once: true });
                try { worker.postMessage({ type, request_id: requestId, ...payload }); } catch (error) { this._stop(error); }
            });
        }

        // Loads the lexicon once; a cancelled caller does not cancel the shared load.
        init({ signal, onProgress } = {}) {
            if (!this.initPromise) {
                const shared = this._request('init', {}, { onProgress: progress => this.initListeners.forEach(listener => listener(progress)) })
                    .catch(error => { if (this.initPromise === shared) this.initPromise = null; throw error; });
                this.initPromise = shared;
            }
            if (!signal && !onProgress) return this.initPromise;
            const listener = progress => onProgress?.(progress);
            this.initListeners.add(listener);
            return new Promise((resolve, reject) => {
                const abort = () => reject(failure('search_cancelled', 'search cancelled'));
                if (signal?.aborted) { abort(); return; }
                signal?.addEventListener('abort', abort, { once: true });
                this.initPromise.then(resolve, reject).finally(() => {
                    this.initListeners.delete(listener);
                    signal?.removeEventListener('abort', abort);
                });
            });
        }

        async resolve(query, options = {}) {
            await this.init(options);
            return (await this._request('resolve', { query }, options)).resolved;
        }

        async search(request, options = {}) {
            await this.init(options);
            return (await this._request('search', { request }, options)).result;
        }

        async linked(request, options = {}) {
            await this.init(options);
            return (await this._request('linked', { request }, options)).result;
        }

        // Pages the results of one search (result.searchId), never those of a later one.
        async page(searchId, offset, count, options = {}) {
            return (await this._request('page', { searchId, offset, count }, options)).items;
        }

        dispose() { this._stop(failure('search_cancelled', 'runtime disposed')); }
    }

    root.RhymeWordSearchRuntime = WordSearchRuntime;
    if (scriptUrl) root.wordSearchRuntime = new WordSearchRuntime();
})(globalThis);
