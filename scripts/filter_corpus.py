import json
import os
import sys
import re
from wordfreq import word_frequency

try:
    from Korpora import Korpora
except ImportError:
    print("Korpora library not found. Please install it using 'pip install Korpora'")
    sys.exit(1)

# Path setup
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(SCRIPT_DIR, '..', 'public')
INPUT_FILE = os.path.join(PUBLIC_DIR, 'rhyme_dict.json')
OUTPUT_FILE = os.path.join(PUBLIC_DIR, 'rhyme_dict_practical.json')

def load_dict():
    if not os.path.exists(INPUT_FILE):
        print(f"Error: Could not find {INPUT_FILE}")
        sys.exit(1)
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def build_korean_vocab():
    print("Building Korean vocabulary set from corpus...")
    korean_vocab = set()
    
    # Korpora downloads to ~/Korpora/kowikitext/kowikitext_20200920.train
    home_dir = os.path.expanduser('~')
    corpus_file = os.path.join(home_dir, 'Korpora', 'kowikitext', 'kowikitext_20200920.train')
    
    if not os.path.exists(corpus_file):
        print(f"Error: Corpus file not found at {corpus_file}")
        sys.exit(1)
        
    korean_pattern = re.compile(r'[가-힣]+')
    
    # Read line by line to avoid massive memory usage and Korpora prompts
    with open(corpus_file, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f):
            if i % 500000 == 0 and i > 0:
                print(f"Processed {i:,} lines of corpus...")
            words = korean_pattern.findall(line)
            for w in words:
                korean_vocab.add(w)
            
    print(f"Korean vocabulary built: {len(korean_vocab):,} unique Korean words found in corpus.")
    return korean_vocab

def main():
    print("--- Rhyme Dictionary Practical Filter ---")
    data = load_dict()
    print(f"Total words before filtering: {len(data):,}")
    
    korean_vocab = build_korean_vocab()
    
    practical_data = []
    
    print("Filtering words based on practical usage...")
    for idx, item in enumerate(data):
        if idx % 50000 == 0 and idx > 0:
            print(f"Processed {idx:,}/{len(data):,} words...")
            
        word = item['word']
        lang = item['lang']
        
        if lang == 'en':
            # wordfreq combines Google Books Ngrams, Wikipedia, Twitter, etc.
            # freq > 0.0 means it exists in the massive corpora
            freq = word_frequency(word, 'en')
            if freq > 0.0:
                practical_data.append(item)
        elif lang == 'ko':
            # Check if the exact korean word exists anywhere in the Wikipedia corpus
            if word in korean_vocab:
                practical_data.append(item)
    
    print(f"\nTotal words after filtering: {len(practical_data):,}")
    print(f"Removed {len(data) - len(practical_data):,} impractical words (slang, typos, ancient words).")
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(practical_data, f, ensure_ascii=False)
    
    print(f"Saved highly practical dictionary to: {OUTPUT_FILE}")
    print("Done!")

if __name__ == "__main__":
    main()
