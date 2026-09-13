import { db, ref, set, update, onValue, push, remove } from "./firebase.js?v=3.2";

//#region 1. CONFIGURATION & GLOBAL STATE
const SESSION_KEY = "quizalia_session";
let lobbyCode = null;
let playerName = null;
let playerKey = null; // Firebase key of this player's entry, used for kick-detection
let role = null;
let countdownInterval = null;
let questionBank = [];
let currentIndex = 0;
let isSpinningLocally = false;
let lastSeed = null;
let lastWinner = null;
let lastSelectedTheme = null;
let lastTimerState = false;
let currentTimeLimit = 10;

const buzzerSounds = {
    "Default": "sounds/buzzer/BuzzClassic.mp3",
    "Alert": "sounds/buzzer/BuzzAlert.mp3",
    "Dong": "sounds/buzzer/BuzzDong.mp3",
    "Hard": "sounds/buzzer/BuzzHard.mp3",
    "Heavy": "sounds/buzzer/BuzzHeavy.mp3",
    "Heavy 2": "sounds/buzzer/BuzzHeavy2.mp3",
    "High": "sounds/buzzer/BuzzHigh.mp3",
    "Reverse": "sounds/buzzer/BuzzReverse.mp3",
    "Reverse 2": "sounds/buzzer/BuzzReverse2.mp3",
    "Show": "sounds/buzzer/BuzzShow.mp3",
    "Tchiou": "sounds/buzzer/BuzzMid.mp3",
    "TingWoop": "sounds/buzzer/BuzzTingWoop.mp3",
    "TiTiTi": "sounds/buzzer/BuzzTinTinTin.mp3",
    "Tong": "sounds/buzzer/BuzzTong.mp3",
    "Weird": "sounds/buzzer/BuzzWeird.mp3"
};

let selectedBuzzerKey = localStorage.getItem("userBuzzer") || "Default";
let currentBuzzerSound = new Audio(buzzerSounds[selectedBuzzerKey]);
currentBuzzerSound.volume = 0.4;

const tickSound = new Audio("sounds/WheelSpinTick.mp3");
tickSound.volume = 0.25;

const homeSection = document.getElementById("home");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");
const timeLimitSelect = document.getElementById("timeLimitSelect");

let currentFicheIndex = 0;
let currentThemeVariations = [];

// Prefill the room code when arriving from a QR code link (?room=CODE)
const roomFromUrl = new URLSearchParams(window.location.search).get("room");
if (roomFromUrl) {
    const lobbyCodeInput = document.getElementById("lobbyCodeInput");
    if (lobbyCodeInput) lobbyCodeInput.value = roomFromUrl.toUpperCase();
}
//#endregion

//#region 2. UTILITIES
function showSection(id) {
    [homeSection, lobbySection, gameSection].forEach(s => s.hidden = (s.id !== id));
}

function generateLobbyCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function updateRoom(data) {
    if (!lobbyCode) return;
    return update(ref(db, `rooms/${lobbyCode}`), data);
}

function generateQRCode(code) {
    const url = window.location.origin + window.location.pathname + "?room=" + code;
    const qrElem = document.getElementById("qrCode");
    if (qrElem && typeof QRious !== "undefined") {
        new QRious({ element: qrElem, value: url, size: 150 });
    }
}

// Helper updated to use uniqueThemes
function getTheme(index) {
    const len = uniqueThemes.length;
    if (len === 0) return "Loading...";
    const themeName = uniqueThemes[((index % len) + len) % len];
    return themeName;
}

function getAnswer(card, lvl) {
    return card[`${lvl}_Ans`] || "---";
}

function getDiffClass(lvl) {
    if (lvl.startsWith('E')) return 'easy';
    if (lvl.startsWith('M')) return 'medium';
    return 'hard';
}

function setQuestionsStatus(text, loaded) {
    const statusEl = document.getElementById("questionsStatus");
    if (statusEl) statusEl.textContent = text;
    const randomBtn = document.getElementById("randomThemeBtn");
    const selectBtn = document.getElementById("selectThemeBtn");
    if (randomBtn) randomBtn.disabled = !loaded;
    if (selectBtn) selectBtn.disabled = !loaded;
}

// Player names are user-supplied and get inserted via innerHTML — escape them.
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// --- Session persistence (survives page refresh / reconnect) ---
function saveSession(data) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function loadSession() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch {
        return null;
    }
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}
//#endregion

//#region 3. DATA LOADING
let groupedQuestions = {}; // New global state
let uniqueThemes = [];    // The list for the wheel

Papa.parse("questions.csv", {
    download: true,
    header: true,
    skipEmptyLines: true,
    delimiter: ";",
    complete: (results) => {
        const rawData = results.data;
        groupedQuestions = {};

        rawData.forEach(row => {
            if (!row.Theme) return;
            if (!groupedQuestions[row.Theme]) {
                groupedQuestions[row.Theme] = [];
            }
            groupedQuestions[row.Theme].push(row);
        });

        uniqueThemes = Object.keys(groupedQuestions);
        initSlots(0);
        setQuestionsStatus(`${uniqueThemes.length} themes loaded`, true);
        console.log("Grouped Questions Loaded:", uniqueThemes.length, "unique themes found.");
    },
    error: () => {
        setQuestionsStatus("Failed to load questions.csv", false);
    }
});
//#endregion

//#region 4. LOBBY & JOIN
document.getElementById("createLobbyBtn").addEventListener("click", () => {
    playerName = document.getElementById("hostName").value.trim() || "Host";
    lobbyCode = generateLobbyCode();
    role = "host";

    set(ref(db, 'rooms/' + lobbyCode), {
        host: playerName,
        status: "waiting",
        winner: null,
        activeCard: null,
        blocked: [],
        timeLimit: 10,
        timerActive: false,
        spin: { status: "idle", targetIndex: 0, seed: 0 }
    }).then(() => {
        saveSession({ lobbyCode, role: "host", playerName });
        setupLobbyCodeDisplay(lobbyCode);
        setupGameListeners();
        showSection("lobby");
        updateUIByRole();
        generateQRCode(lobbyCode);
    });
});

function setupLobbyCodeDisplay(code) {
    const elem = document.getElementById("lobbyCode");
    elem.textContent = code;
    elem.classList.add("copyable");
    elem.title = "Click to copy";
    elem.onclick = () => {
        navigator.clipboard?.writeText(code).then(() => {
            elem.textContent = "Copied!";
            setTimeout(() => { elem.textContent = code; }, 1000);
        }).catch(() => { });
    };
}

document.getElementById("joinLobbyBtn").addEventListener("click", () => {
    let inputName = document.getElementById("playerName").value.trim() || "Player";
    const inputCode = document.getElementById("lobbyCodeInput").value.toUpperCase();

    if (!inputCode) return alert("Enter a code!");

    lobbyCode = inputCode;
    role = "player";

    const roomRef = ref(db, `rooms/${lobbyCode}`);

    // 1. Get current room data once to check players
    onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            alert("Lobby not found!");
            return;
        }

        const data = snapshot.val();
        const playersObj = data.players || {};
        const existingNames = Object.values(playersObj).map(p => p.name);

        // 2. Logic to handle duplicate names
        let finalName = inputName;
        let counter = 2;

        while (existingNames.includes(finalName)) {
            finalName = `${inputName} ${counter}`;
            counter++;
        }

        playerName = finalName; // Set the global playerName to the unique one

        // 3. Push to Firebase
        const playerRef = push(ref(db, `rooms/${lobbyCode}/players`), { name: playerName });
        playerRef.then(() => {
            playerKey = playerRef.key;
            saveSession({ lobbyCode, role: "player", playerName, playerKey });
            setupLobbyCodeDisplay(lobbyCode);
            setupGameListeners();
            showSection("lobby");
            updateUIByRole();
            console.log(`✅ Joined as: ${playerName}`);
        });
    }, { onlyOnce: true });
});

document.getElementById("startGameBtn").addEventListener("click", () => {
    updateRoom({ status: "playing" });
});

// Restore a session after a page refresh / accidental close.
function tryReconnect() {
    const session = loadSession();
    if (!session) return;

    onValue(ref(db, `rooms/${session.lobbyCode}`), (snapshot) => {
        const data = snapshot.val();
        if (!data) { clearSession(); return; }

        // If this was a player session, make sure we weren't kicked meanwhile.
        if (session.role === "player" && !(data.players && data.players[session.playerKey])) {
            clearSession();
            return;
        }

        lobbyCode = session.lobbyCode;
        role = session.role;
        playerName = session.playerName;
        playerKey = session.playerKey || null;

        setupLobbyCodeDisplay(lobbyCode);
        setupGameListeners();
        updateUIByRole();
        showSection(data.status === "playing" ? "game" : "lobby");
        if (role === "host") generateQRCode(lobbyCode);
    }, { onlyOnce: true });
}
//#endregion

//#region 5. THEME & SPIN ACTIONS
function initSlots(centerIndex = 0) {
    if (uniqueThemes.length === 0) return;

    const slots = document.querySelectorAll(".slot-card");
    if (slots.length < 5) return;

    slots[0].innerText = getTheme(centerIndex - 2);
    slots[1].innerText = getTheme(centerIndex - 1);
    slots[2].innerText = getTheme(centerIndex);
    slots[3].innerText = getTheme(centerIndex + 1);
    slots[4].innerText = getTheme(centerIndex + 2);
    currentIndex = centerIndex;
}

document.getElementById("randomThemeBtn").onclick = () => {
    if (uniqueThemes.length === 0 || isSpinningLocally) return;

    const target = Math.floor(Math.random() * uniqueThemes.length);

    updateRoom({
        spin: { status: "spinning", targetIndex: target, seed: Date.now() }
    });
};

document.getElementById("keepThemeBtn").onclick = () => {
    const roomRef = ref(db, `rooms/${lobbyCode}`);
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (lastSelectedTheme) {
            updateRoom({
                activeCard: lastSelectedTheme, // Use the local variable
                winner: null,
                blocked: [],
                timerActive: false,
                "spin/status": "idle",
                showPanel: false // Ensure it returns to the Question Grid view
            });
            console.log("🔄 Keep Theme triggered using local memory.");
        } else {
            alert("No theme to keep! Please spin or select one first.");
        }
    }, { onlyOnce: true });
};

document.getElementById("manualModeBtn").onclick = () => {
    updateRoom({ activeCard: { Theme: "MANUAL MODE", E1: "---", E2: "---", M1: "---", M2: "---", H1: "---", H2: "---" } });
};

function openDifficultySelection(themeName) {
    currentThemeVariations = groupedQuestions[themeName] || [];
    currentFicheIndex = 0;
    renderFicheSelector(themeName);
}

/**
 * Renders the Host selection modal.
 */
function renderFicheSelector(themeName) {
    const container = document.getElementById("themeButtonsContainer");
    const modal = document.getElementById('themeListModal');
    const card = currentThemeVariations[currentFicheIndex];

    modal.scrollTop = 0;

    const levels = ['E1', 'E2', 'M1', 'M2', 'H1', 'H2'];

    container.innerHTML = `
        <div class="fiche-nav-header">
            <div class="fiche-info">
                <h2>${themeName}</h2>
                <span class="fiche-counter">CARD ${currentFicheIndex + 1} / ${currentThemeVariations.length}</span>
            </div>
            <button class="close-x" onclick="document.getElementById('themeListModal').hidden = true">✕ Close</button>
        </div>

        <div class="vertical-questions-list">
            ${levels.map(lvl => renderVerticalLevel(card, lvl, getDiffClass(lvl))).join('')}
        </div>

        <div class="fiche-bottom-nav">
            <button onclick="changeFiche(-1)" class="btn-nav-round">◀ Previous</button>
            <div class="fiche-label">Fiche selection</div>
            <button onclick="changeFiche(1)" class="btn-nav-round">Next ▶</button>
        </div>
    `;
}

/**
 * Renders a question card that fills the available width.
 */
function renderVerticalLevel(card, lvl, colorClass) {
    const question = card[lvl];
    if (!question || question === "---") return "";
    const answer = getAnswer(card, lvl);

    return `
        <div class="host-selection-card ${colorClass}" onclick="selectThisQuestion('${lvl}')">
            <div class="card-header">
                <span class="card-lvl-badge ${colorClass}">${lvl}</span>
                <span class="card-hint">Select question</span>
            </div>
            <div class="card-content">
                <div class="qa-label">Question</div>
                <div class="qa-question">${question}</div>
                <div class="qa-label">Expected answer</div>
                <div class="qa-answer-box">${answer}</div>
            </div>
        </div>
    `;
}

// Ensure global functions are available
window.changeFiche = (dir) => {
    currentFicheIndex = (currentFicheIndex + dir + currentThemeVariations.length) % currentThemeVariations.length;
    renderFicheSelector(currentThemeVariations[0].Theme);
};

window.selectThisQuestion = (lvl) => {
    const card = currentThemeVariations[currentFicheIndex];
    updateRoom({
        activeCard: card,
        selectedLevel: lvl,
        winner: null,
        blocked: [],
        "spin/status": "idle",
        showPanel: false
    });
    document.getElementById("themeListModal").hidden = true;
};

// Modifie ton bouton de sélection manuelle
document.getElementById("selectThemeBtn").onclick = () => {
    const container = document.getElementById("themeButtonsContainer");
    container.innerHTML = "<h3>Choisir un thème</h3>";
    uniqueThemes.forEach((themeName, idx) => {
        const btn = document.createElement("button");
        btn.textContent = themeName;
        btn.className = "btn-gm gray";
        btn.onclick = () => openDifficultySelection(themeName);
        container.appendChild(btn);
    });
    document.getElementById("themeListModal").hidden = false;
};

//#endregion

//#region 6. GAME BUTTONS (LATENCY OPTIMIZED)
const buzzBtn = document.getElementById("buzzBtn");
if (buzzBtn) {
    buzzBtn.onclick = () => {
        // Immediate local feedback
        currentBuzzerSound.currentTime = 0;
        currentBuzzerSound.play().catch(() => { });

        // timeLimit is kept in sync by setupGameListeners, so we can write
        // straight away instead of doing a network round-trip first.
        updateRoom({
            winner: playerName,
            winnerSound: selectedBuzzerKey,
            timerActive: true,
            timeLimit: currentTimeLimit
        });
    };
}

const validateBtn = document.getElementById("validateBtn");
if (validateBtn) {
    validateBtn.onclick = () => {
        new Audio("sounds/CorrectAnswer.mp3").play().catch(() => { });
        updateRoom({
            winner: null,
            activeCard: null,
            blocked: [],
            timerActive: false,
            "spin/status": "idle",
            showPanel: false
        });
    };
}

const wrongBtn = document.getElementById("wrongBtn");
if (wrongBtn) {
    wrongBtn.onclick = () => {
        new Audio("sounds/WrongAnswer.mp3").play().catch(() => { });

        const roomRef = ref(db, `rooms/${lobbyCode}`);

        onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) return;

            // 1. Calculate the new blocked list
            let blocks = data.blocked || [];
            if (data.winner && !blocks.includes(data.winner)) {
                blocks.push(data.winner);
            }

            // 2. Get total players in the lobby (excluding the host)
            const totalPlayersCount = data.players ? Object.keys(data.players).length : 0;

            lastTimerState = false;

            // 3. Check if everyone is now blocked
            if (blocks.length >= totalPlayersCount && totalPlayersCount > 0) {
                // ALL PLAYERS WRONG: Full Reset
                resetRound();
                console.log("🚫 All players wrong. Round reset.");
            } else {
                // SOME PLAYERS LEFT: Return to Question Grid
                updateRoom({
                    winner: null,
                    blocked: blocks,
                    timerActive: false,
                    showPanel: false
                });
                console.log("❌ Player blocked. Returning to grid for remaining players.");
            }
        }, { onlyOnce: true });
    };
}

// Shared by the "CLEAR / STOP" button and the in-card "✕ Stop" close button.
function resetRound() {
    updateRoom({
        winner: null,
        activeCard: null,   // Hides the question card for everyone
        selectedLevel: null,
        blocked: [],        // Unblocks all players
        timerActive: false,
        "spin/status": "idle",
        showPanel: false    // Hides the host's control panel
    });
}

const resetBtn = document.getElementById("resetRoundBtn");
if (resetBtn) resetBtn.onclick = resetRound;

window.cancelQuestion = resetRound;

window.kickPlayer = (key) => {
    if (!confirm("Remove this player from the lobby?")) return;
    remove(ref(db, `rooms/${lobbyCode}/players/${key}`));
};

//#endregion

//#region 7. SYNC LISTENERS
function setupGameListeners() {
    const roomRef = ref(db, 'rooms/' + lobbyCode);
    const unsubscribe = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // Kick detection: if our own player entry disappeared, we were removed.
        // (Firebase nulls out `players` entirely once its last child is gone,
        // so this can't require data.players to be truthy first.)
        if (role === "player" && playerKey && !(data.players && data.players[playerKey])) {
            clearSession();
            unsubscribe();
            role = null; lobbyCode = null; playerName = null; playerKey = null;
            showSection("home");
            alert("You were removed from the lobby by the host.");
            return;
        }

        // Players List Sync
        if (data.players) {
            document.getElementById("playersList").innerHTML = Object.entries(data.players)
                .map(([key, p]) => `
                    <li>
                        <span>👤 ${escapeHtml(p.name)}</span>
                        ${role === "host" ? `<button class="kick-btn" onclick="kickPlayer('${key}')" title="Remove player">✕</button>` : ""}
                    </li>
                `).join("");
        }

        // Sound & Winner Sync
        if (data.winner && data.winner !== lastWinner) {
            if (data.winnerSound && buzzerSounds[data.winnerSound]) {
                // Only change source if different to avoid reloading sound mid-play
                const newSrc = window.location.origin + "/" + buzzerSounds[data.winnerSound];
                if (!currentBuzzerSound.src.includes(buzzerSounds[data.winnerSound])) {
                    currentBuzzerSound.src = buzzerSounds[data.winnerSound];
                }
            }
            currentBuzzerSound.currentTime = 0;
            setTimeout(() => currentBuzzerSound.play().catch(() => { }), 50);
        }
        lastWinner = data.winner;

        // Wheel Sync
        if (data.spin?.status === "spinning" && data.spin.seed !== lastSeed) {
            lastSeed = data.spin.seed;
            spinTheWheel(data.spin.targetIndex);
        }

        // Section/Role Sync
        if (data.status === "playing" && gameSection.hidden) {
            showSection("game");
            updateUIByRole();
        }

        role === "host" ? renderHostUI(data) : renderPlayerUI(data);

        // Timer Sync
        const timerContainer = document.getElementById("timerContainer");
        const progressBar = document.getElementById("progressBar");

        if (data.timerActive && data.winner) {
            // Only trigger start if the timer wasn't already active in the previous sync
            if (!lastTimerState) {
                if (timerContainer) timerContainer.hidden = false;
                startLocalTimer(data.timeLimit || 10);
            }
        } else {
            // Round ended or reset: stop everything
            clearInterval(countdownInterval);
            if (timerContainer) timerContainer.hidden = true;
            if (progressBar) {
                progressBar.style.width = "100%";
                progressBar.classList.remove("timer-low");
            }
        }
        // Update the sentinel for the next data pulse
        lastTimerState = data.timerActive;

        currentTimeLimit = data.timeLimit || 10;
        if (data.timeLimit && timeLimitSelect) timeLimitSelect.value = data.timeLimit;
    });
}

/**
 * Renders the Host's active game screen.
 */
function renderHostUI(data) {
    const fullScreenCard = document.getElementById("fullScreenCard");
    const gmActionPanel = document.getElementById("gmActionPanel");

    if (!data.activeCard) {
        fullScreenCard.hidden = true;
        gmActionPanel.hidden = true;
        return;
    }

    const c = data.activeCard;
    const lvl = data.selectedLevel;
    const hasQuestion = !!(lvl && c[lvl]);
    const question = hasQuestion ? c[lvl] : null;
    const answer = hasQuestion ? getAnswer(c, lvl) : null;

    // PHASE 1: Reading Question (Standard View) — skipped in Manual Buzzer mode
    if (hasQuestion) {
        fullScreenCard.innerHTML = `
            <button class="close-x" onclick="cancelQuestion()">✕ Stop</button>
            <div class="host-game-display">
                <div class="reading-zone">
                    <div class="card-lvl-badge ${getDiffClass(lvl)}">${lvl}</div>
                    <p class="question-to-read">${question}</p>
                </div>
                <div class="host-secret-answer">
                    <div class="answer-label">Secret answer</div>
                    <div class="answer-value">${answer}</div>
                </div>
            </div>
        `;
    }

    // PHASE 2: Someone Buzzed — shown even in Manual Buzzer mode (no question card)
    if (data.winner) {
        const answerBlock = hasQuestion ? `
                    <div class="winner-answer-label">Expected answer</div>
                    <div class="winner-answer">${answer}</div>` : "";
        const questionBlock = hasQuestion ? `
                    <div class="winner-question-box">
                        <div class="winner-question-label">Question reminder</div>
                        <div class="winner-question-text">"${question}"</div>
                    </div>` : "";

        document.getElementById("activeWinnerName").innerHTML = `
            <div class="winner-panel">
                <div class="winner-eyebrow">🚨 Team buzzed</div>
                <div class="winner-name">${escapeHtml(data.winner)}</div>
                ${answerBlock}
                ${questionBlock}
            </div>
        `;
    }

    const shouldShowPanel = !!data.winner || data.showPanel === true;
    fullScreenCard.hidden = !hasQuestion || shouldShowPanel;
    gmActionPanel.hidden = !shouldShowPanel;
}

function renderPlayerUI(data) {
    const body = document.body;
    const isBlocked = (data.blocked || []).includes(playerName);
    const whoBuzzedElem = document.getElementById("whoBuzzed");
    const topThemeElem = document.getElementById("playerThemeDisplayTop");

    if (topThemeElem) {
        topThemeElem.textContent = data.activeCard ? data.activeCard.Theme : "WAITING...";
    }

    // Reset background if no winner
    if (!data.winner) {
        body.classList.remove('buzzer-winner', 'buzzer-locked');
        if (whoBuzzedElem) whoBuzzedElem.textContent = "";
    } else {
        // Handle winner/locked backgrounds
        if (data.winner === playerName) {
            body.classList.add('buzzer-winner');
            body.classList.remove('buzzer-locked');
            if (whoBuzzedElem) whoBuzzedElem.textContent = "YOU ARE ANSWERING!";
        } else {
            body.classList.add('buzzer-locked');
            body.classList.remove('buzzer-winner');
            if (whoBuzzedElem) whoBuzzedElem.textContent = `${data.winner.toUpperCase()} IS ANSWERING...`;
        }
    }

    const bBtn = document.getElementById("buzzBtn");
    if (bBtn) {
        const canBuzz = data.activeCard && !data.winner && !isBlocked;
        bBtn.disabled = !canBuzz;
        bBtn.textContent = isBlocked ? "BLOCKED" : (data.winner ? "WAIT..." : "BUZZ !");
    }
}

function updateUIByRole() {
    const isHost = (role === "host");
    document.getElementById("startGameBtn").hidden = !isHost;
    document.getElementById("hostView").hidden = !isHost;
    document.getElementById("playerView").hidden = isHost;
}
//#endregion

//#region 8. ANIMATION & TIMERS
async function spinTheWheel(targetThemeIndex) {
    if (isSpinningLocally) return;
    isSpinningLocally = true;
    const overlay = document.getElementById("slotMachineOverlay");
    const reel = document.getElementById("slotReel");
    if (!overlay || !reel) return;

    overlay.hidden = false;
    const totalSteps = 40, spinDuration = 6100, cardHeight = 30;
    reel.innerHTML = "";
    for (let i = 0; i <= totalSteps + 4; i++) {
        const card = document.createElement("div");
        card.className = "slot-card";
        card.innerText = getTheme((targetThemeIndex - totalSteps - 2) + i);
        reel.appendChild(card);
    }

    tickSound.currentTime = 0;
    tickSound.play().catch(() => { });

    reel.style.transition = "none";
    reel.style.transform = "translateY(0)";
    reel.offsetHeight;
    reel.style.transition = `transform ${spinDuration}ms cubic-bezier(0.15, 0, 0.15, 1)`;
    reel.classList.add("spinning-blur");
    reel.style.transform = `translateY(-${totalSteps * cardHeight}vh)`;

    setTimeout(() => {
        reel.style.transition = "none";
        reel.classList.remove("spinning-blur");
        initSlots(targetThemeIndex);
        overlay.classList.add("winner-glow");

        setTimeout(() => {
            overlay.hidden = true;
            overlay.classList.remove("winner-glow");
            isSpinningLocally = false;

            if (role === "host") {
                const winThemeName = getTheme(targetThemeIndex - 1);
                const variations = groupedQuestions[winThemeName];

                if (variations) {
                    const occurrenceIndex = Math.floor(Math.random() * variations.length);
                    lastSelectedTheme = variations[occurrenceIndex];

                    // 1. UPDATE GLOBAL STATE FOR THE MODAL
                    // Make sure these variable names match your global definitions
                    currentThemeVariations = variations;
                    currentFicheIndex = occurrenceIndex;

                    // 2. SHOW THE MODAL
                    const modal = document.getElementById('themeListModal');
                    modal.hidden = false;

                    // 3. CALL YOUR NEW RENDER FUNCTION
                    renderFicheSelector(winThemeName);

                    // 4. UPDATE FIREBASE/ROOM STATE
                    updateRoom({
                        activeCard: variations[occurrenceIndex],
                        currentOccurrence: occurrenceIndex,
                        winner: null,
                        blocked: [],
                        "spin/status": "done"
                    });
                }
            }
        }, 2000);
    }, spinDuration);
}

function startLocalTimer(seconds) {
    clearInterval(countdownInterval);
    const progressBar = document.getElementById("progressBar");
    const container = document.getElementById("timerContainer");
    if (!progressBar || !container) return;

    // This prevents the "flash" of the old bar size.
    container.hidden = false;
    progressBar.style.width = "100%";

    progressBar.classList.remove("timer-low");
    let totalMs = seconds * 1000, timeLeftMs = totalMs;

    countdownInterval = setInterval(() => {
        timeLeftMs -= 100;
        let percentage = (timeLeftMs / totalMs) * 100;

        // OPTIMIZATION 2: Use Math.max to ensure percentage never goes negative
        progressBar.style.width = Math.max(0, percentage) + "%";

        if (percentage < 30) progressBar.classList.add("timer-low");

        if (timeLeftMs <= 0) {
            clearInterval(countdownInterval);
            // SAFETY: Only the host triggers the database update
            if (role === "host") {
                const wrongBtn = document.getElementById("wrongBtn");
                if (wrongBtn) wrongBtn.click();
            }
        }
    }, 100);
}

function populateBuzzerMenus() {
    const selects = [document.getElementById("buzzerSelect"), document.getElementById("buzzerSelectPlayer")];
    selects.forEach(select => {
        if (!select) return;
        select.innerHTML = Object.keys(buzzerSounds).map(k => `<option value="${k}" ${k === selectedBuzzerKey ? 'selected' : ''}>${k}</option>`).join("");
        select.onchange = (e) => {
            selectedBuzzerKey = e.target.value;
            localStorage.setItem("userBuzzer", selectedBuzzerKey);
            currentBuzzerSound.src = buzzerSounds[selectedBuzzerKey];
            currentBuzzerSound.load();
            currentBuzzerSound.play().catch(() => { });
            selects.forEach(s => { if (s) s.value = e.target.value; });
        };
    });
}

if (timeLimitSelect) {
    timeLimitSelect.onchange = (e) => {
        if (role === "host") updateRoom({ timeLimit: parseInt(e.target.value) });
    };
}

populateBuzzerMenus();
tryReconnect();
//#endregion