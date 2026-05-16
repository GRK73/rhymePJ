const axios = require('axios');
const fs = require('fs');
const path = require('path');

const apiKey = '0A311A879A22F337AC8873A3D165FAFD';
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'nikl_words.json');
const PROGRESS_FILE = path.join(__dirname, 'scrape_progress.json');

// To avoid parsing XML if API errors, we force JSON
const getUrl = (q, start) => `https://stdict.korean.go.kr/api/search.do?key=${apiKey}&q=${encodeURIComponent(q)}&req_type=json&num=100&start=${start}&advanced=y&method=start`;

async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { timeout: 10000 });
            return res.data;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1))); // exponential backoff
        }
    }
}

// Simple Promise Queue
async function runWithLimit(tasks, limit) {
    const results = [];
    const executing = [];
    for (const task of tasks) {
        const p = Promise.resolve().then(() => task());
        results.push(p);
        if (limit <= tasks.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= limit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

async function scrape() {
    console.log("Starting NIKL Dictionary Scraper...");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let progress = 0;
    let allWords = new Set();
    
    if (fs.existsSync(PROGRESS_FILE)) {
        const pData = JSON.parse(fs.readFileSync(PROGRESS_FILE));
        progress = pData.progress;
        if (fs.existsSync(OUTPUT_FILE)) {
            const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE));
            existing.forEach(w => allWords.add(w));
        }
        console.log(`Resuming from syllable index ${progress}. Loaded ${allWords.size} words.`);
    }

    const startCode = 0xAC00; // '가'
    const totalSyllables = 11172;
    
    const tasks = [];
    
    for (let i = progress; i < totalSyllables; i++) {
        const char = String.fromCharCode(startCode + i);
        
        tasks.push(async () => {
            try {
                const data = await fetchWithRetry(getUrl(char, 1));
                if (!data || !data.channel || !data.channel.item) return;
                
                const total = data.channel.total;
                if (total > 0) {
                    // process first page
                    data.channel.item.forEach(item => {
                        const w = item.word.replace(/[\-\^]/g, '');
                        allWords.add(w);
                    });
                    
                    // fetch remaining pages
                    const totalPages = Math.ceil(total / 100);
                    for (let page = 2; page <= totalPages; page++) {
                        const pageData = await fetchWithRetry(getUrl(char, page));
                        if (pageData && pageData.channel && pageData.channel.item) {
                            pageData.channel.item.forEach(item => {
                                const w = item.word.replace(/[\-\^]/g, '');
                                allWords.add(w);
                            });
                        }
                    }
                }
            } catch (err) {
                console.error(`Error fetching syllable ${char}:`, err.message);
            }
            
            // Log progress occasionally
            if (i % 100 === 0) {
                console.log(`Progress: ${i}/${totalSyllables} syllables checked. Unique words so far: ${allWords.size}`);
                fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ progress: i }));
                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(Array.from(allWords)));
            }
        });
    }

    await runWithLimit(tasks, 50);
    
    console.log(`Scraping complete! Total unique NIKL words: ${allWords.size}`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(Array.from(allWords)));
    
    // Clean up progress file
    if (fs.existsSync(PROGRESS_FILE)) {
        fs.unlinkSync(PROGRESS_FILE);
    }
}

scrape().catch(console.error);
