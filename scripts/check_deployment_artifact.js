'use strict';

const fs = require('fs');
const path = require('path');

const MIB = 1024 * 1024;
const DEFAULT_TOTAL_LIMIT = 900 * MIB;
const DEFAULT_FILE_LIMIT = 95 * MIB;
const ALWAYS_DENIED = [
    /^data\/corpus(?:\/|$)/i,
    /(?:^|\/)\.env(?:\.|$)/i,
    /(?:^|\/)(?:[^/]+\.)?(?:sqlite3?|db|parquet|safetensors|pt|pth)$/i,
];
const SERVER_ONLY_API_PATTERN = /(?:^|[^a-z0-9_])\/?api\/v2\/generate(?:[^a-z0-9_]|$)/i;
const EXTERNAL_EXECUTABLE_HTML_PATTERN = /<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']https?:\/\//i;
const EXTERNAL_FETCH_PATTERN = /\b(?:fetch|importScripts)\s*\(\s*["'`]https?:\/\//i;
// No exceptions: topics are compared in one ko/en meaning space, nothing is translated (2026-09-28).

function fail(message) {
    throw new Error(message);
}

function normalizeRelative(value) {
    return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function walkFiles(rootDir) {
    const files = [];
    const pending = [rootDir];
    while (pending.length > 0) {
        const current = pending.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = path.join(current, entry.name);
            if (entry.isSymbolicLink()) {
                fail(`Symbolic links are not allowed in the Pages artifact: ${normalizeRelative(path.relative(rootDir, absolutePath))}`);
            }
            if (entry.isDirectory()) {
                pending.push(absolutePath);
            } else if (entry.isFile()) {
                files.push(absolutePath);
            }
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}

function readAllowlist(allowlistPath) {
    if (!fs.existsSync(allowlistPath)) {
        fail(`Reviewed deployment allowlist is missing: ${allowlistPath}`);
    }
    const value = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    if (value.schema_version !== 2 || value.reviewed !== true || !Array.isArray(value.allowed_files)) {
        fail('Deployment allowlist must have schema_version=2, reviewed=true, and an allowed_files array.');
    }
    const allowedFiles = new Set();
    for (const file of value.allowed_files) {
        if (typeof file !== 'string' || !file || path.isAbsolute(file)) {
            fail(`Invalid allowlist path: ${String(file)}`);
        }
        const normalized = normalizeRelative(path.normalize(file));
        if (normalized === '..' || normalized.startsWith('../')) {
            fail(`Allowlist path escapes the artifact root: ${file}`);
        }
        allowedFiles.add(normalized);
    }
    return allowedFiles;
}

function checkArtifact(rootDir, allowlistPath, options = {}) {
    const resolvedRoot = path.resolve(rootDir);
    if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
        fail(`Pages artifact root is not a directory: ${resolvedRoot}`);
    }

    const allowedFiles = readAllowlist(path.resolve(allowlistPath));
    const totalLimit = options.totalLimit ?? DEFAULT_TOTAL_LIMIT;
    const fileLimit = options.fileLimit ?? DEFAULT_FILE_LIMIT;
    const files = walkFiles(resolvedRoot);
    let totalBytes = 0;
    const seen = new Set();

    for (const absolutePath of files) {
        const relativePath = normalizeRelative(path.relative(resolvedRoot, absolutePath));
        const size = fs.statSync(absolutePath).size;
        seen.add(relativePath);
        totalBytes += size;

        if (ALWAYS_DENIED.some(pattern => pattern.test(relativePath))) {
            fail(`Forbidden source or model asset in Pages artifact: ${relativePath}`);
        }
        if (!allowedFiles.has(relativePath)) {
            fail(`File is absent from the reviewed deployment allowlist: ${relativePath}`);
        }
        if (size > fileLimit) {
            fail(`File exceeds ${(fileLimit / MIB).toFixed(0)} MiB: ${relativePath} (${size} bytes)`);
        }
        if (/\.(?:html?|js)$/i.test(relativePath)) {
            const source = fs.readFileSync(absolutePath, 'utf8');
            if (SERVER_ONLY_API_PATTERN.test(source)) {
                fail(`Server-only generation API remains in the static Pages artifact: ${relativePath}`);
            }
            if (/\.html?$/i.test(relativePath) && EXTERNAL_EXECUTABLE_HTML_PATTERN.test(source)) {
                fail(`External executable dependency remains in the static Pages artifact: ${relativePath}`);
            }
            if (/\.js$/i.test(relativePath) && EXTERNAL_FETCH_PATTERN.test(source)) {
                fail(`Automatic external fetch remains in the static Pages artifact: ${relativePath}`);
            }
        }
    }

    const missing = [...allowedFiles].filter(relativePath => !seen.has(relativePath));
    if (missing.length > 0) {
        fail(`Allowlisted files are missing from the artifact: ${missing.slice(0, 10).join(', ')}`);
    }
    if (totalBytes > totalLimit) {
        fail(`Artifact exceeds ${(totalLimit / MIB).toFixed(0)} MiB (${totalBytes} bytes)`);
    }

    return { fileCount: files.length, totalBytes };
}

function parseArgs(argv) {
    const result = {
        root: path.join(process.cwd(), 'public'),
        allowlist: path.join(process.cwd(), 'public', 'data', 'deployment-allowlist.json'),
    };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--root' && argv[index + 1]) result.root = argv[++index];
        else if (argv[index] === '--allowlist' && argv[index + 1]) result.allowlist = argv[++index];
        else fail(`Unknown or incomplete argument: ${argv[index]}`);
    }
    return result;
}

if (require.main === module) {
    try {
        const args = parseArgs(process.argv.slice(2));
        const result = checkArtifact(args.root, args.allowlist);
        console.log(`Deployment artifact passed: ${result.fileCount} files, ${result.totalBytes} bytes`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = { checkArtifact };
