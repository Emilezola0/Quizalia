// alert("script.js chargé !");

const homeSection = document.getElementById("home");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");

const createLobbyBtn = document.getElementById("createLobbyBtn");
const joinLobbyBtn = document.getElementById("joinLobbyBtn");

const lobbyCodeSpan = document.getElementById("lobbyCode");

function showSection(section) {
    homeSection.hidden = true;
    lobbySection.hidden = true;
    gameSection.hidden = true;
    section.hidden = false;
}

// 🔹 Génère un faux code pour test
function generateLobbyCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

createLobbyBtn.addEventListener("click", () => {
    const code = generateLobbyCode();
    lobbyCodeSpan.textContent = code;
    showSection(lobbySection);
});

joinLobbyBtn.addEventListener("click", () => {
    const code = document.getElementById("lobbyCodeInput").value;
    lobbyCodeSpan.textContent = code || "????";
    showSection(lobbySection);
});
