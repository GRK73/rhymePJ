'use strict';

// Assembles the GitHub Pages artifact from public/: only the app files the reviewed
// allowlist names, plus the V2 search assets whose manifests it pins (check_search_assets.js
// verifies them). The staged copy gets a generated allowlist listing every file, and the
// whole directory is checked (check_deployment_artifact.js) before it replaces the output.

const fs = require('fs');
const path = require('path');

const { checkArtifact } = require('./check_deployment_artifact');
const { checkSearchAssets } = require('./check_search_assets');

const GENERATED_ALLOWLIST_PATH = 'data/deployment-allowlist.json';

function fail(message) {
    throw new Error(message);
}

function normalizeRelative(value, label) {
    if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
        fail(`${label} has an invalid relative path: ${String(value)}`);
    }
    const normalized = path.normalize(value).split(path.sep).join('/').replace(/^\.\//, '');
    if (normalized === '..' || normalized.startsWith('../')) {
        fail(`${label} escapes its source root: ${value}`);
    }
    return normalized;
}

function sourceFile(root, relativePath, label) {
    const absolutePath = path.resolve(root, relativePath);
    const relative = path.relative(path.resolve(root), absolutePath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        fail(`${label} escapes its source root: ${relativePath}`);
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        fail(`${label} is missing: ${relativePath}`);
    }
    if (fs.lstatSync(absolutePath).isSymbolicLink()) {
        fail(`${label} must not be a symbolic link: ${relativePath}`);
    }
    return absolutePath;
}

function copyFile(source, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
}

function replaceDirectory(stagedDirectory, outputDirectory) {
    const output = path.resolve(outputDirectory);
    const parent = path.dirname(output);
    const base = path.basename(output);
    if (!base || output === path.parse(output).root) fail('Refusing to replace an unsafe artifact output path.');
    const backup = path.join(parent, `${base}.previous-${process.pid}-${Date.now()}`);
    if (fs.existsSync(backup)) fail(`Generated artifact backup already exists: ${backup}`);
    if (fs.existsSync(output)) {
        const marker = path.join(output, GENERATED_ALLOWLIST_PATH);
        let generated = null;
        try {
            generated = JSON.parse(fs.readFileSync(marker, 'utf8'));
        } catch (_) {
            // A pre-existing non-generated directory must never be replaced.
        }
        if (!generated?.staged_search_assets?.manifests) {
            fail(`Refusing to replace a directory that is not a generated Pages artifact: ${output}`);
        }
        fs.renameSync(output, backup);
    }
    try {
        fs.renameSync(stagedDirectory, output);
        if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
        if (!fs.existsSync(output) && fs.existsSync(backup)) fs.renameSync(backup, output);
        throw error;
    }
}

function stagePagesArtifact(options = {}) {
    const publicRoot = path.resolve(options.publicRoot || path.join(process.cwd(), 'public'));
    const outputRoot = path.resolve(options.outputRoot || path.join(process.cwd(), 'build', 'pages'));
    const allowlistPath = path.resolve(options.allowlistPath || path.join(publicRoot, GENERATED_ALLOWLIST_PATH));
    if (!fs.existsSync(allowlistPath)) fail(`Reviewed deployment allowlist is missing: ${allowlistPath}`);
    const policy = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    if (policy.schema_version !== 2 || policy.reviewed !== true || !Array.isArray(policy.allowed_files)) {
        fail('Source deployment allowlist must have schema_version=2, reviewed=true, and allowed_files.');
    }
    const pins = policy.search_assets?.manifest_sha256;
    if (!pins || typeof pins !== 'object' || !Object.values(pins).every(value => /^[a-f0-9]{64}$/.test(String(value)))) {
        fail('Reviewed deployment allowlist must pin search_assets.manifest_sha256.');
    }

    const assets = checkSearchAssets(publicRoot, pins);
    const assetFiles = new Set(assets.files);
    const expandedFiles = new Set(
        policy.allowed_files.map((value, index) => normalizeRelative(value, `allowed_files[${index}]`))
    );
    if (!expandedFiles.has(GENERATED_ALLOWLIST_PATH)) {
        fail(`Source deployment allowlist must include ${GENERATED_ALLOWLIST_PATH}.`);
    }
    // Asset files come from their verified manifests only.
    for (const relativePath of expandedFiles) {
        if (relativePath.startsWith('assets/') && relativePath !== 'assets/sound_icon.png' && !assetFiles.has(relativePath)) {
            fail(`Unmanifested search asset is allowlisted: ${relativePath}`);
        }
    }
    for (const relativePath of assetFiles) expandedFiles.add(relativePath);
    sourceFile(publicRoot, 'index.html', 'App entrypoint');

    const parent = path.dirname(outputRoot);
    const temporaryRoot = path.join(parent, `${path.basename(outputRoot)}.staging-${process.pid}-${Date.now()}`);
    fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.mkdirSync(temporaryRoot, { recursive: true });
    try {
        for (const relativePath of [...expandedFiles].sort()) {
            if (relativePath === GENERATED_ALLOWLIST_PATH) continue;
            copyFile(sourceFile(publicRoot, relativePath, 'Public asset'), path.join(temporaryRoot, relativePath));
        }
        const generatedPolicy = {
            ...policy,
            allowed_files: [...expandedFiles].sort(),
            staged_search_assets: { manifests: assets.manifests, files: assets.files.length, bytes: assets.bytes },
        };
        const generatedPolicyPath = path.join(temporaryRoot, GENERATED_ALLOWLIST_PATH);
        fs.mkdirSync(path.dirname(generatedPolicyPath), { recursive: true });
        fs.writeFileSync(generatedPolicyPath, `${JSON.stringify(generatedPolicy, null, 2)}\n`, 'utf8');
        const checked = checkArtifact(temporaryRoot, generatedPolicyPath);
        replaceDirectory(temporaryRoot, outputRoot);
        return { outputRoot, fileCount: checked.fileCount, totalBytes: checked.totalBytes, assetBytes: assets.bytes };
    } catch (error) {
        if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
        throw error;
    }
}

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--public-root' && argv[index + 1]) result.publicRoot = argv[++index];
        else if (argv[index] === '--output' && argv[index + 1]) result.outputRoot = argv[++index];
        else if (argv[index] === '--allowlist' && argv[index + 1]) result.allowlistPath = argv[++index];
        else fail(`Unknown or incomplete argument: ${argv[index]}`);
    }
    return result;
}

if (require.main === module) {
    try {
        const result = stagePagesArtifact(parseArgs(process.argv.slice(2)));
        console.log(`Pages artifact staged: ${result.fileCount} files, ${result.totalBytes} bytes (search assets ${result.assetBytes} bytes)`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = { stagePagesArtifact };
