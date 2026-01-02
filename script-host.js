// script-host.js
const socket = io("http://localhost:3000");

// Générer un code aléatoire de 4 lettres
const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
document.getElementById("code").innerText = roomCode;

// Rejoindre son propre salon en tant que Host
socket.emit("join_room", { room: roomCode, teamName: "HOST" });

// Générer le QR Code (Lien vers ton index.html sur GitHub)
const urlGame = `https://TON_PSEUDO_GITHUB.github.io/TON_DEPOT/?room=${roomCode}`;
new QRCode(document.getElementById("qrcode"), urlGame);

function drawQuestion() {
    // Ici on déverrouille les buzzers
    socket.emit("unlock_buzzers", roomCode);
    document.getElementById("winner-display").innerText = "Attente d'un buzz...";
    document.getElementById("btn-validate").style.display = "none";
}

socket.on("winner_is", (data) => {
    document.getElementById("winner-display").innerText = "🏆 " + data.name;
    document.getElementById("btn-validate").style.display = "inline-block";
    // Son pour le host
    new Audio('winner_notif.mp3').play();
});

function resetBuzzers() {
    socket.emit("reset_game", roomCode);
    document.getElementById("winner-display").innerText = "Buzzers bloqués";
}