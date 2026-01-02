// server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

let buzzerLocked = true;
let currentWinner = null;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', (data) => {
        socket.join(data.room);
        console.log(`Team ${data.teamName} joined room ${data.room}`);
    });

    socket.on('unlock_buzzers', (room) => {
        buzzerLocked = false;
        currentWinner = null;
        io.to(room).emit('unlock_client_buzzer');
    });

    socket.on('player_buzz', (data) => {
        if (!buzzerLocked && currentWinner === null) {
            currentWinner = data.teamName;
            buzzerLocked = true;
            io.to(data.room).emit('winner_is', { name: data.teamName });
        }
    });

    socket.on('reset_game', (room) => {
        buzzerLocked = true;
        currentWinner = null;
        io.to(room).emit('game_reset');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});