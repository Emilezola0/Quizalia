// ===== Sélections des sections =====
const homeSection = document.getElementById("home");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");

// ===== Boutons =====
const createLobbyBtn = document.getElementById("createLobbyBtn");
const joinLobbyBtn = document.getElementById("joinLobbyBtn");

// ===== Fonction utilitaire =====
function showSection(section) {
    homeSection.hidden = true;
    lobbySection.hidden = true;
    gameSection.hidden = true;

    section.hidden = false;
}

// ===== Événements (temporaire, sans Firebase) =====
createLobbyBtn.addEventListener("click", () => {
    showSection(lobbySection);
});

joinLobbyBtn.addEventListener("click", () => {
    showSection(lobbySection);
});
