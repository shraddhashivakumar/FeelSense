let lastPredictedMood = null;
let lastUserMessage = null;
let currentMode = 'Therapy'; // Initialize with a default mode

// --- Utility Functions ---

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeEmojis(text) {
    const replacements = {
        ':\\(-?': ' sad ',
        ':\\[-?': ' sad ',
        ';\\(-?': ' sad ',
        ':\\)-?': ' happy ',
        ':\\]-?': ' happy ',
        ';\\)-?': ' happy ',
        ':\\*': ' love ',
        '-_-': ' neutral ',
        '([\u263a\ud83d\ude00-\ud83d\ude0f\ud83d\ude1c\ud83d\ude1d\ud83d\ude38-\ud83d\ude3f\ud83e\udd17\ud83e\udd23\ud83e\udd29\ud83e\udd73\ud83e\udd76\ud83d\udc4f])': ' happy ',
        '([\u2764\u2763\ud83d\udc93-\ud83d\udc9e\ud83d\udc8b\ud83e\udd70])': ' love ',
        '([\ud83d\ude20-\ud83d\ude24\ud83d\ude21\ud83e\udd2c\ud83d\ude44])': ' anger ',
        '([\u2639\ud83d\ude13-\ud83d\ude1a\ud83d\ude25-\ud83d\ude2d\ud83d\ude31\ud83d\ude33\ud83d\ude40\ud83e\udd7a])': ' sad ',
        '([\ud83d\ude10\ud83d\ude11\ud83d\ude2f\ud83e\udd14\ud83e\udd28\ud83d\ude34])': ' neutral ',
        '([\u2000-\u27bf\u2800-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])': ' '
    };

    let result = text;
    for (const [pattern, replacement] of Object.entries(replacements)) {
        const regex = new RegExp(pattern, 'gu');
        result = result.replace(regex, replacement);
    }
    return result.replace(/\s+/g, ' ').trim();
}

function appendMessage(text, who = 'bot', extraHTML = '') {
    const messagesContainer = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.className = `message ${who}`;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = `<div class="text">${escapeHtml(text)}</div>${extraHTML}`;
    messageElement.appendChild(bubble);
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return messageElement;
}

function showTyping() {
    const messagesContainer = document.getElementById('messages');
    const typing = document.createElement('div');
    typing.className = 'message bot typing';
    typing.innerHTML = '<div class="message-bubble typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return typing;
}

// --- Feedback UI ---

function showFeedbackUI(predictedMood, confidence) {
    const composer = document.querySelector('.composer'); 
    const existingFeedback = document.getElementById('feedback-prompt');
    if (existingFeedback) existingFeedback.remove();
    
    const confidenceText = confidence !== null ? 
        ` (${Math.round(confidence * 100)}% Conf)` : '';

    const feedbackPrompt = document.createElement('div');
    feedbackPrompt.id = 'feedback-prompt';
    feedbackPrompt.className = 'feedback-prompt';
    feedbackPrompt.innerHTML = `
        <p class="feedback-text">
            🤖 I predicted: <strong id="predicted-mood-span">${predictedMood}</strong>${confidenceText}. Was this correct?
        </p>
        <div class="feedback-actions">
            <button class="feedback-btn correct" onclick="window.handleFeedback(true)">Yes, Correct</button>
            <button class="feedback-btn incorrect" onclick="window.handleFeedback(false)">No, Wrong Mood</button>
        </div>
    `;
    composer.parentElement.insertBefore(feedbackPrompt, composer);
}

async function handleFeedback(isCorrect) {
    if (!lastUserMessage) return;
    const feedbackPrompt = document.getElementById('feedback-prompt');

    if (isCorrect) {
        const payload = {
            text: lastUserMessage,
            predicted: lastPredictedMood,
            actual: lastPredictedMood
        };
        feedbackPrompt.innerHTML = '<p class="feedback-success">✅ Thank you for confirming! Logged.</p>';
        try {
            await fetch('feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('Feedback API Error:', error);
            feedbackPrompt.innerHTML += '<p class="feedback-error-small">(Server error logging feedback)</p>';
        }
        lastPredictedMood = null;
        lastUserMessage = null;
        return;
    }

    // --- If prediction is wrong ---
    const emotionOptions = ["happy", "sad", "angry", "neutral", "fear", "surprise"];
    feedbackPrompt.innerHTML = `
        <p class="feedback-error">😕 Sorry about that! Please choose the correct emotion:</p>
        <select id="correctEmotion" class="border border-gray-400 rounded-md p-1 mt-2">
            <option value="">-- Select Emotion --</option>
            ${emotionOptions.map(e => `<option value="${e}">${e}</option>`).join('')}
        </select>
        <button class="feedback-btn correct mt-2" id="submitCorrectionBtn">Submit</button>
    `;

    document.getElementById('submitCorrectionBtn').addEventListener('click', async () => {
        const correctEmotion = document.getElementById('correctEmotion').value;
        if (!correctEmotion) {
            alert("Please select an emotion first.");
            return;
        }

        const payload = {
            text: lastUserMessage,
            predicted: lastPredictedMood,
            actual: correctEmotion
        };

        try {
            await fetch('feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            feedbackPrompt.innerHTML = '<p class="feedback-success">✅ Thank you! Your correction has been saved.</p>';
        } catch (error) {
            console.error('Correction API Error:', error);
            feedbackPrompt.innerHTML = '<p class="feedback-error-small">❌ Error saving correction.</p>';
        }

        lastPredictedMood = null;
        lastUserMessage = null;
    });
}
window.handleFeedback = handleFeedback;

// --- Mode Management ---

function updateMode(newMode) {
    if (currentMode !== newMode) {
        currentMode = newMode;
        console.log(`Mode switched to: ${currentMode}`);
        appendMessage(`Mode switched to ${currentMode}. I will now tailor my responses to this context.`, 'bot');
    }
}
window.updateMode = updateMode;

// --- Main Chat Logic ---

async function sendMessage() {
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');

    let originalText = input.value.trim();
    if (!originalText) return;

    let sanitizedText = normalizeEmojis(originalText);
    if (!sanitizedText) {
        appendMessage(originalText, 'user');
        appendMessage("I need some words, not just emojis, to detect your mood!", 'bot');
        input.value = '';
        input.focus();
        return; 
    }

    const existingFeedback = document.getElementById('feedback-prompt');
    if (existingFeedback) existingFeedback.remove();

    appendMessage(originalText, 'user'); 
    input.value = '';
    input.focus();
    sendBtn.disabled = true;

    lastUserMessage = originalText; 
    const typingEl = showTyping();

    try {
        const res = await fetch('chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: sanitizedText, mode: currentMode })
        });

        const data = await res.json();
        typingEl.remove();

        if (res.ok) {
            lastPredictedMood = data.mood;
            const confidenceText = data.confidence ? ` (${Math.round(data.confidence * 100)}% Conf)` : '';
            const moodBadge = `<div class="mood-tag">Mood: ${escapeHtml(data.mood)} (${escapeHtml(data.broad_mood)})${confidenceText}</div>`;
            appendMessage(data.reply, 'bot', moodBadge);
            showFeedbackUI(data.mood, data.confidence);
        } else {
            appendMessage("Sorry — couldn't process that. Try again.", 'bot');
        }
    } catch (err) {
        typingEl.remove();
        appendMessage("Network error — is the server running?", 'bot');
        console.error("Network error:", err);
    } finally {
        sendBtn.disabled = false;
    }
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    const micAnim = document.getElementById('mic-anim');
    const modeSelect = document.getElementById('modeSelect');

    if (modeSelect) {
        modeSelect.addEventListener('change', (e) => updateMode(e.target.value));
        currentMode = modeSelect.value || currentMode;
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    voiceBtn.addEventListener('click', () => {
        if (!('webkitSpeechRecognition' in window)) {
            appendMessage("Your browser doesn't support speech recognition.", 'bot');
            return;
        }

        const recognition = new webkitSpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        if (micAnim) micAnim.style.display = 'inline';
        voiceBtn.disabled = true;

        recognition.start();

        recognition.onresult = (event) => {
            const speechResult = event.results[0][0].transcript;
            input.value = speechResult;
            sendMessage();
        };

        recognition.onend = () => {
            if (micAnim) micAnim.style.display = 'none';
            voiceBtn.disabled = false;
        };

        recognition.onerror = (event) => {
            if (micAnim) micAnim.style.display = 'none';
            voiceBtn.disabled = false;
            appendMessage("Speech recognition failed. Please try typing instead.", 'bot');
            console.error("Speech recognition error", event.error);
        };
    });

    appendMessage(`Welcome! You are in ${currentMode} mode. Tell me how you're feeling.`, 'bot');
});
