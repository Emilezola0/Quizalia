// script-player.js
const socket = io("http://localhost:3000"); // URL à changer après déploiement

let myRoom = "";
let myTeam = "";

function joinGame() {
    myRoom = document.getElementById("roomCode").value.toUpperCase();
    myTeam = document.getElementById("teamName").value;

    if (myRoom && myTeam) {
        socket.emit("join_room", { room: myRoom, teamName: myTeam });
        document.getElementById("setup").style.display = "none";
        document.getElementById("game").style.display = "block";
        document.getElementById("displayTeam").innerText = "Équipe : " + myTeam;
    }
}

function sendBuzz() {
    socket.emit("player_buzz", { room: myRoom, teamName: myTeam });
}

// Réception des ordres du serveur
socket.on("unlock_client_buzzer", () => {
    const b = document.getElementById("buzzer");
    b.classList.remove("disabled");
    document.getElementById("status").innerText = "VITE ! BUZZEZ !";
});

socket.on("winner_is", (data) => {
    document.getElementById("buzzer").classList.add("disabled");
    document.getElementById("status").innerText = "L'équipe " + data.name + " a buzzé !";

    // Jouer le son si c'est nous qui avons gagné
    if (data.name === myTeam) {
        let audio = new Audio('buzz_sound.mp3');
        audio.play();
    }
});