import { db, ref, set, update, onValue, push } from "./firebase.js";

let lobbyCode = null;
let playerName = null;
let role = null;
let countdownInterval = null;

// Elements
const homeSection = document.getElementById("home");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");
const buzzSound = document.getElementById("buzzSound");
const resetSound = document.getElementById("resetSound");

function showSection(section) {
    [homeSection, lobbySection, gameSection].forEach(s => s.hidden = true);
    section.hidden = false;
}

function generateLobbyCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// --- CREATE LOBBY ---
document.getElementById("createLobbyBtn").addEventListener("click", () => {
    playerName = document.getElementById("hostName").value || "Hôte";
    lobbyCode = generateLobbyCode();
    role = "host";

    set(ref(db, 'rooms/' + lobbyCode), {
        host: playerName,
        status: "waiting",
        winner: null,
        buzzerLocked: true,
        blocked: []
    }).then(() => {
        document.getElementById("lobbyCode").textContent = lobbyCode;
        setupGameListeners();
        showSection(lobbySection);
        updateUIByRole();
        generateQRCode(lobbyCode);
    });
});

// --- JOIN LOBBY ---
document.getElementById("joinLobbyBtn").addEventListener("click", () => {
    playerName = document.getElementById("playerName").value || "Joueur";
    lobbyCode = document.getElementById("lobbyCodeInput").value.toUpperCase();
    role = "player";

    const playerListRef = ref(db, `rooms/${lobbyCode}/players`);

    push(playerListRef, { name: playerName }).then(() => {
        document.getElementById("lobbyCode").textContent = lobbyCode;
        setupGameListeners();
        showSection(lobbySection);
        updateUIByRole();
    }).catch((error) => {
        alert("Code de lobby invalide !");
    });
});

// --- GM CONTROLS ---
document.getElementById("startGameBtn").addEventListener("click", () => {
    update(ref(db, 'rooms/' + lobbyCode), {
        status: "playing",
        buzzerLocked: false
    });
});

document.getElementById("validateBtn").addEventListener("click", () => {
    update(ref(db, 'rooms/' + lobbyCode), {
        winner: null,
        buzzerLocked: false,
        timerActive: false,
        blocked: [] // Full reset
    });
});

document.getElementById("wrongBtn").addEventListener("click", () => {
    const roomRef = ref(db, 'rooms/' + lobbyCode);
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data.winner) return;

        let currentBlocks = data.blocked || [];
        if (!currentBlocks.includes(data.winner)) {
            currentBlocks.push(data.winner);
        }

        update(roomRef, {
            winner: null,
            buzzerLocked: false,
            timerActive: false,
            blocked: currentBlocks
        });
    }, { onlyOnce: true });
});

document.getElementById("resetBuzzBtn").addEventListener("click", () => {
    update(ref(db, 'rooms/' + lobbyCode), {
        winner: null,
        buzzerLocked: false,
        blocked: []
    });
});

// This ensures the setting is saved to Firebase the moment the Host changes the dropdown
document.getElementById("timerSetting").addEventListener("change", (e) => {
    if (role === "host") {
        update(ref(db, 'rooms/' + lobbyCode), {
            timeLimit: parseInt(e.target.value)
        });
    }
});

// --- PLAYER ACTION ---
document.getElementById("buzzBtn").addEventListener("click", () => {
    // Get the current room data to see what timer setting the host chose
    const roomRef = ref(db, 'rooms/' + lobbyCode);

    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        // Use the duration set in Firebase, or default to 10 if not found
        const duration = data.timeLimit || 10;

        update(roomRef, {
            winner: playerName,
            buzzerLocked: true,
            timerActive: true,
            timeLimit: parseInt(duration)
        });
    }, { onlyOnce: true });
});

function updateUIByRole() {
    const isHost = (role === "host");
    document.getElementById("startGameBtn").hidden = !isHost;
    document.getElementById("hostView").hidden = !isHost;
    document.getElementById("playerView").hidden = isHost;
}

// --- THE MAIN LISTENER ---
function setupGameListeners() {
    const roomRef = ref(db, 'rooms/' + lobbyCode);

    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // 1. UPDATE PLAYER LIST (Fix for your issue)
        const listElement = document.getElementById("playersList");
        if (listElement && data.players) {
            listElement.innerHTML = "";
            Object.values(data.players).forEach(p => {
                const li = document.createElement("li");
                li.textContent = "👤 " + p.name;
                listElement.appendChild(li);
            });
        }

        // 2. STATUS CHECK
        if (data.status === "playing" && gameSection.hidden) {
            showSection(gameSection);
            updateUIByRole();
        }

        const buzzBtn = document.getElementById("buzzBtn");
        const gmWinnerName = document.getElementById("activeWinnerName");
        const statusText = document.getElementById("gameStatusText");
        const blockedList = data.blocked || [];
        const isBlocked = blockedList.includes(playerName);

        // 3. WINNER LOGIC
        if (data.winner) {
            if (gmWinnerName) gmWinnerName.textContent = data.winner;
            if (statusText) statusText.textContent = "Réponse en cours...";

            document.body.className = (data.winner === playerName) ? "winner-green" : "loser-red";
            if (buzzBtn) buzzBtn.disabled = true;

            if (data.timerActive) startLocalTimer(data.timeLimit);
        } else {
            if (gmWinnerName) gmWinnerName.textContent = "---";
            if (statusText) statusText.textContent = "En attente...";
            document.body.className = "";

            if (buzzBtn) {
                buzzBtn.disabled = data.buzzerLocked || isBlocked;
                buzzBtn.textContent = isBlocked ? "BLOQUÉ" : "BUZZ !";
                buzzBtn.style.opacity = isBlocked ? "0.4" : "1";
            }
            clearInterval(countdownInterval);
            document.getElementById("timerContainer").hidden = true;
        }
    });
}

function startLocalTimer(seconds) {
    clearInterval(countdownInterval);
    const progressBar = document.getElementById("progressBar");
    const container = document.getElementById("timerContainer");
    container.hidden = false;

    let timeLeft = seconds * 10;
    const totalTime = seconds * 10;

    countdownInterval = setInterval(() => {
        timeLeft--;
        const percentage = (timeLeft / totalTime) * 100;
        progressBar.style.width = percentage + "%";

        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            if (role === "host") document.getElementById("wrongBtn").click();
        }
    }, 100);
}

function generateQRCode(code) {
    const url = window.location.origin + window.location.pathname + "?room=" + code;
    new QRious({ element: document.getElementById("qrCode"), value: url, size: 150 });
}