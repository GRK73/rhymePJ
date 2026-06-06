const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_STABLE_PASSES = 3;

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

function loadLinkedHelpers() {
    const context = {
        console,
        ipaFeatures: {},
        calculateScore: () => ({ score: 0, matchIndices: [] }),
        remapDetailMultipliers: (values) => values
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/linkedRhyme.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'public/js/linkedRhyme.js' });
    return context;
}

function createRng(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return ((state >>> 0) / 0x100000000);
    };
}

function randomInt(rng, max) {
    return Math.floor(rng() * max);
}

function isKoreanText(value) {
    return /^[가-힣]+$/.test(String(value || ''));
}

function getSurfaceFollowers(payload) {
    if (!Array.isArray(payload)) return [];
    if (Array.isArray(payload[1])) return payload[1];
    return [];
}

function parseFollower(row) {
    if (!Array.isArray(row)) return null;
    return {
        surface: String(row[0] || ''),
        count: Number(row[1]) || 0,
        score: Number(row[2]) || 0,
        normalized: String(row[3] || '')
    };
}

function buildSurfacePairs(surfaceEntries) {
    const pairs = [];
    for (const [head, payload] of Object.entries(surfaceEntries)) {
        if (!isKoreanText(head)) continue;
        const normalizedHead = Array.isArray(payload) ? String(payload[0] || '') : '';
        const followers = getSurfaceFollowers(payload);
        followers.forEach(row => {
            const follower = parseFollower(row);
            if (!follower || !isKoreanText(follower.surface)) return;
            pairs.push({ head, normalizedHead, follower });
        });
    }
    return pairs;
}

function buildHeadSuffixIndex(surfaceEntries, helpers) {
    const index = new Map();
    for (const [surfaceHead, payload] of Object.entries(surfaceEntries)) {
        if (!isKoreanText(surfaceHead)) continue;
        const headChars = Array.from(surfaceHead);
        for (let size = 1; size <= Math.min(2, headChars.length); size++) {
            const suffix = headChars.slice(headChars.length - size).join('');
            const leftSurfaceMatch = vm.runInContext(
                `getBoundarySurfaceMatch(${JSON.stringify(surfaceHead)}, ${JSON.stringify(suffix)}, "end")`,
                helpers
            );
            if (!index.has(suffix)) index.set(suffix, []);
            index.get(suffix).push({ surfaceHead, payload, leftSurfaceMatch });
        }
    }

    for (const candidates of index.values()) {
        candidates.sort((a, b) => b.leftSurfaceMatch.score - a.leftSurfaceMatch.score);
    }
    return index;
}

function buildSplits(query) {
    const chars = Array.from(query);
    const splits = [];
    for (let index = 1; index < chars.length; index++) {
        splits.push({
            leftText: chars.slice(0, index).join(''),
            rightText: chars.slice(index).join(''),
            label: `${chars.slice(0, index).join('')} / ${chars.slice(index).join('')}`
        });
    }
    return splits;
}

function sampleCase(pairs, length, rng, usedQueries) {
    for (let attempt = 0; attempt < 5000; attempt++) {
        const pair = pairs[randomInt(rng, pairs.length)];
        const headChars = Array.from(pair.head);
        const followerChars = Array.from(pair.follower.surface);
        if (headChars.length < 1 || followerChars.length < 1) continue;

        const splitOptions = length === 2
            ? [[1, 1]]
            : [[1, 2], [2, 1]].filter(([left, right]) => headChars.length >= left && followerChars.length >= right);
        if (splitOptions.length === 0) continue;

        const [leftLength, rightLength] = splitOptions[randomInt(rng, splitOptions.length)];
        const leftText = headChars.slice(headChars.length - leftLength).join('');
        const rightText = followerChars.slice(0, rightLength).join('');
        const query = `${leftText}${rightText}`;
        if (Array.from(query).length !== length || !isKoreanText(query) || usedQueries.has(query)) continue;

        usedQueries.add(query);
        return {
            query,
            expectedHead: pair.head,
            expectedFollower: pair.follower.surface,
            expectedSplit: `${leftText} / ${rightText}`
        };
    }

    throw new Error(`unable to sample a unique ${length}-character Korean query`);
}

function generateCases(pairs, rng) {
    const usedQueries = new Set();
    const cases = [];
    for (let index = 0; index < 10; index++) cases.push(sampleCase(pairs, 2, rng, usedQueries));
    for (let index = 0; index < 10; index++) cases.push(sampleCase(pairs, 3, rng, usedQueries));
    return cases;
}

function bracketContainsQuery(display, query) {
    const match = String(display || '').match(/\[([^ ]+) ([^\]]+)\]/);
    return Boolean(match && `${match[1]}${match[2]}` === query);
}

function runSurfaceSearch(query, headSuffixIndex, helpers, allowFirstParticle = true) {
    const splits = buildSplits(query);
    const results = [];

    for (const split of splits) {
        (headSuffixIndex.get(split.leftText) || [])
            .filter(firstCandidate => {
                const normalizedHead = Array.isArray(firstCandidate.payload) ? String(firstCandidate.payload[0] || '') : '';
                return allowFirstParticle || !normalizedHead || normalizedHead === firstCandidate.surfaceHead;
            })
            .forEach(firstCandidate => {
                getSurfaceFollowers(firstCandidate.payload).forEach(row => {
                    const follower = parseFollower(row);
                    if (!follower || !follower.surface) return;
                    const rightSurfaceMatch = vm.runInContext(
                        `getBoundarySurfaceMatch(${JSON.stringify(follower.surface)}, ${JSON.stringify(split.rightText)}, "start")`,
                        helpers
                    );
                    if (rightSurfaceMatch.score <= 0) return;

                    const matchType = vm.runInContext(
                        `getSurfaceMatchType(${JSON.stringify(firstCandidate.leftSurfaceMatch)}, ${JSON.stringify(rightSurfaceMatch)})`,
                        helpers
                    );
                    const display = vm.runInContext(
                        `formatSurfaceLinkedDisplay(${JSON.stringify(firstCandidate.surfaceHead)}, ${JSON.stringify(follower.surface)}, ${JSON.stringify(split.leftText)}, ${JSON.stringify(split.rightText)})`,
                        helpers
                    );
                    const boundary = vm.runInContext(`getWeightedLinkedBoundaryScore({
                        leftSurfaceMatch: ${JSON.stringify(firstCandidate.leftSurfaceMatch)},
                        rightSurfaceMatch: ${JSON.stringify(rightSurfaceMatch)},
                        leftPhoneticScore: ${firstCandidate.leftSurfaceMatch.score},
                        rightPhoneticScore: ${rightSurfaceMatch.score},
                        leftDetailMultipliers: [1],
                        rightDetailMultipliers: [1]
                    })`, helpers);

                    results.push({
                        query,
                        display,
                        splitLabel: split.label,
                        matchType: matchType.type,
                        score: boundary.score,
                        surfaceScore: boundary.exactBoundaryScore,
                        count: follower.count
                    });
                });
            });
    }

    return results.sort((a, b) => b.score - a.score || b.count - a.count);
}

function validateCase(testCase, headSuffixIndex, helpers) {
    const results = runSurfaceSearch(testCase.query, headSuffixIndex, helpers, true);
    const top = results[0];
    const exactResults = results.filter(result => result.matchType === 'exact-surface' && bracketContainsQuery(result.display, testCase.query));

    const failures = [];
    if (results.length === 0) failures.push('no-results');
    if (exactResults.length === 0) failures.push('no-exact-boundary-result');
    if (top && top.matchType !== 'exact-surface') failures.push(`top-not-exact:${top.matchType}`);
    if (top && !bracketContainsQuery(top.display, testCase.query)) failures.push(`top-bracket-mismatch:${top.display}`);

    return {
        ...testCase,
        passed: failures.length === 0,
        failures,
        resultCount: results.length,
        top: top || null
    };
}

function parseArgs() {
    const args = new Map();
    process.argv.slice(2).forEach(arg => {
        const [key, value] = arg.split('=');
        args.set(key.replace(/^--/, ''), value || true);
    });
    return {
        maxIterations: Number(args.get('iterations')) || DEFAULT_MAX_ITERATIONS,
        stablePasses: Number(args.get('stable-passes')) || DEFAULT_STABLE_PASSES,
        seed: Number(args.get('seed')) || Date.now()
    };
}

function main() {
    const options = parseArgs();
    const rng = createRng(options.seed);
    const helpers = loadLinkedHelpers();
    const surfaceData = readJson('public/data/model/bigram_surface_ko.json');
    const surfaceEntries = surfaceData.entries || surfaceData;
    const pairs = buildSurfacePairs(surfaceEntries);
    const headSuffixIndex = buildHeadSuffixIndex(surfaceEntries, helpers);

    if (pairs.length === 0) {
        throw new Error('surface bigram data has no usable Korean pairs');
    }

    console.log(`Linked search validation seed=${options.seed} pairs=${pairs.length}`);

    let stablePassCount = 0;
    for (let iteration = 1; iteration <= options.maxIterations; iteration++) {
        const cases = generateCases(pairs, rng);
        const results = cases.map(testCase => validateCase(testCase, headSuffixIndex, helpers));
        const failures = results.filter(result => !result.passed);

        console.log(`\nIteration ${iteration}: ${results.length - failures.length}/${results.length} passed`);
        results.forEach(result => {
            const topDisplay = result.top ? `${result.top.display} (${result.top.matchType}, ${result.top.score.toFixed(1)})` : '-';
            console.log(`  ${result.passed ? 'PASS' : 'FAIL'} ${result.query} <- ${result.expectedHead} + ${result.expectedFollower} | top=${topDisplay}`);
            if (!result.passed) console.log(`    failures=${result.failures.join(', ')}`);
        });

        if (failures.length > 0) {
            console.error(`\nIteration ${iteration} failed. Fix logic before starting the next iteration.`);
            process.exit(1);
        }

        stablePassCount += 1;
        if (stablePassCount >= options.stablePasses) {
            console.log(`\nEarly stopping: ${stablePassCount} consecutive stable iterations passed.`);
            return;
        }
    }

    console.log(`\nCompleted ${options.maxIterations} iterations without failures.`);
}

main();
