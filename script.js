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

// Helper to handle negative modulo (index wrap-around)
function getTheme(index) {
    const len = questionBank.length;
    if (len === 0) return { Theme: "Loading..." };
    return questionBank[((index % len) + len) % len];
}
//#endregion

//#region 3. DATA LOADING
Papa.parse("questions.csv", {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
        questionBank = results.data;
        initSlots(0);
        console.log("✅ Questions Loaded");
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
function initSlots(centerIndex = 0) {
    if (questionBank.length === 0) return;
    const slots = document.querySelectorAll(".slot-card");
    if (slots.length < 5) return;
    slots[0].innerText = getTheme(centerIndex - 2).Theme;
    slots[1].innerText = getTheme(centerIndex - 1).Theme;
    slots[2].innerText = getTheme(centerIndex).Theme;
    slots[3].innerText = getTheme(centerIndex + 1).Theme;
    slots[4].innerText = getTheme(centerIndex + 2).Theme;
    currentIndex = centerIndex;
}

document.getElementById("randomThemeBtn").onclick = () => {
    if (questionBank.length === 0 || isSpinningLocally) return;
    const target = Math.floor(Math.random() * questionBank.length);
    updateRoom({
        spin: { status: "spinning", targetIndex: target, seed: Date.now() }
    });
};

document.getElementById("selectThemeBtn").onclick = () => {
    const container = document.getElementById("themeButtonsContainer");
    container.innerHTML = "";
    questionBank.forEach((q, idx) => {
        const btn = document.createElement("button");
        btn.textContent = q.Theme;
        btn.className = "btn-gm gray";
        btn.onclick = () => {
            initSlots(idx);
            lastSelectedTheme = q;
            updateRoom({ activeCard: q, winner: null, blocked: [], "spin/status": "idle" });
            document.getElementById("themeListModal").hidden = true;
        };
        container.appendChild(btn);
    });
    document.getElementById("themeListModal").hidden = false;
};

document.getElementById("keepThemeBtn").onclick = () => {
    if (lastSelectedTheme) updateRoom({ activeCard: lastSelectedTheme, winner: null, blocked: [], "spin/status": "idle" });
};

document.getElementById("manualModeBtn").onclick = () => {
    updateRoom({ activeCard: { Theme: "MANUAL MODE", E1: "---", E2: "---", M1: "---", M2: "---", H1: "---", H2: "---" } });
};
//#endregion

//#region 6. GAME BUTTONS (LATENCY OPTIMIZED)
const buzzBtn = document.getElementById("buzzBtn");
if (buzzBtn) {
    buzzBtn.onclick = () => {
        // Immediate local feedback
        currentBuzzerSound.currentTime = 0;
        currentBuzzerSound.play().catch(() => { });

        updateRoom({
            winner: playerName,
            winnerSound: selectedBuzzerKey,
            timerActive: true
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

            // 3. Check if everyone is now blocked
            if (blocks.length >= totalPlayersCount && totalPlayersCount > 0) {
                // ALL PLAYERS WRONG: Full Reset
                updateRoom({
                    winner: null,
                    activeCard: null,  // Hides the question for everyone
                    blocked: [],       // Clears blocks for next round
                    timerActive: false,
                    "spin/status": "idle",
                    showPanel: false   // Returns host to main GM screen
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
        if (data.timerActive && data.winner) {
            startLocalTimer(data.timeLimit || 10);
        } else {
            clearInterval(countdownInterval);
            if (document.getElementById("timerContainer")) document.getElementById("timerContainer").hidden = true;
        }

        if (data.timeLimit && timeLimitSelect) timeLimitSelect.value = data.timeLimit;
    });
}

function renderHostUI(data) {
    if (data.activeCard) {
        const c = data.activeCard;
        const levels = ["E1", "E2", "M1", "M2", "H1", "H2"];

        levels.forEach(k => {
            const ansElem = document.getElementById(`tableAns${k}`);
            const qstElem = document.getElementById(`q${k}`);
            const cardAnsElem = document.getElementById(`cardAns${k}`);

            if (qstElem) qstElem.textContent = c[k] || "---";
            const answerText = c[`${k}_Ans`] || c[`${k}Ans`] || c[`${k}_ans`] || "---";

            if (ansElem) ansElem.textContent = answerText;
            if (cardAnsElem) cardAnsElem.textContent = answerText;
        });

        // The logic for showing the panel
        // If there is a winner OR the host manually stopped the round
        const shouldShowPanel = !!data.winner || data.showPanel === true;

        document.getElementById("fullScreenCard").hidden = shouldShowPanel;
        document.getElementById("gmActionPanel").hidden = !shouldShowPanel;

        if (data.winner) {
            document.getElementById("activeWinnerName").textContent = "BUZZ: " + data.winner;
        } else {
            document.getElementById("activeWinnerName").textContent = "QUESTION PHASE";
        }
    } else {
        document.getElementById("fullScreenCard").hidden = true;
        document.getElementById("gmActionPanel").hidden = true;
    }
    // Host never gets red/green backgrounds
    document.body.classList.remove('buzzer-winner', 'buzzer-locked');
}

function renderPlayerUI(data) {
    const body = document.body;
    const isBlocked = (data.blocked || []).includes(playerName);

    if (!data.winner) {
        body.classList.remove('buzzer-winner', 'buzzer-locked');
    }

    // BACKGROUND LOGIC
    if (data.winner) {
        if (data.winner === playerName) {
            body.classList.add('buzzer-winner');
            body.classList.remove('buzzer-locked');
        } else {
            body.classList.add('buzzer-locked');
            body.classList.remove('buzzer-winner');
        }
    } else {
        // No winner? Reset background so players can see clearly
        body.classList.remove('buzzer-winner', 'buzzer-locked');
    }

    // BUTTON LOGIC
    const bBtn = document.getElementById("buzzBtn");
    if (bBtn) {
        // The buzzer is enabled if:
        // 1. There is an active card
        // 2. There is NO current winner
        // 3. The player isn't in the "blocked" (wrong answer) list
        const canBuzz = data.activeCard && !data.winner && !isBlocked;

        bBtn.disabled = !canBuzz;
        bBtn.textContent = isBlocked ? "BLOCKED" : (data.winner ? "WAIT..." : "BUZZ !");
    }

    document.getElementById("playerThemeDisplay").textContent = data.activeCard ? data.activeCard.Theme : "Wait for Host...";
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
        card.innerText = getTheme((targetThemeIndex - totalSteps - 2) + i).Theme;
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
                const winTheme = getTheme(targetThemeIndex - 1);
                lastSelectedTheme = winTheme;
                updateRoom({ activeCard: winTheme, winner: null, blocked: [], "spin/status": "done" });
            }
        }, 2000);
    }, spinDuration);
}

function startLocalTimer(seconds) {
    clearInterval(countdownInterval);
    const progressBar = document.getElementById("progressBar");
    const container = document.getElementById("timerContainer");
    if (!progressBar || !container) return;

    container.hidden = false;
    progressBar.classList.remove("timer-low");
    let totalMs = seconds * 1000, timeLeftMs = totalMs;
    countdownInterval = setInterval(() => {
        timeLeftMs -= 100;
        let percentage = (timeLeftMs / totalMs) * 100;
        progressBar.style.width = percentage + "%";
        if (percentage < 30) progressBar.classList.add("timer-low");
        if (timeLeftMs <= 0) {
            clearInterval(countdownInterval);
            if (role === "host") document.getElementById("wrongBtn").click();
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