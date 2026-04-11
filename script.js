import { db, ref, set, update, onValue, push } from "./firebase.js";

//#region 1. CONFIGURATION & GLOBAL STATE
let lobbyCode = null;
let playerName = null;
let role = null;
let countdownInterval = null;
let questionBank = [];
let currentIndex = 0;
let isSpinningLocally = false;
let lastSeed = null;
let lastWinner = null;
let lastSelectedTheme = null;
let lastTimerState = false;

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
        console.log("Grouped Questions Loaded:", uniqueThemes.length, "unique themes found.");
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
        document.getElementById("lobbyCode").textContent = lobbyCode;
        setupGameListeners();
        showSection("lobby");
        updateUIByRole();
        generateQRCode(lobbyCode);
    });
});

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
        push(ref(db, `rooms/${lobbyCode}/players`), { name: playerName }).then(() => {
            document.getElementById("lobbyCode").textContent = lobbyCode;
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
//#endregion

//#region 5. THEME & SPIN ACTIONS
// Cette fonction va générer les boutons pour CHAQUE question du thème choisi
function displayQuestionSelection(themeName) {
    const variations = groupedQuestions[themeName];
    const container = document.getElementById("themeButtonsContainer"); // On réutilise ce container ou un autre dédié
    container.innerHTML = `<h3>Thème : ${themeName} - Choisissez une question</h3>`;

    variations.forEach((q, index) => {
        const btn = document.createElement("button");
        btn.className = "btn-gm blue"; // Une couleur différente pour les questions
        // On affiche un aperçu de la question (E1, M1, etc. selon tes colonnes CSV)
        btn.textContent = `Question ${index + 1}: ${q.E1 || q.Question || "Voir"}`;

        btn.onclick = () => {
            lastSelectedTheme = q;
            // On envoie seulement MAINTENANT la question à Firebase
            updateRoom({
                activeCard: q,
                selectedQuestionIndex: index, // Optionnel: pour savoir laquelle est prise
                winner: null,
                blocked: [],
                "spin/status": "idle",
                showPanel: false // On cache le panel pour voir la question en grand
            });
            document.getElementById("themeListModal").hidden = true;
        };
        container.appendChild(btn);
    });
    document.getElementById("themeListModal").hidden = false;
}

// Si tu as une fonction qui gère la fin de l'animation de la roue (Spin)
// il faudra qu'elle appelle aussi displayQuestionSelection(uniqueThemes[targetIndex])

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

    // Force full screen height on the container
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.minHeight = "100vh";

    container.innerHTML = `
        <div class="fiche-nav-header">
            <div class="fiche-info">
                <h2 style="margin:0; font-size:1.1rem; color:#fff;">${themeName}</h2>
                <span class="fiche-counter">CARD ${currentFicheIndex + 1} / ${currentThemeVariations.length}</span>
            </div>
            <button class="close-x" onclick="document.getElementById('themeListModal').hidden = true">✖ CLOSE</button>
        </div>

        <div class="vertical-questions-list">
            ${renderVerticalLevel(card, 'E1', 'easy')}
            ${renderVerticalLevel(card, 'E2', 'easy')}
            ${renderVerticalLevel(card, 'M1', 'medium')}
            ${renderVerticalLevel(card, 'M2', 'medium')}
            ${renderVerticalLevel(card, 'H1', 'hard')}
            ${renderVerticalLevel(card, 'H2', 'hard')}
        </div>

        <div class="fiche-bottom-nav">
            <button onclick="changeFiche(-1)" class="btn-nav-round">◀ PREVIOUS</button>
            <div style="color: #fff; font-weight: bold; font-size: 0.9rem; letter-spacing:1px;">FICHE SELECTION</div>
            <button onclick="changeFiche(1)" class="btn-nav-round">NEXT ▶</button>
        </div>
    `;
}

/**
 * Renders a question card that fills the available width.
 */
function renderVerticalLevel(card, lvl, colorClass) {
    const question = card[lvl];
    const answer = card[`${lvl}_Ans`] || card[`${lvl}Ans`] || card[`${lvl}_ans`] || "---";

    if (!question || question === "---") return "";

    return `
        <div class="host-selection-card ${colorClass}" onclick="selectThisQuestion('${lvl}')">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <span class="card-lvl-badge" style="font-weight:bold; padding:4px 10px; border-radius:4px; background:rgba(255,255,255,0.1);">${lvl}</span>
                <span style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; opacity:0.6;">Select Question</span>
            </div>
            
            <div class="card-content">
                <div style="color:rgba(255,255,255,0.5); font-size:0.75rem; font-weight:bold; margin-bottom:4px;">QUESTION</div>
                <div style="font-size:1.2rem; line-height:1.4; margin-bottom:15px; color:#fff;">${question}</div>
                
                <div style="color:rgba(255,255,255,0.5); font-size:0.75rem; font-weight:bold; margin-bottom:4px;">EXPECTED ANSWER</div>
                <div style="background: rgba(0,0,0,0.3); padding:10px; border-radius:8px; border-left: 4px solid currentColor; font-style: italic;">
                    ${answer}
                </div>
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

        // We need to get the timeLimit that was set by the host
        const roomRef = ref(db, `rooms/${lobbyCode}`);
        onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            const limit = data.timeLimit || 10; // Fallback to 10 if not found

            updateRoom({
                winner: playerName,
                winnerSound: selectedBuzzerKey,
                timerActive: true,
                timeLimit: limit // <--- THIS ensures players' timers know the duration!
            });
        }, { onlyOnce: true });
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
                updateRoom({
                    winner: null,
                    activeCard: null,  // Hides the question for everyone
                    selectedLevel: null,
                    blocked: [],       // Clears blocks for next round
                    timerActive: false,
                    "spin/status": "idle",
                    showPanel: false,   // Returns host to main GM screen
                });
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

const stopBtn = document.getElementById("forceStopBtn") || document.getElementById("resetRoundBtn");
if (stopBtn) {
    stopBtn.onclick = () => {
        updateRoom({
            winner: null,
            activeCard: null,  // This hides the question card for everyone
            blocked: [],       // This unblocks all players
            timerActive: false,
            "spin/status": "idle",
            showPanel: false   // This hides the host's control panel
        });
    };
}

const resetBtn = document.getElementById("resetRoundBtn");
if (resetBtn) {
    resetBtn.onclick = () => {
        updateRoom({
            winner: null,
            activeCard: null,  // This hides the question card for everyone
            blocked: [],       // This unblocks all players
            timerActive: false,
            "spin/status": "idle",
            showPanel: false   // This hides the host's control panel
        });
    };
}

// 3. Bouton Annuler (pour ta croix ou le bouton STOP)
window.cancelQuestion = () => {
    updateRoom({
        activeCard: null,
        selectedLevel: null,
        winner: null,
        blocked: [],
        timerActive: false,
        showPanel: false
    });
};

//#endregion

//#region 7. SYNC LISTENERS
function setupGameListeners() {
    onValue(ref(db, 'rooms/' + lobbyCode), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // Players List Sync
        if (data.players) {
            document.getElementById("playersList").innerHTML = Object.values(data.players)
                .map(p => `<li>👤 ${p.name}</li>`).join("");
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
                if (timerContainer) {
                    timerContainer.hidden = false;
                    timerContainer.style.display = "block";
                }
                startLocalTimer(data.timeLimit || 10);
            }
        } else {
            // Round ended or reset: stop everything
            clearInterval(countdownInterval);
            if (timerContainer) {
                timerContainer.hidden = true;
                timerContainer.style.display = "none";
            }
            if (progressBar) {
                progressBar.style.width = "100%";
                progressBar.classList.remove("timer-low");
            }
        }
        // Update the sentinel for the next data pulse
        lastTimerState = data.timerActive;

        if (data.timeLimit && timeLimitSelect) timeLimitSelect.value = data.timeLimit;
    });
}

/**
 * Renders the Host's active game screen.
 */
function renderHostUI(data) {
    const fullScreenCard = document.getElementById("fullScreenCard");
    const gmActionPanel = document.getElementById("gmActionPanel");

    if (data.activeCard && data.selectedLevel) {
        const c = data.activeCard;
        const lvl = data.selectedLevel;
        const question = c[lvl];
        const answer = c[`${lvl}_Ans`] || c[`${lvl}Ans`] || c[`${lvl}_ans`] || "---";

        // PHASE 1: Reading Question (Standard View)
        fullScreenCard.innerHTML = `
            <button class="close-x" onclick="cancelQuestion()">✖ STOP</button>
            <div class="host-game-display" style="display:flex; flex-direction:column; height:100vh; background:#0f172a;">
                <div class="reading-zone" style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:40px; text-align:center;">
                    <div class="card-lvl-badge" style="position:static; margin-bottom:20px; background:rgba(255,255,255,0.1); padding:5px 15px; border-radius:8px;">${lvl}</div>
                    <p class="question-to-read" style="font-size:2.5rem; font-weight:bold; color:white; line-height:1.2;">${question}</p>
                </div>
                <div class="host-secret-answer" style="background:#1e293b; padding:30px; text-align:center; border-top:4px solid #3498db;">
                    <span style="color:#94a3b8; font-size:0.9rem; font-weight:bold; letter-spacing:2px;">SECRET ANSWER</span>
                    <div style="font-size:2rem; color:#2ecc71; font-weight:900; margin-top:10px;">${answer}</div>
                </div>
            </div>
        `;

        // PHASE 2: Someone Buzzed (The Action Panel Fix)
        if (data.winner) {
            // Apply high-contrast styling to the winner panel
            document.getElementById("activeWinnerName").innerHTML = `
                <div style="background: #1e293b; padding: 25px; border-radius: 15px; border: 2px solid #f1c40f; box-shadow: 0 0 20px rgba(241, 196, 15, 0.2);">
                    
                    <div style="color: #f1c40f; font-size: 1.2rem; font-weight: 800; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 5px;">
                        🚨 TEAM BUZZED
                    </div>
                    <div style="font-size: 3.5rem; color: #fff; font-weight: 900; margin-bottom: 20px; text-shadow: 0 4px 10px rgba(0,0,0,0.5);">
                        ${data.winner}
                    </div>

                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0;">

                    <div style="color: #94a3b8; font-size: 0.9rem; font-weight: bold; margin-bottom: 5px;">EXPECTED ANSWER:</div>
                    <div style="font-size: 3rem; color: #2ecc71; font-weight: 900; line-height: 1.1; margin-bottom: 25px;">
                        ${answer}
                    </div>

                    <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 10px; border-left: 4px solid #3498db;">
                        <div style="color: #3498db; font-size: 0.7rem; font-weight: bold; margin-bottom: 5px; text-align: left;">QUESTION REMINDER:</div>
                        <div style="font-size: 1.1rem; color: #cbd5e1; font-style: italic; text-align: left;">"${question}"</div>
                    </div>
                </div>
            `;

            // Hide the old unused table
            const table = gmActionPanel.querySelector(".answer-table");
            if (table) table.style.display = "none";
        }

        const shouldShowPanel = !!data.winner || data.showPanel === true;
        fullScreenCard.hidden = shouldShowPanel;
        gmActionPanel.hidden = !shouldShowPanel;
    } else {
        fullScreenCard.hidden = true;
        gmActionPanel.hidden = true;
    }
}

function getDiffClass(lvl) {
    if (lvl.startsWith('E')) return 'easy';
    if (lvl.startsWith('M')) return 'medium';
    return 'hard';
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
    container.style.display = "block";
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
//#endregion