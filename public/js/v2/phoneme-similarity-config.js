'use strict';

// GENERATED FILE - DO NOT EDIT.
// Source: configs/phoneme_similarity_v0.json
// Regenerate: npm run build:similarity-config
//
// Used by public/js/phonetics.js (get_score_1d), which the V2 engines and the
// lexicon build share.

(function (root) {
    const CONFIG = {
        "config_version": "phoneme-similarity-v0",
        "vowel": {
            "height": 0.42,
            "backness": 0.36,
            "rounding": 0.22,
            "strict_blend": 0.55,
            "feature_blend": 0.45
        },
        "consonant": {
            "place": 0.4,
            "manner": 0.34,
            "strength": 0.16,
            "voice": 0.1,
            "place_caps": [
                {
                    "max_difference": 0.25,
                    "cap": 0.72
                },
                {
                    "max_difference": 0.5,
                    "cap": 0.58
                }
            ],
            "place_cap_default": 0.42,
            "manner_caps": [
                {
                    "max_difference": 0.25,
                    "cap": 0.68
                },
                {
                    "max_difference": 0.5,
                    "cap": 0.52
                }
            ],
            "manner_cap_default": 0.35,
            "place_and_manner_cap": 0.46
        }
    };

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
