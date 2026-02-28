/* ═══════════════════════════════════════════════════
   CS 0478 FlashCards — Application Logic
   Terms loaded from IGCSE_terms_definitions.txt
   Leitner box progress saved to localStorage
   Session data reported to Google Sheets
   ═══════════════════════════════════════════════════ */

// ─────────────── CONFIGURATION ───────────────
// Paste your Google Apps Script Web App URL here:
const GOOGLE_SCRIPT_URL = '';
// Example: 'https://script.google.com/macros/s/AKfycbx.../exec'

// Course identifier — change this when reusing for other courses
const COURSE_NAME = 'CS 0478';

// ─────────────── STORAGE KEYS ───────────────
const STORAGE_KEY = 'cs0478-leitner-boxes';
const STUDENT_KEY = 'cs0478-student';

// ─────────────── STATE ───────────────
let TERM_DATA = {};
let savedBoxes = {};
let selectedSubtopics = new Set();
let deck = [];
let currentIndex = 0;
let isFlipped = false;

let boxes = { 1: [], 2: [], 3: [] };
let sessionResults = { no: 0, maybe: 0, yes: 0 };
let sessionCardRatings = [];   // detailed per-card ratings for reporting
let sessionStartTime = null;   // track session duration

// Student info
let studentEmail = '';

// ─────────────── ELEMENTS ───────────────
const $ = (s) => document.querySelector(s);
const topicListEl      = $('#topic-list');
const btnStart         = $('#btn-start');
const welcomeState     = $('#welcome-state');
const cardView         = $('#card-view');
const completeState    = $('#complete-state');
const flashcard        = $('#flashcard');
const frontText        = $('#card-front-text');
const backText         = $('#card-back-text');
const progressFill     = $('#progress-fill');
const progressText     = $('#progress-text');
const box1Count        = $('#box1-count');
const box2Count        = $('#box2-count');
const box3Count        = $('#box3-count');
const sidebar          = $('#sidebar');

// ─────────────────────────────────────────────────
// STUDENT IDENTIFICATION
// ─────────────────────────────────────────────────
// On first visit, the student enters their school email.
// This is saved to localStorage so they only need to do it once.

function loadStudentInfo() {
    try {
        const raw = localStorage.getItem(STUDENT_KEY);
        if (raw) {
            const info = JSON.parse(raw);
            studentEmail = info.email || '';
        }
    } catch (e) {
        studentEmail = '';
    }
}

function saveStudentInfo() {
    try {
        localStorage.setItem(STUDENT_KEY, JSON.stringify({
            email: studentEmail
        }));
    } catch (e) { /* ignore */ }
}

function promptStudentInfo() {
    // Only prompt if we don't have email yet
    if (studentEmail) return;

    const overlay = document.createElement('div');
    overlay.className = 'student-modal-overlay';
    overlay.innerHTML = `
        <div class="student-modal">
            <h2>👋 Welcome!</h2>
            <p>Please enter your school email so your teacher can track your progress.</p>
            <div class="student-field">
                <label for="input-email">School Email</label>
                <input type="email" id="input-email" placeholder="e.g. jsmith@school.edu" autocomplete="email">
            </div>
            <button class="btn-primary" id="btn-save-student">Start Learning</button>
            <p class="student-note">This is saved on your device — you won't need to enter it again.</p>
        </div>
    `;
    document.body.appendChild(overlay);

    setTimeout(() => {
        const emailInput = $('#input-email');
        if (emailInput) emailInput.focus();
    }, 100);

    $('#btn-save-student').addEventListener('click', () => {
        const email = $('#input-email').value.trim();

        if (!email || !email.includes('@')) {
            $('#input-email').style.borderColor = 'var(--conf-no-border)';
            $('#input-email').focus();
            return;
        }

        studentEmail = email;
        saveStudentInfo();
        overlay.remove();
    });

    // Allow Enter key to submit
    overlay.querySelector('input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#btn-save-student').click();
    });
}

// ─────────────────────────────────────────────────
// PERSISTENT LEITNER STORAGE
// ─────────────────────────────────────────────────

function cardKey(unit, sub, term) {
    return `${unit}|||${sub}|||${term}`;
}

function loadSavedBoxes() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) savedBoxes = JSON.parse(raw);
    } catch (e) {
        savedBoxes = {};
    }
}

function saveLeitnerData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBoxes));
    } catch (e) { /* ignore */ }
}

function getCardBox(unit, sub, term) {
    return savedBoxes[cardKey(unit, sub, term)] || 0;
}

function setCardBox(unit, sub, term, box) {
    savedBoxes[cardKey(unit, sub, term)] = box;
    saveLeitnerData();
}

// ─────────────────────────────────────────────────
// SPACED REPETITION DECK ORDERING
// ─────────────────────────────────────────────────

function buildWeightedDeck(cards) {
    const weighted = [];
    for (const card of cards) {
        const box = getCardBox(card.unit, card.sub, card.term);
        let copies = 1;
        if (box === 0 || box === 1) copies = 4;
        else if (box === 2) copies = 2;
        for (let i = 0; i < copies; i++) {
            weighted.push({ ...card });
        }
    }
    return shuffle(weighted);
}

function buildPriorityDeck(cards) {
    const grouped = { 0: [], 1: [], 2: [], 3: [] };
    for (const card of cards) {
        const box = getCardBox(card.unit, card.sub, card.term);
        grouped[box].push(card);
    }
    return [
        ...shuffle(grouped[0]),
        ...shuffle(grouped[1]),
        ...shuffle(grouped[2]),
        ...shuffle(grouped[3]),
    ];
}

// ─────────────────────────────────────────────────
// GOOGLE SHEETS REPORTING
// ─────────────────────────────────────────────────
// Sends data to your Google Sheet via Apps Script.
// If the URL isn't configured, reporting is silently skipped.

async function reportSession() {
    if (!GOOGLE_SCRIPT_URL) return;

    const durationSeconds = sessionStartTime
        ? Math.round((Date.now() - sessionStartTime) / 1000)
        : 0;

    // Get list of topics studied
    const topicNames = [...selectedSubtopics].map(key => {
        const [unit, sub] = key.split('|||');
        return `${sub}`;
    }).join(', ');

    // 1. Send session summary
    try {
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'session',
                studentEmail: studentEmail,
                topics: topicNames,
                totalCards: sessionResults.no + sessionResults.maybe + sessionResults.yes,
                dontKnow: sessionResults.no,
                somewhat: sessionResults.maybe,
                knowWell: sessionResults.yes,
                durationSeconds: durationSeconds,
                course: COURSE_NAME
            })
        });
    } catch (e) {
        console.warn('Could not send session summary:', e);
    }

    // 2. Send card-level detail
    if (sessionCardRatings.length > 0) {
        try {
            await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'cardDetail',
                    studentEmail: studentEmail,
                    course: COURSE_NAME,
                    cards: sessionCardRatings
                })
            });
        } catch (e) {
            console.warn('Could not send card details:', e);
        }
    }
}

// ─────────────────────────────────────────────────
// LOAD & PARSE TERMS FROM EXTERNAL TEXT FILE
// ─────────────────────────────────────────────────

async function loadTermData() {
    try {
        const response = await fetch('IGCSE_terms_definitions.txt');
        if (!response.ok) throw new Error('Failed to load terms file (' + response.status + ')');
        const text = await response.text();
        TERM_DATA = parseTermFile(text);

        const totalCards = Object.values(TERM_DATA)
            .flatMap(unit => Object.values(unit))
            .reduce((sum, cards) => sum + cards.length, 0);
        console.log(`Loaded ${totalCards} flashcards from IGCSE_terms_definitions.txt`);

    } catch (err) {
        console.error('Error loading terms:', err);
        welcomeState.querySelector('.welcome-inner').innerHTML = `
            <span class="welcome-emoji">⚠️</span>
            <h2>Could not load terms</h2>
            <p>Make sure <strong>IGCSE_terms_definitions.txt</strong> is in the same folder as this page.</p>
            <p style="font-size:.85rem;color:var(--text-tertiary);">${err.message}</p>`;
    }
}

function parseTermFile(text) {
    const data = {};
    let currentUnit = null;
    let currentSub = null;
    const lines = text.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trimEnd();

        if (line.trim() === '') { i++; continue; }

        if (line.startsWith('# ') && !line.startsWith('## ')) {
            currentUnit = line.slice(2).trim();
            if (!data[currentUnit]) data[currentUnit] = {};
            currentSub = null;
            i++;
            continue;
        }

        if (line.startsWith('## ')) {
            currentSub = line.slice(3).trim();
            if (currentUnit && !data[currentUnit][currentSub]) {
                data[currentUnit][currentSub] = [];
            }
            i++;
            continue;
        }

        if (currentUnit && currentSub) {
            const term = line.trim();
            let defIndex = i + 1;
            while (defIndex < lines.length && lines[defIndex].trim() === '') defIndex++;

            if (defIndex < lines.length) {
                const defLine = lines[defIndex].trim();
                if (!defLine.startsWith('# ')) {
                    data[currentUnit][currentSub].push({ term: term, def: defLine });
                    i = defIndex + 1;
                    continue;
                }
            }
        }

        i++;
    }

    return data;
}

// ─────────────── AUDIO: card flip ───────────────
let audioCtx = null;

function playFlipSound() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.06, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            const t = i / data.length;
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 12) * 0.4;
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(900, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.08);

        const source = audioCtx.createBufferSource();
        const snapGain = audioCtx.createGain();
        snapGain.gain.value = 0.5;
        source.buffer = buffer;
        source.connect(snapGain);
        snapGain.connect(audioCtx.destination);
        source.start();
    } catch (e) { /* silently ignore audio errors */ }
}

// ─────────────── BUILD SIDEBAR ───────────────
function buildTopicList() {
    let html = '';

    html += `<div class="select-all-row">
        <div class="subtopic-item">
            <input type="checkbox" id="cb-all">
            <label for="cb-all">Select All Topics</label>
        </div>
    </div>`;

    for (const [unit, subtopics] of Object.entries(TERM_DATA)) {
        const unitId = unit.replace(/\s+/g, '_');
        html += `<div class="topic-unit" id="unit-${unitId}">`;
        html += `<button class="unit-header" data-unit="${unitId}">
            <span>${unit}</span><span class="arrow">▶</span>
        </button>`;
        html += `<div class="subtopic-list">`;

        for (const [sub, cards] of Object.entries(subtopics)) {
            const key = `${unit}|||${sub}`;
            const cbId = `cb-${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const progress = getSubtopicProgress(unit, sub, cards);

            html += `<div class="subtopic-item">
                <input type="checkbox" id="${cbId}" data-key="${key}">
                <label for="${cbId}">${sub} <span style="opacity:.5;font-size:.75rem">(${cards.length})</span></label>
                ${progress}
            </div>`;
        }

        html += `</div></div>`;
    }

    topicListEl.innerHTML = html;

    topicListEl.querySelectorAll('.unit-header').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.topic-unit').classList.toggle('open');
        });
    });

    topicListEl.querySelectorAll('input[type="checkbox"][data-key]').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) selectedSubtopics.add(cb.dataset.key);
            else selectedSubtopics.delete(cb.dataset.key);
            updateCardCount();
            syncSelectAll();
        });
    });

    const cbAll = $('#cb-all');
    cbAll.addEventListener('change', () => {
        const allCbs = topicListEl.querySelectorAll('input[type="checkbox"][data-key]');
        allCbs.forEach(cb => {
            cb.checked = cbAll.checked;
            if (cbAll.checked) selectedSubtopics.add(cb.dataset.key);
            else selectedSubtopics.delete(cb.dataset.key);
        });
        updateCardCount();
    });
}

function getSubtopicProgress(unit, sub, cards) {
    if (cards.length === 0) return '';
    let known = 0, somewhat = 0, unseen = 0;
    for (const card of cards) {
        const box = getCardBox(unit, sub, card.term);
        if (box === 3) known++;
        else if (box === 2) somewhat++;
        else unseen++;
    }
    if (known === 0 && somewhat === 0) return '';

    const pctKnown = (known / cards.length) * 100;
    const pctSomewhat = (somewhat / cards.length) * 100;

    return `<span class="subtopic-progress" title="${known} known, ${somewhat} somewhat, ${unseen} to learn">
        <span class="prog-bar">
            <span class="prog-yes" style="width:${pctKnown}%"></span>
            <span class="prog-maybe" style="width:${pctSomewhat}%"></span>
        </span>
    </span>`;
}

function syncSelectAll() {
    const allCbs = topicListEl.querySelectorAll('input[type="checkbox"][data-key]');
    const total = allCbs.length;
    const checked = [...allCbs].filter(c => c.checked).length;
    const cbAll = $('#cb-all');
    cbAll.checked = checked === total;
    cbAll.indeterminate = checked > 0 && checked < total;
}

function updateCardCount() {
    const count = getSelectedCards().length;
    let countEl = $('.card-count');
    if (!countEl) {
        countEl = document.createElement('span');
        countEl.className = 'card-count';
        $('.sidebar-footer').prepend(countEl);
    }
    countEl.textContent = `${count} card${count !== 1 ? 's' : ''} selected`;
    btnStart.disabled = count === 0;
}

function getSelectedCards() {
    const cards = [];
    for (const key of selectedSubtopics) {
        const [unit, sub] = key.split('|||');
        if (TERM_DATA[unit] && TERM_DATA[unit][sub]) {
            TERM_DATA[unit][sub].forEach(card => {
                cards.push({ ...card, unit, sub });
            });
        }
    }
    return cards;
}

// ─────────────── SHUFFLE (Fisher-Yates) ───────────────
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ─────────────── START SESSION ───────────────
function startSession(cards, useWeighting = true) {
    if (useWeighting) {
        deck = buildWeightedDeck(cards);
    } else {
        deck = buildPriorityDeck(cards);
    }

    currentIndex = 0;
    isFlipped = false;
    boxes = { 1: [], 2: [], 3: [] };
    sessionResults = { no: 0, maybe: 0, yes: 0 };
    sessionCardRatings = [];
    sessionStartTime = Date.now();

    welcomeState.classList.add('hidden');
    completeState.classList.add('hidden');
    cardView.classList.remove('hidden');

    showCard();
    updateBoxCounts();
    closeSidebar();
}

// ─────────────── SHOW CARD ───────────────
function showCard() {
    if (currentIndex >= deck.length) {
        finishSession();
        return;
    }
    const card = deck[currentIndex];
    frontText.textContent = card.term;
    backText.textContent = card.def;

    flashcard.classList.remove('flipped');
    isFlipped = false;

    const pct = ((currentIndex) / deck.length) * 100;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${currentIndex + 1} / ${deck.length}`;

    flashcard.style.animation = 'none';
    flashcard.offsetHeight;
    flashcard.style.animation = '';
}

// ─────────────── FLIP ───────────────
function flipCard() {
    isFlipped = !isFlipped;
    flashcard.classList.toggle('flipped', isFlipped);
    playFlipSound();
}

// ─────────────── CONFIDENCE ───────────────
function rateCard(level) {
    const card = deck[currentIndex];
    let box;
    let ratingLabel;

    if (level === 'no') {
        box = 1;
        ratingLabel = "Don't Know";
        boxes[1].push(card);
        sessionResults.no++;
    } else if (level === 'maybe') {
        box = 2;
        ratingLabel = 'Somewhat';
        boxes[2].push(card);
        sessionResults.maybe++;
    } else {
        box = 3;
        ratingLabel = 'Know Well';
        boxes[3].push(card);
        sessionResults.yes++;
    }

    // Save to persistent local storage
    setCardBox(card.unit, card.sub, card.term, box);

    // Track for reporting
    sessionCardRatings.push({
        unit: card.unit,
        sub: card.sub,
        term: card.term,
        rating: ratingLabel,
        box: box
    });

    updateBoxCounts();
    currentIndex++;
    showCard();
}

function updateBoxCounts() {
    box1Count.textContent = boxes[1].length;
    box2Count.textContent = boxes[2].length;
    box3Count.textContent = boxes[3].length;
}

// ─────────────── FINISH ───────────────
function finishSession() {
    cardView.classList.add('hidden');
    completeState.classList.remove('hidden');

    progressFill.style.width = '100%';

    const grid = $('#results-grid');
    grid.innerHTML = `
        <div class="result-item result-no">
            <span class="result-num">${sessionResults.no}</span>
            <span class="result-label">Don't Know</span>
        </div>
        <div class="result-item result-maybe">
            <span class="result-num">${sessionResults.maybe}</span>
            <span class="result-label">Somewhat</span>
        </div>
        <div class="result-item result-yes">
            <span class="result-num">${sessionResults.yes}</span>
            <span class="result-label">Know Well</span>
        </div>`;

    const total = sessionResults.no + sessionResults.maybe + sessionResults.yes;
    const pct = total > 0 ? Math.round((sessionResults.yes / total) * 100) : 0;
    const msg = $('#results-message');

    if (pct === 100) msg.textContent = `Perfect! You knew every single card. Amazing work! 🌟`;
    else if (pct >= 75) msg.textContent = `Great job! You confidently knew ${pct}% of the cards.`;
    else if (pct >= 50) msg.textContent = `Good progress — you knew ${pct}% well. Keep reviewing the rest!`;
    else msg.textContent = `You knew ${pct}% well. No worries — review the weak cards and you'll improve!`;

    const btnReview = $('#btn-review');
    const weakCards = [...boxes[1], ...boxes[2]];
    const seen = new Set();
    const uniqueWeak = weakCards.filter(c => {
        const k = cardKey(c.unit, c.sub, c.term);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    btnReview.classList.toggle('hidden', uniqueWeak.length === 0);

    // Report to Google Sheets
    reportSession();

    // Refresh sidebar progress bars
    buildTopicList();
    restoreCheckboxes();
}

function restoreCheckboxes() {
    topicListEl.querySelectorAll('input[type="checkbox"][data-key]').forEach(cb => {
        cb.checked = selectedSubtopics.has(cb.dataset.key);
    });
    syncSelectAll();
}

// ─────────────── SIDEBAR ───────────────
function openSidebar() {
    sidebar.classList.add('open');
    getOrCreateOverlay().classList.add('show');
}
function closeSidebar() {
    sidebar.classList.remove('open');
    const ov = document.querySelector('.sidebar-overlay');
    if (ov) ov.classList.remove('show');
}
function getOrCreateOverlay() {
    let ov = document.querySelector('.sidebar-overlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.className = 'sidebar-overlay';
        document.body.appendChild(ov);
        ov.addEventListener('click', closeSidebar);
    }
    return ov;
}

// ─────────────── THEME / FONT TOGGLES ───────────────
function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('cs0478-theme', isDark ? 'light' : 'dark');
}

function toggleDyslexic() {
    const html = document.documentElement;
    const isActive = html.getAttribute('data-dyslexic') === 'true';
    html.setAttribute('data-dyslexic', isActive ? 'false' : 'true');
    $('#btn-dyslexic').classList.toggle('active', !isActive);
    localStorage.setItem('cs0478-dyslexic', !isActive ? 'true' : 'false');
}

function restorePreferences() {
    const theme = localStorage.getItem('cs0478-theme');
    if (theme) document.documentElement.setAttribute('data-theme', theme);

    const dys = localStorage.getItem('cs0478-dyslexic');
    if (dys === 'true') {
        document.documentElement.setAttribute('data-dyslexic', 'true');
        $('#btn-dyslexic').classList.add('active');
    }
}

// ─────────────── CLEAR PROGRESS ───────────────
function clearProgress() {
    if (confirm('Are you sure you want to reset all your flashcard progress? This cannot be undone.')) {
        savedBoxes = {};
        localStorage.removeItem(STORAGE_KEY);
        buildTopicList();
        restoreCheckboxes();
    }
}

// ─────────────── INIT ───────────────
async function init() {
    restorePreferences();
    loadSavedBoxes();
    loadStudentInfo();

    await loadTermData();
    buildTopicList();
    updateCardCount();

    // Show student info prompt if not yet provided
    promptStudentInfo();

    // Theme & font
    $('#btn-theme').addEventListener('click', toggleTheme);
    $('#btn-dyslexic').addEventListener('click', toggleDyslexic);

    // Reset progress
    const resetBtn = $('#btn-reset-progress');
    if (resetBtn) resetBtn.addEventListener('click', clearProgress);

    // Sidebar
    $('#btn-sidebar-open').addEventListener('click', openSidebar);
    $('#btn-sidebar-close').addEventListener('click', closeSidebar);

    // Start
    btnStart.addEventListener('click', () => {
        const cards = getSelectedCards();
        if (cards.length === 0) return;
        startSession(cards, true);
    });

    // Flip card
    flashcard.addEventListener('click', flipCard);
    flashcard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); }
    });

    // Confidence
    $('#btn-no').addEventListener('click', () => rateCard('no'));
    $('#btn-maybe').addEventListener('click', () => rateCard('maybe'));
    $('#btn-yes').addEventListener('click', () => rateCard('yes'));

    // Restart
    $('#btn-restart').addEventListener('click', () => {
        const cards = getSelectedCards();
        if (cards.length > 0) startSession(cards, true);
        else if (deck.length > 0) startSession(deck, true);
    });

    // Review weak cards
    $('#btn-review').addEventListener('click', () => {
        const weak = [...boxes[1], ...boxes[2]];
        const seen = new Set();
        const uniqueWeak = weak.filter(c => {
            const k = cardKey(c.unit, c.sub, c.term);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        if (uniqueWeak.length > 0) startSession(uniqueWeak, false);
    });

    // New session
    $('#btn-new-session').addEventListener('click', () => {
        cardView.classList.add('hidden');
        completeState.classList.add('hidden');
        welcomeState.classList.remove('hidden');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (cardView.classList.contains('hidden')) return;
        if (e.key === '1') rateCard('no');
        if (e.key === '2') rateCard('maybe');
        if (e.key === '3') rateCard('yes');
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') flipCard();
    });

    const totalSaved = Object.keys(savedBoxes).length;
    if (totalSaved > 0) {
        console.log(`Welcome back! You have progress saved for ${totalSaved} cards.`);
    }
}

document.addEventListener('DOMContentLoaded', init);
