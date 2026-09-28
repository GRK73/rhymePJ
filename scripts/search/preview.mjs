// Local preview of the static site at /rhymePJ/ (the GitHub Pages prefix).
// Stages public/ into build/preview without data/ (build inputs and the restricted
// corpus are not part of the site) and without dot files, then serves it read-only.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css',
    '.json':'application/json','.gz':'application/gzip','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.woff2':'font/woff2'};

// Resolves a request path inside root, refusing anything that escapes it.
function inside(root, relative) {
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error('Path escapes root');
    return file;
}

export function stagePreview(projectRoot = ROOT) {
    const build = path.join(projectRoot, 'build');
    const output = path.join(build, 'preview');
    const publicRoot = path.join(projectRoot, 'public');
    // Output is disposable, but must remain a real directory below this workspace.
    for (const candidate of [build, output]) {
        if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new Error('Preview output must not be a symbolic link');
    }
    fs.mkdirSync(build, {recursive:true});
    if (!fs.realpathSync(build).startsWith(fs.realpathSync(projectRoot) + path.sep)) throw new Error('Preview output escapes workspace');
    if (fs.existsSync(output)) fs.rmSync(output, {recursive:true, force:true});
    fs.mkdirSync(output, {recursive:true});
    let files = 0;
    function copy(directory, target, relative = '') {
        for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
            const next = relative ? relative + '/' + entry.name : entry.name;
            if (next === 'data' || entry.name.startsWith('.')) continue;
            if (entry.isSymbolicLink()) throw new Error(`Preview source must not be a symbolic link: ${next}`);
            const source = path.join(directory, entry.name), destination = path.join(target, entry.name);
            if (entry.isDirectory()) { fs.mkdirSync(destination, {recursive:true}); copy(source, destination, next); }
            else if (MIME[path.extname(entry.name)] || entry.name === 'LICENSE') { fs.copyFileSync(source, destination); files++; }
        }
    }
    copy(publicRoot, output);
    fs.writeFileSync(path.join(output, 'preview-only.json'), JSON.stringify({purpose:'Local development only; not a reviewed Pages release', files}, null, 2) + '\n');
    return { output, files };
}

export function createStaticServer(directory) {
    const root = path.resolve(directory);
    return http.createServer((request, response) => {
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
        try {
            const url = new URL(request.url, 'http://localhost');
            if (!url.pathname.startsWith('/rhymePJ/')) {
                response.writeHead(302, {Location:'/rhymePJ/' + url.pathname.replace(/^\/+/, '') + url.search}).end(); return;
            }
            const relative = decodeURIComponent(url.pathname.slice('/rhymePJ/'.length)) || 'index.html';
            if (relative.split(/[\\/]/).some(part => part.startsWith('.')) || relative.startsWith('api/')) { response.writeHead(404).end(); return; }
            const file = inside(root, relative);
            if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
            if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) throw new Error('File escapes root');
            response.writeHead(200, {'Content-Type':MIME[path.extname(file)] || 'application/octet-stream',
                'Content-Length':fs.statSync(file).size, 'Cache-Control':'no-cache'});
            if (request.method === 'HEAD') response.end();
            else fs.createReadStream(file).pipe(response);
        } catch { response.writeHead(400).end(); }
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    // --serve DIR serves an already staged directory (e.g. a Pages artifact) as it is.
    const serveIndex = process.argv.indexOf('--serve');
    const staged = serveIndex > 0
        ? { output: path.resolve(process.argv[serveIndex + 1]), files: 'staged' }
        : stagePreview();
    const port = Number(process.env.RHYME_APP_PORT || 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RHYME_APP_PORT must be 1..65535');
    const server = createStaticServer(staged.output);
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Search preview: http://127.0.0.1:${port}/rhymePJ/ (${staged.files} static files; no Python/API server)`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
