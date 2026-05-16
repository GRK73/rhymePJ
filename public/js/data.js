const OPTIONAL_ASSET_VERSION = '20260516-compound-pronunciation';
const DATA_DIR = 'data/';

function dataPath(filename) {
    return `${DATA_DIR}${filename}`;
}

async function loadOptionalJson(path) {
    try {
        const separator = path.includes('?') ? '&' : '?';
        const response = await fetch(`${path}${separator}v=${OPTIONAL_ASSET_VERSION}`, { cache: 'no-store' });
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn(`${path} is not available:`, error);
        return null;
    }
}

function extractBigramEntries(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) return data.entries;
    return data;
}

function extractSemanticVectorStore(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    if (data.words && typeof data.words === 'object' && !Array.isArray(data.words)) return data.words;
    if (data.vectors && typeof data.vectors === 'object' && !Array.isArray(data.vectors)) return data.vectors;
    return data;
}
