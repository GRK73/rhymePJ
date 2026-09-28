'use strict';

// Generates public/js/v2/phoneme-similarity-config.js from the single source of
// truth in configs/phoneme_similarity_v0.json. The browser cannot read the config
// directory, and the scoring functions are synchronous, so the constants are
// inlined into a plain script that works as a <script> tag, inside importScripts
// and inside the Node vm contexts used by the project checks.
//
// npm run check re-runs this generator in memory and fails when the committed
// output no longer matches the JSON.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT_DIR, 'configs', 'phoneme_similarity_v0.json');
const OUTPUT_PATH = path.join(ROOT_DIR, 'public', 'js', 'v2', 'phoneme-similarity-config.js');
const GOLDEN_PATH = path.join(ROOT_DIR, 'tests', 'fixtures', 'phoneme_similarity_golden_v0.json');
const EXPECTED_SCHEMA_VERSION = 1;

function readSourceConfig(sourcePath = SOURCE_PATH) {
    const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    if (payload.schema_version !== EXPECTED_SCHEMA_VERSION) {
        throw new Error(`unsupported phoneme similarity schema: ${payload.schema_version}`);
    }
    const { vowel, consonant } = payload;
    const capTiers = (rows, label) => {
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error(`${label} must define at least one cap tier`);
        }
        const tiers = rows.map(row => ({
            max_difference: Number(row.max_difference),
            cap: Number(row.cap),
        }));
        const thresholds = tiers.map(tier => tier.max_difference);
        const sorted = [...thresholds].sort((left, right) => left - right);
        if (thresholds.join(',') !== sorted.join(',')) {
            throw new Error(`${label} cap tiers must be sorted by max_difference`);
        }
        return tiers;
    };
    return {
        config_version: String(payload.config_version),
        vowel: {
            height: Number(vowel.feature_weights.height),
            backness: Number(vowel.feature_weights.backness),
            rounding: Number(vowel.feature_weights.rounding),
            strict_blend: Number(vowel.blend.strict),
            feature_blend: Number(vowel.blend.features),
        },
        consonant: {
            place: Number(consonant.feature_weights.place),
            manner: Number(consonant.feature_weights.manner),
            strength: Number(consonant.feature_weights.strength),
            voice: Number(consonant.feature_weights.voice),
            place_caps: capTiers(consonant.place_caps, 'place_caps'),
            place_cap_default: Number(consonant.place_cap_default),
            manner_caps: capTiers(consonant.manner_caps, 'manner_caps'),
            manner_cap_default: Number(consonant.manner_cap_default),
            place_and_manner_cap: Number(consonant.place_and_manner_cap),
        },
    };
}

function renderModule(config) {
    return `'use strict';

// GENERATED FILE - DO NOT EDIT.
// Source: configs/phoneme_similarity_v0.json
// Regenerate: npm run build:similarity-config
//
// Used by public/js/phonetics.js (get_score_1d), which the V2 engines and the
// lexicon build share.

(function (root) {
    const CONFIG = ${JSON.stringify(config, null, 4).split('\n').join('\n    ')};

    function clamp01(value) {
        return Math.max(0, Math.min(1, value));
    }

    function tieredCap(difference, tiers, fallback) {
        for (const tier of tiers) {
            if (difference <= tier.max_difference) return tier.cap;
        }
        return fallback;
    }

    // Vowel branch. Inputs are already clamped per-feature similarities.
    function vowelSimilarity(height, backness, rounding) {
        const strict = height * backness * rounding;
        const features = height * CONFIG.vowel.height
            + backness * CONFIG.vowel.backness
            + rounding * CONFIG.vowel.rounding;
        return clamp01(strict * CONFIG.vowel.strict_blend + features * CONFIG.vowel.feature_blend);
    }

    // Consonant branch. Inputs are absolute feature differences.
    function consonantSimilarity(placeDifference, mannerDifference, strengthDifference, voiceDifference) {
        const place = clamp01(1 - placeDifference);
        const manner = clamp01(1 - mannerDifference);
        const strength = clamp01(1 - strengthDifference);
        const voice = clamp01(1 - voiceDifference);
        const score = place * CONFIG.consonant.place
            + manner * CONFIG.consonant.manner
            + strength * CONFIG.consonant.strength
            + voice * CONFIG.consonant.voice;
        let cap = 1;
        if (placeDifference > 0) {
            cap = Math.min(cap, tieredCap(placeDifference, CONFIG.consonant.place_caps, CONFIG.consonant.place_cap_default));
        }
        if (mannerDifference > 0) {
            cap = Math.min(cap, tieredCap(mannerDifference, CONFIG.consonant.manner_caps, CONFIG.consonant.manner_cap_default));
        }
        if (placeDifference > 0 && mannerDifference > 0) {
            cap = Math.min(cap, CONFIG.consonant.place_and_manner_cap);
        }
        return clamp01(Math.min(score, cap));
    }

    const api = { CONFIG, vowelSimilarity, consonantSimilarity };
    root.PHONEME_SIMILARITY = api;
    if (typeof module === 'object' && module !== null && module.exports) {
        module.exports = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this));
`;
}

function generate(sourcePath = SOURCE_PATH) {
    return renderModule(readSourceConfig(sourcePath));
}

// Raw formula inputs, chosen to cover both branches and every cap tier boundary.
// Keyed by formula arguments rather than phoneme labels so every runtime can be
// driven directly, without needing the IPA feature tables.
const GOLDEN_VOWEL_INPUTS = [
    [1, 1, 1], [0, 0, 0], [1, 0, 0], [0.5, 0.5, 0.5],
    [0.9, 0.1, 1], [0.3, 0.8, 0.55], [1, 1, 0], [0.75, 0.25, 0.5],
];
const GOLDEN_CONSONANT_INPUTS = [
    [0, 0, 0, 0], [0.25, 0, 0, 0], [0.26, 0, 0, 0], [0.5, 0, 0, 0], [0.51, 0, 0, 0],
    [1, 0, 0, 0], [0, 0.25, 0, 0], [0, 0.26, 0, 0], [0, 0.5, 0, 0], [0, 0.51, 0, 0],
    [0, 1, 0, 0], [0.25, 0.25, 0, 0], [0.5, 0.5, 0.5, 0.5], [1, 1, 1, 1],
    [0.1, 0.9, 0.3, 0.7], [0.75, 0.2, 1, 0],
];

function buildGolden(sourcePath = SOURCE_PATH) {
    // Evaluate the rendered module so the golden values come from the exact code
    // shipped to the browser, not from a parallel reference implementation.
    const rendered = generate(sourcePath);
    const sandbox = { module: { exports: {} } };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(rendered, sandbox, { filename: 'phoneme-similarity-config.js' });
    const api = sandbox.PHONEME_SIMILARITY;
    return {
        schema_version: 1,
        config_version: api.CONFIG.config_version,
        note: 'GENERATED FILE - DO NOT EDIT. Regenerate: npm run build:similarity-config',
        vowel_cases: GOLDEN_VOWEL_INPUTS.map(inputs => ({
            inputs,
            expected: api.vowelSimilarity(...inputs),
        })),
        consonant_cases: GOLDEN_CONSONANT_INPUTS.map(inputs => ({
            inputs,
            expected: api.consonantSimilarity(...inputs),
        })),
    };
}

function renderGolden(sourcePath = SOURCE_PATH) {
    return `${JSON.stringify(buildGolden(sourcePath), null, 2)}\n`;
}

if (require.main === module) {
    try {
        const contents = generate();
        fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
        fs.writeFileSync(OUTPUT_PATH, contents, 'utf8');
        console.log(`Generated ${path.relative(ROOT_DIR, OUTPUT_PATH)}`);
        const golden = renderGolden();
        fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
        fs.writeFileSync(GOLDEN_PATH, golden, 'utf8');
        console.log(`Generated ${path.relative(ROOT_DIR, GOLDEN_PATH)}`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = {
    generate,
    renderGolden,
    readSourceConfig,
    OUTPUT_PATH,
    GOLDEN_PATH,
    SOURCE_PATH,
};
