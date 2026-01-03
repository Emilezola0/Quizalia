import { db, ref, set, update, onValue, push } from "./firebase.js";

//#region Starting Variables

// --- GLOBAL VARIABLES ---
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

// --- BUZZER SOUND CONFIG ---
const buzzerSounds = {
    "Default": "sounds/buzzer/BuzzClassic.mp3",
    "Alert": "sounds/buzzer/BuzzAlert.mp3",
    "Dong": "sounds/buzzer/BuzzDong.mp3",
    "Hard": "sounds/buzzer/BuzzHard.mp3",
    "Heavy": "sounds/buzzer/BuzzHeavy.mp3",
    "Heavy 2": "sounds/buzzer/BuzzHeavy2.mp3",
    "High": "sounds/buzzer/BuzzHigh.mp3",
    "Mid": "sounds/bbuzzer/BuzzMid.mp3",
    "Reverse": "sounds/buzzer/BuzzReverse.mp3",
    "Reverse 2": "sounds/buzzer/BuzzReverse2.mp3",
    "Show": "sounds/buzzer/BuzzShow.mp3",
    "TingWoop": "sounds/buzzer/BuzzTingWoop.mp3",
    "TiTiTi": "sounds/buzzer/BuzzTinTinTin.mp3",
    "Tong": "sounds/buzzer/BuzzTong.mp3",
    "Weird": "sounds/buzzer/BuzzWeird.mp3"
};

let selectedBuzzerKey = localStorage.getItem("userBuzzer") || "Default";
let currentBuzzerSound = new Audio(buzzerSounds[selectedBuzzerKey]);

const tickSound = new Audio("sounds/WheelSpinTick.mp3");
tickSound.volume = 0.25;

// Elements
const homeSection = document.getElementById("home");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");

//#endregion

//#region CSV DATA
// --- 1. CSV DATA LOADER ---
Papa.parse("questions.csv", {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
        questionBank = results.data;
        initSlots(0);
        console.log("Questions Loaded:", questionBank);
    }
});

//#endregion

// --- 2. UTILS ---
function showSection(id) {
    [homeSection, lobbySection, gameSection].forEach(s => s.hidden = (s.id !== id));
}

function generateLobbyCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

//#region LOBBY MANAGEMENT

// --- 3. LOBBY MANAGEMENT ---
document.getElementById("createLobbyBtn").addEventListener("click", () => {
    playerName = document.getElementById("hostName").value || "Host";
    lobbyCode = generateLobbyCode();
    role = "host";
    set(ref(db, 'rooms/' + lobbyCode), {
        host: playerName,
        status: "waiting",
        winner: null,
        activeCard: null,
        blocked: [],
        timeLimit: 10,
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
    playerName = document.getElementById("playerName").value || "Player";
    lobbyCode = document.getElementById("lobbyCodeInput").value.toUpperCase();
    role = "player";
    const playerListRef = ref(db, `rooms/${lobbyCode}/players`);
    push(playerListRef, { name: playerName }).then(() => {
        document.getElementById("lobbyCode").textContent = lobbyCode;
        setupGameListeners();
        showSection("lobby");
        updateUIByRole();
    }).catch(() => alert("Lobby not found!"));
});

document.getElementById("startGameBtn").addEventListener("click", () => {
    update(ref(db, 'rooms/' + lobbyCode), { status: "playing" });
});

//#endregion

// 2. Add the Change function
function changeBuzzerSound(key) {
    if (buzzerSounds[key]) {
        selectedBuzzerKey = key;
        localStorage.setItem("userBuzzer", key);

        // Don't create 'new Audio', just update the source
        currentBuzzerSound.src = buzzerSounds[key];
        currentBuzzerSound.volume = 0.3;

        // Load and play a preview
        currentBuzzerSound.load();
        currentBuzzerSound.play().catch(e => console.log("Preview blocked:", e));
    }
}
// Example: Populate a select element if you have one with id "buzzerSelect"
const buzzerSelect = document.getElementById("buzzerSelect");
if (buzzerSelect) {
    Object.keys(buzzerSounds).forEach(key => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = key;
        if (key === selectedBuzzerKey) opt.selected = true;
        buzzerSelect.appendChild(opt);
    });
    buzzerSelect.onchange = (e) => changeBuzzerSound(e.target.value);
}

// 3. Add the Initialization function
function initBuzzerMenus() {
    const menus = [document.getElementById("buzzerSelect"), document.getElementById("buzzerSelectPlayer")];
    menus.forEach(menu => {
        if (!menu) return;
        menu.innerHTML = "";
        Object.keys(buzzerSounds).forEach(key => {
            const opt = document.createElement("option");
            opt.value = key;
            opt.textContent = key;
            if (key === selectedBuzzerKey) opt.selected = true;
            menu.appendChild(opt);
        });
        menu.onchange = (e) => {
            changeBuzzerSound(e.target.value);
            // Sync the other menu if it exists
            menus.forEach(m => { if (m) m.value = e.target.value; });
        };
    });
}

//#region THEME LOGIC & SPIN WHEEL

// --- 4. THEME LOGIC & SPIN WHEEL (FLUID VERSION) ---

// 1. Initialise les slots (statique)
function initSlots(centerIndex = 0) {
    if (questionBank.length === 0) return;
    const slots = document.querySelectorAll(".slot-card");

    // On s'assure que l'affichage statique est identique à la fin de l'animation
    slots[0].innerText = getTheme(centerIndex - 2).Theme;
    slots[1].innerText = getTheme(centerIndex - 1).Theme;
    slots[2].innerText = getTheme(centerIndex).Theme;
    slots[3].innerText = getTheme(centerIndex + 1).Theme;
    slots[4].innerText = getTheme(centerIndex + 2).Theme;

    currentIndex = centerIndex;
}

function getTheme(index) {
    const len = questionBank.length;
    return questionBank[((index % len) + len) % len];
}

function startSyncedSpin() {
    const target = Math.floor(Math.random() * questionBank.length);
    update(ref(db, 'rooms/' + lobbyCode + '/spin'), {
        targetIndex: target,
        seed: Date.now(),
        status: "spinning"
    });
}

function directSelectTheme(themeObj) {
    if (!themeObj) return;
    update(ref(db, 'rooms/' + lobbyCode), {
        activeCard: themeObj,
        winner: null,
        blocked: [],
        "spin/status": "idle"
    });
}

// 2. La fonction de spin fluide (Remplace entièrement l'ancienne)
async function spinTheWheel(targetThemeIndex) {
    if (isSpinningLocally) return;
    isSpinningLocally = true;

    const overlay = document.getElementById("slotMachineOverlay");
    const reel = document.getElementById("slotReel");
    overlay.hidden = false;

    const totalSteps = 40;
    const spinDuration = 6100;
    const cardHeight = 30;

    reel.innerHTML = "";

    for (let i = 0; i <= totalSteps + 4; i++) {
        const card = document.createElement("div");
        card.className = "slot-card";
        const themeIndex = (targetThemeIndex - totalSteps - 2) + i;
        card.innerText = getTheme(themeIndex).Theme;
        reel.appendChild(card);
    }

    if (typeof tickSound !== 'undefined') {
        tickSound.currentTime = 0;
        tickSound.play().catch(() => { });
    }

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

        // FIX: Use getTheme helper to handle index 0 -> Last Item wrap-around
        const finalWinnerTheme = getTheme(targetThemeIndex - 1);
        lastSelectedTheme = finalWinnerTheme;

        overlay.classList.add("winner-glow");

        setTimeout(() => {
            overlay.hidden = true;
            overlay.classList.remove("winner-glow");
            isSpinningLocally = false;

            if (role === "host") {
                // FIX: Ensure currentIndex is synced with the winning theme index
                // We use the same math as finalWinnerTheme to keep it consistent
                currentIndex = ((targetThemeIndex - 1) % questionBank.length + questionBank.length) % questionBank.length;

                update(ref(db, 'rooms/' + lobbyCode), {
                    activeCard: finalWinnerTheme,
                    winner: null,
                    blocked: [],
                    "spin/status": "done"
                });
            }
        }, 2000);
    }, spinDuration);
}

//#endregion

//#region BUZZER & ACTIONS (BUTTONS)

// --- 5. BUZZER & ACTION ---
document.getElementById("randomThemeBtn").onclick = () => startSyncedSpin();

document.getElementById("keepThemeBtn").onclick = () => {
    if (!lastSelectedTheme) {
        console.error("No theme to keep yet!");
        return;
    }

    // 1. Update local UI
    const themeIndex = questionBank.findIndex(q => q.Theme === lastSelectedTheme.Theme);
    if (themeIndex !== -1) initSlots(themeIndex);

    // 2. Update Firebase
    directSelectTheme(lastSelectedTheme);

    console.log("Keeping Theme:", lastSelectedTheme.Theme);
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
            directSelectTheme(q);
            lastSelectedTheme = q;
            document.getElementById("themeListModal").hidden = true;
        };
        container.appendChild(btn);
    });
    document.getElementById("themeListModal").hidden = false;
};

document.getElementById("manualModeBtn").onclick = () => {
    directSelectTheme({ Theme: "MANUAL MODE", E1: "---", E2: "---", M1: "---", M2: "---", H1: "---", H2: "---" });
};

document.getElementById("buzzBtn").onclick = () => {
    currentBuzzerSound.currentTime = 0;
    currentBuzzerSound.play().catch(e => console.log("Audio blocked"));

    update(ref(db, 'rooms/' + lobbyCode), {
        winner: playerName,
        winnerSound: selectedBuzzerKey, // Add this line
        timerActive: true
    });
};

document.getElementById("validateBtn").onclick = () => {
    const validateSound = new Audio("sounds/CorrectAnswer.mp3")
    validateSound.currentTime = 0
    validateSound.play()
    update(ref(db, 'rooms/' + lobbyCode), {
        winner: null,
        activeCard: null,
        blocked: [],
        timerActive: false,
        "spin/status": "idle"
    });
};

document.getElementById("wrongBtn").onclick = () => {
    const wrongAnswerSound = new Audio("sounds/WrongAnswer.mp3")
    wrongAnswerSound.currentTime = 0
    wrongAnswerSound.play()
    const roomRef = ref(db, 'rooms/' + lobbyCode);
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        let currentBlocks = data.blocked || [];
        if (data.winner && !currentBlocks.includes(data.winner)) currentBlocks.push(data.winner);
        update(roomRef, { winner: null, blocked: currentBlocks, timerActive: false });
    }, { onlyOnce: true });
};

document.getElementById("resetRoundBtn").onclick = () => {
    update(ref(db, 'rooms/' + lobbyCode), {
        activeCard: null,
        winner: null,
        blocked: [],
        timerActive: false,
        "spin/status": "idle"
    });
};

document.getElementById("forceStopBtn").onclick = () => document.getElementById("resetRoundBtn").click();

//#endregion

//#region LISTENERS

// --- 6. LISTENERS ---
function setupGameListeners() {
    onValue(ref(db, 'rooms/' + lobbyCode), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        if (data.timeLimit) {
            syncTimerSelect(data.timeLimit);
        }

        // If a new winner is detected, play the sound
        if (data.winner && data.winner !== lastWinner) {
            if (data.winnerSound && buzzerSounds[data.winnerSound]) {
                // Only update if it's actually different to prevent restart loops
                if (currentBuzzerSound.src !== window.location.origin + "/" + buzzerSounds[data.winnerSound]) {
                    currentBuzzerSound.src = buzzerSounds[data.winnerSound];
                    currentBuzzerSound.load(); // Force the browser to buffer the new file
                }
            }

            currentBuzzerSound.currentTime = 0;
            // We use a small timeout to ensure the 'src' change is registered
            setTimeout(() => {
                currentBuzzerSound.play().catch(e => console.log("Playback blocked:", e));
            }, 50);
        }
        // ------------------------

        if (data.spin && data.spin.status === "spinning" && data.spin.seed !== lastSeed) {
            lastSeed = data.spin.seed;
            spinTheWheel(data.spin.targetIndex);
        }

        if (data.players) {
            document.getElementById("playersList").innerHTML = Object.values(data.players)
                .map(p => `<li>👤 ${p.name}</li>`).join("");
        }

        if (data.status === "playing" && gameSection.hidden) {
            showSection("game");
            updateUIByRole();
        }

        const isHost = (role === "host");
        if (isHost) {
            if (data.activeCard) {
                const c = data.activeCard;
                ["E1", "E2", "M1", "M2", "H1", "H2"].forEach(k => {
                    if (document.getElementById(`tableAns${k}`)) document.getElementById(`tableAns${k}`).textContent = c[`${k}_Ans`] || "---";
                    if (document.getElementById(`q${k}`)) document.getElementById(`q${k}`).textContent = c[k] || "---";
                    if (document.getElementById(`cardAns${k}`)) document.getElementById(`cardAns${k}`).textContent = c[`${k}_Ans`] || "---";
                });

                if (data.winner) {
                    document.getElementById("fullScreenCard").hidden = true;
                    document.getElementById("gmActionPanel").hidden = false;
                    document.getElementById("activeWinnerName").textContent = "BUZZ: " + data.winner;
                } else {
                    document.getElementById("fullScreenCard").hidden = false;
                    document.getElementById("gmActionPanel").hidden = true;
                }
            } else {
                document.getElementById("fullScreenCard").hidden = true;
                document.getElementById("gmActionPanel").hidden = true;
            }

            // HOST PROTECTION: Ensure host background stays normal
            document.body.classList.remove('buzzer-winner', 'buzzer-locked');

        } else {
            // --- PLAYER BACKGROUND LOGIC ---
            const body = document.body;

            if (data.winner) {
                if (data.winner === playerName) {
                    // I am the winner!
                    body.classList.add('buzzer-winner');
                    body.classList.remove('buzzer-locked');
                } else {
                    // Someone else buzzed!
                    body.classList.add('buzzer-locked');
                    body.classList.remove('buzzer-winner');
                }
            } else {
                // No one has buzzed, reset to normal
                body.classList.remove('buzzer-winner', 'buzzer-locked');
            }

            const isBlocked = (data.blocked || []).includes(playerName);
            const bBtn = document.getElementById("buzzBtn");

            if (data.activeCard) {
                document.getElementById("playerThemeDisplay").textContent = data.activeCard.Theme;
            } else {
                document.getElementById("playerThemeDisplay").textContent = "Wait for Host...";
            }

            bBtn.disabled = !data.activeCard || data.winner || isBlocked;
            bBtn.textContent = isBlocked ? "BLOCKED" : "BUZZ !";

            if (data.timerActive && data.winner) {
                startLocalTimer(data.timeLimit || 10);
            } else {
                clearInterval(countdownInterval);
                document.getElementById("timerContainer").hidden = true;
            }
        }
    });
}

//#endregion

function updateUIByRole() {
    const isHost = (role === "host");
    document.getElementById("startGameBtn").hidden = !isHost;
    document.getElementById("hostView").hidden = !isHost;
    document.getElementById("playerView").hidden = isHost;
}

function startLocalTimer(seconds) {
    clearInterval(countdownInterval);
    const progressBar = document.getElementById("progressBar");
    const container = document.getElementById("timerContainer");

    container.hidden = false;
    progressBar.classList.remove("timer-low"); // Reset animation

    let totalMs = seconds * 1000;
    let timeLeftMs = totalMs;

    countdownInterval = setInterval(() => {
        timeLeftMs -= 100; // Update every 100ms for smoothness
        let percentage = (timeLeftMs / totalMs) * 100;

        progressBar.style.width = percentage + "%";

        // Add "Danger" animation when less than 3 seconds left
        if (percentage < 30) {
            progressBar.classList.add("timer-low");
        }

        if (timeLeftMs <= 0) {
            clearInterval(countdownInterval);
            progressBar.style.width = "0%";
            if (role === "host") document.getElementById("wrongBtn").click();
        }
    }, 100);
}

function generateQRCode(code) {
    const url = window.location.origin + window.location.pathname + "?room=" + code;
    new QRious({ element: document.getElementById("qrCode"), value: url, size: 150 });
}

// Function to fill all buzzer selects in the HTML
function populateBuzzerMenus() {
    const selects = [document.getElementById("buzzerSelect"), document.getElementById("buzzerSelectPlayer")];

    selects.forEach(select => {
        if (!select) return;
        select.innerHTML = ""; // Clear existing
        Object.keys(buzzerSounds).forEach(key => {
            const opt = document.createElement("option");
            opt.value = key;
            opt.textContent = key;
            if (key === selectedBuzzerKey) opt.selected = true;
            select.appendChild(opt);
        });

        select.onchange = (e) => {
            changeBuzzerSound(e.target.value);
            // Sync both dropdowns if both exist
            selects.forEach(s => { if (s) s.value = e.target.value; });
        };
    });
}

//#region Timer

const timeLimitSelect = document.getElementById("timeLimitSelect");

if (timeLimitSelect) {
    timeLimitSelect.onchange = (e) => {
        const newLimit = parseInt(e.target.value);
        if (lobbyCode && role === "host") {
            update(ref(db, 'rooms/' + lobbyCode), {
                timeLimit: newLimit
            });
            console.log("Timer updated to:", newLimit);
        }
    };
}

function syncTimerSelect(value) {
    if (timeLimitSelect) {
        timeLimitSelect.value = value;
    }
}

//#endregion

// Call this ONCE at the end of the script
populateBuzzerMenus();