import { db, ref, set, update, onValue, push } from "./firebase.js";

let lobbyCode = null;
let playerName = null;
let role = null; // "host" or "player"

// Elements
const homeSection = document.getElementById("home");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");
const buzzSound = document.getElementById("buzzSound");
const resetSound = document.getElementById("resetSound");

// --- UTILS ---
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
        buzzerLocked: true
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

    // Add self to the players list in Firebase
    const playerListRef = ref(db, `rooms/${lobbyCode}/players`);
    push(playerListRef, { name: playerName });

    document.getElementById("lobbyCode").textContent = lobbyCode;
    setupGameListeners();
    showSection(lobbySection);
    updateUIByRole();
});

// --- GAME LOGIC ---
function updateUIByRole() {
    document.getElementById("startGameBtn").hidden = (role !== "host");
    document.getElementById("hostView").hidden = (role !== "host");
    document.getElementById("playerView").hidden = false; // Everyone sees buzzer, but host uses it to test
}

document.getElementById("startGameBtn").addEventListener("click", () => {
    update(ref(db, 'rooms/' + lobbyCode), {
        status: "playing",
        buzzerLocked: false
    });
});

document.getElementById("buzzBtn").addEventListener("click", () => {
    // 1. Vibrate (if mobile supports it)
    if ("vibrate" in navigator) {
        navigator.vibrate(200);
    }

    // 2. Play sound locally for instant feedback
    const buzzSound = document.getElementById("buzzSound");
    buzzSound.play();

    // 3. Update Firebase
    const roomRef = ref(db, 'rooms/' + lobbyCode);
    update(roomRef, {
        winner: playerName,
        buzzerLocked: true
    });
});

document.getElementById("resetBuzzBtn").addEventListener("click", () => {
    update(ref(db, 'rooms/' + lobbyCode), {
        winner: null,
        buzzerLocked: false
    });
});

function setupGameListeners() {
    const roomRef = ref(db, 'rooms/' + lobbyCode);

    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // 1. Handle Status
        if (data.status === "playing") showSection(gameSection);

        // 2. Handle Winner & Sounds
        const winnerDisplay = document.getElementById("winner");
        const buzzBtn = document.getElementById("buzzBtn");

        if (data.winner) {
            if (winnerDisplay.textContent === "Prêt...") buzzSound.play();
            winnerDisplay.textContent = "🏆 " + data.winner;
            buzzBtn.disabled = true;
        } else {
            if (winnerDisplay.textContent.includes("🏆")) resetSound.play();
            winnerDisplay.textContent = "Prêt...";
            buzzBtn.disabled = data.buzzerLocked;
        }

        // 3. Handle Player List
        const listElement = document.getElementById("playersList");
        listElement.innerHTML = "";
        if (data.players) {
            Object.values(data.players).forEach(p => {
                const li = document.createElement("li");
                li.textContent = p.name;
                listElement.appendChild(li);
            });
        }
    });
}

function generateQRCode(code) {
    const url = window.location.origin + window.location.pathname + "?room=" + code;
    new QRious({ element: document.getElementById("qrCode"), value: url, size: 150 });
}