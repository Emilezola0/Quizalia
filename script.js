// alert("script.js chargé !");

let lobbyCode = null;
let playerName = null;
let role = null; // "host" ou "player"


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
    playerName = document.getElementById("hostName").value || "Hôte";

    lobbyCode = generateLobbyCode();
    role = "host";

    document.getElementById("lobbyCode").textContent = lobbyCode;

    showSection(lobbySection);
    updateUIByRole();

    console.log("HOST créé :", lobbyCode);
});

joinLobbyBtn.addEventListener("click", () => {
    playerName = document.getElementById("playerName").value || "Joueur";
    lobbyCode = document.getElementById("lobbyCodeInput").value.toUpperCase();

    role = "player";

    document.getElementById("lobbyCode").textContent = lobbyCode;

    showSection(lobbySection);
    updateUIByRole();

    console.log("JOUEUR rejoint :", lobbyCode);
});

function updateUIByRole() {
    const hostView = document.getElementById("hostView");
    const playerView = document.getElementById("playerView");

    if (role === "host") {
        hostView.hidden = false;
        playerView.hidden = true;
    } else {
        hostView.hidden = true;
        playerView.hidden = false;
    }
}

