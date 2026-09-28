import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stagePreview, createStaticServer } from '../../scripts/search/preview.mjs';

test('staged preview serves the site below the Pages prefix and excludes data/, dot files and API', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhyme-preview-test-'));
    let server;
    try {
        for (const [name, content] of Object.entries({
            'public/index.html':'<h1>search</h1>',
            'public/js/app.js':'globalThis.searchOnly = true;',
            'public/assets/lexicon/v1/lexicon.bin.gz':'compressed-test-fixture',
            'public/data/model/rhyme_dict_practical.json':'[]',
            'public/data/corpus/private.json':'{"private":true}',
            'public/.secret.json':'{}',
        })) {
            const file = path.join(root, name);
            fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, content);
        }
        const {output} = stagePreview(root);
        assert.ok(!fs.existsSync(path.join(output, 'data')));
        assert.ok(!fs.existsSync(path.join(output, '.secret.json')));
        server = createStaticServer(output);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const page = await fetch(base);
        assert.equal(new URL(page.url).pathname, '/rhymePJ/');
        assert.equal(await page.text(), '<h1>search</h1>');
        const gzip = await fetch(base + '/rhymePJ/assets/lexicon/v1/lexicon.bin.gz');
        assert.equal(gzip.status, 200); assert.equal(gzip.headers.get('content-type'), 'application/gzip');
        for (const route of ['api/v2/health', 'data/model/rhyme_dict_practical.json', 'data/corpus/private.json', '.secret.json', '../package.json']) {
            assert.equal((await fetch(base + '/rhymePJ/' + route)).status, 404, route);
        }
        assert.equal((await fetch(base + '/rhymePJ/', {method:'POST'})).status, 405);
        assert.equal((await fetch(base + '/rhymePJ/js/app.js', {method:'HEAD'})).status, 200);
        fs.writeFileSync(path.join(output, 'obsolete.json'), '{}');
        stagePreview(root);
        assert.ok(!fs.existsSync(path.join(output, 'obsolete.json')));
    } finally {
        if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, {recursive:true, force:true});
    }
});
