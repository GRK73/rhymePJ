// TTS Function
// Load voices in advance
let synthVoices = [];
if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
        synthVoices = window.speechSynthesis.getVoices();
    };
}

window.playTTS = function(word, lang) {
    if (!window.speechSynthesis) {
        alert("이 브라우저는 TTS(음성 합성)를 지원하지 않습니다.");
        return;
    }

    // Ensure voices are loaded
    if (synthVoices.length === 0) {
        synthVoices = window.speechSynthesis.getVoices();
    }

    const utterance = new SpeechSynthesisUtterance(word);
    
    if (lang === 'ko') {
        utterance.lang = 'ko-KR';
        const koVoices = synthVoices.filter(v => v.lang.startsWith('ko'));
        // Prefer Google's high quality network voices if available
        const bestVoice = koVoices.find(v => v.name.includes('Google') || v.name.includes('Premium')) || koVoices[0];
        if (bestVoice) {
            utterance.voice = bestVoice;
        }
        // Adjust rate and pitch to make default Windows/Mac voices sound more natural
        utterance.rate = 0.85; 
        utterance.pitch = 1.0;
    } else {
        utterance.lang = 'en-US';
        const enVoices = synthVoices.filter(v => v.lang.startsWith('en'));
        const bestVoice = enVoices.find(v => v.name.includes('Google') || v.name.includes('Premium')) || enVoices[0];
        if (bestVoice) {
            utterance.voice = bestVoice;
        }
    }

    window.speechSynthesis.cancel(); // Stop any currently playing TTS
    window.speechSynthesis.speak(utterance);
}
