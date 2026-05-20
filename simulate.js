const fs = require('fs');
const path = require('path');

try {
    global.Hangul = require('hangul-js');
} catch(e) {}
try {
    global.rhymez = require('rhymez');
} catch(e) {}

global.document = {
    getElementById: () => ({ hidden: false, style: {}, textContent: '' }),
    querySelectorAll: () => [],
    createElement: () => ({}),
    addEventListener: () => {}
};
global.window = {};
global.fetch = async (url) => {
    try {
        const cleanUrl = url.split('?')[0]; 
        const filePath = path.join(__dirname, 'public', cleanUrl);
        const data = fs.readFileSync(filePath, 'utf8');
        return { ok: true, json: async () => JSON.parse(data) };
    } catch(e) {
        return { ok: false };
    }
};
global.requestAnimationFrame = (cb) => setImmediate(cb);

global.dictionary = [];
global.loanwordOverrides = {};
global.compoundPronunciationsKo = {};

const files = [
    'public/js/data.js',
    'public/js/phonetics.js',
    'public/js/koreanPronunciation.js',
    'public/js/lyricsAnalysisMetrics.js',
    'public/js/lyricsAnalysis.js'
];

let scriptContent = files.map(f => fs.readFileSync(f, 'utf8')).join('\n;\n');

const runScript = new Function(`
    ${scriptContent};
    
    return async function runSimulation(samples) {
        const results = [];
        for (let i = 0; i < samples.length; i++) {
            const song = samples[i];
            console.log("Analyzing sample " + (i+1) + " / " + samples.length + ": " + song.title);
            const sections = [{
                id: '1', type: 'Verse', text: song.lyrics, lines: splitLyricsLines(song.lyrics)
            }];
            try {
                const report = await analyzeLyricsSections(sections, (progress, msg) => { });
                results.push({
                    title: song.title,
                    lineCount: report.overview.lineCount,
                    rhymeDensity: report.overview.rhymeDensity,
                    internalDensity: report.overview.internalDensity,
                    phonemeFlow: report.overview.phonemeFlow,
                    naturalness: report.overview.naturalness,
                    hiphopAffinity: report.overview.hiphopAffinity,
                    rhymeGroupCount: report.rhymeGroups.length,
                    structuralRhymeCount: report.structuralRhymeGroups.length,
                    notes: report.notes || [],
                    report: report
                });
            } catch(e) {
                console.error("Error analyzing " + song.title, e);
                results.push({ title: song.title, error: e.message, stack: e.stack });
            }
        }
        return results;
    };
`);

async function main() {
    console.log("Loading corpus...");
    const corpusPath = path.join(__dirname, 'public/data/corpus/hiphop_corpus.jsonl');
    const lines = fs.readFileSync(corpusPath, 'utf8').trim().split('\n');
    
    const samples = [];
    for(let i=0; i<20; i++) {
        const r = Math.floor(Math.random() * lines.length);
        samples.push(JSON.parse(lines[r]));
    }
    
    console.log("Running simulation...");
    const runner = runScript();
    const results = await runner(samples);
    
    let errors = 0;
    let anomalies = 0;
    
    results.forEach(r => {
        console.log("\\n[" + r.title + "]");
        if (r.error) {
            console.log("  ERROR: " + r.error);
            errors++;
        } else {
            console.log("  Lines: " + r.lineCount + ", Density: " + (r.rhymeDensity ? r.rhymeDensity.toFixed(3) : 0) + ", Flow: " + (r.phonemeFlow ? r.phonemeFlow.toFixed(3) : 0) + ", Affinity: " + (r.hiphopAffinity ? r.hiphopAffinity.toFixed(3) : 0));
            console.log("  Rhyme Groups: " + r.rhymeGroupCount + ", Structural: " + r.structuralRhymeCount);
            if (r.notes.length) {
                r.notes.forEach(n => console.log("    - " + n));
            }
            if (isNaN(r.rhymeDensity)) anomalies++;
            if (r.hiphopAffinity > 1.0) {
                console.log("  -> ANOMALY: Affinity > 1.0");
                anomalies++;
            }
        }
    });
    console.log("\\nComplete. Errors: " + errors + ", Anomalies: " + anomalies);
}

main().catch(console.error);
