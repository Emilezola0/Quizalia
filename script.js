// 1. Import from your firebase.js file
import { db, ref, set, update, onValue } from "./firebase.js";

let lobbyCode = null;
let playerName = null;
let role = null;

// ... (Your showSection and generateLobbyCode functions remain the same)

// 🔹 CREATE LOBBY
createLobbyBtn.addEventListener("click", () => {
    playerName = document.getElementById("hostName").value || "Hôte";
    lobbyCode = generateLobbyCode();
    role = "host";

    // Initialize the room in Firebase
    const roomRef = ref(db, 'rooms/' + lobbyCode);
    set(roomRef, {
        host: playerName,
        status: "waiting",
        winner: null,
        buzzerLocked: true
    });

    document.getElementById("lobbyCode").textContent = lobbyCode;
    setupGameListeners();
    showSection(lobbySection);
    updateUIByRole();
});

// 🔹 JOIN LOBBY
joinLobbyBtn.addEventListener("click", () => {
    playerName = document.getElementById("playerName").value || "Joueur";
    lobbyCode = document.getElementById("lobbyCodeInput").value.toUpperCase();
    role = "player";

    document.getElementById("lobbyCode").textContent = lobbyCode;
    setupGameListeners();
    showSection(lobbySection);
    updateUIByRole();
});

// 🔹 BUZZER LOGIC
document.getElementById("buzzBtn").addEventListener("click", () => {
    const roomRef = ref(db, 'rooms/' + lobbyCode);

    // We only update if winner is currently null
    update(roomRef, {
        winner: playerName,
        buzzerLocked: true
    });
});

// 🔹 RESET BUTTON (For the Host)
document.getElementById("resetBuzzBtn").addEventListener("click", () => {
    const roomRef = ref(db, 'rooms/' + lobbyCode);
    update(roomRef, {
        winner: null,
        buzzerLocked: false
    });
});

function setupGameListeners() {
    if (!lobbyCode) return;
    const roomRef = ref(db, 'rooms/' + lobbyCode);

    const buzzSound = document.getElementById("buzzSound");
    const resetSound = document.getElementById("resetSound");

    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const winnerDisplay = document.getElementById("winner");
        const buzzBtn = document.getElementById("buzzBtn");

        // Check if a winner just appeared
        if (data.winner) {
            // If the display was "Waiting..." and now there's a winner, PLAY SOUND
            if (winnerDisplay.textContent === "Waiting..." || winnerDisplay.textContent === "Prêt...") {
                buzzSound.play();
                document.body.classList.add("flash-red");
                setTimeout(() => document.body.classList.remove("flash-red"), 500);
            }
            winnerDisplay.textContent = "🏆 " + data.winner + " a buzzé !";
            buzzBtn.disabled = true;
        } else {
            // If it was reset (winner became null), play a reset sound
            if (winnerDisplay.textContent.includes("🏆")) {
                resetSound.play();
            }
            winnerDisplay.textContent = "Prêt...";
            buzzBtn.disabled = data.buzzerLocked;
        }
    });
}