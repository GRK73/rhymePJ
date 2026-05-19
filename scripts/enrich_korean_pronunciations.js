const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_FILES = [
    path.join(ROOT_DIR, 'public', 'data', 'model', 'rhyme_dict.json'),
    path.join(ROOT_DIR, 'public', 'data', 'model', 'rhyme_dict_practical.json'),
];

function loadPronunciationRuntime() {
    const context = { console, dictionary: [] };
    context.window = context;
    vm.createContext(context);

    ['public/js/phonetics.js', 'public/js/koreanPronunciation.js'].forEach(relativePath => {
        const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
        vm.runInContext(source, context, { filename: relativePath });
    });

    return context;
}

function compactCandidate(candidate) {
    return [
        candidate.label || '표준발음',
        candidate.reading || '',
        candidate.phonemes || [],
    ];
}

function enrichFile(filePath, runtime) {
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping missing dictionary: ${filePath}`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let koreanCount = 0;
    let changedCount = 0;
    let alternateCount = 0;

    data.forEach(item => {
        if (!item || item.lang !== 'ko' || !item.word) return;
        koreanCount++;

        const candidates = runtime.getKoreanStandardPronunciationCandidates(item.word);
        if (!candidates || candidates.length === 0) return;

        const primary = candidates[0];
        const nextPhonemes = primary.phonemes || [];
        const previousPhonemes = Array.isArray(item.phonemes) ? item.phonemes : [];
        const previousKey = previousPhonemes.join('|');
        const nextKey = nextPhonemes.join('|');

        item.phonemes = nextPhonemes;
        if (primary.reading && primary.reading !== item.word) {
            item.reading = primary.reading;
        } else {
            delete item.reading;
        }

        if (candidates.length > 1) {
            item.pronunciations = candidates.map(compactCandidate);
            alternateCount++;
        } else {
            delete item.pronunciations;
        }

        if (previousKey !== nextKey || item.reading || item.pronunciations) {
            changedCount++;
        }
    });

    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
    console.log(`Enriched ${path.relative(ROOT_DIR, filePath)}: ${koreanCount.toLocaleString()} Korean entries, ${changedCount.toLocaleString()} updated, ${alternateCount.toLocaleString()} with alternates.`);
}

function main() {
    const args = process.argv.slice(2);
    const files = args.length > 0
        ? args.map(file => path.resolve(process.cwd(), file))
        : DEFAULT_FILES;
    const runtime = loadPronunciationRuntime();
    files.forEach(file => enrichFile(file, runtime));
}

main();
