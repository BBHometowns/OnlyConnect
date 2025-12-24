const functions = require('firebase-functions');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');

// Serve static files from public directory
app.use(express.static('public'));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Game state storage
const games = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createGame', (gameCode) => {
        if (games.has(gameCode)) {
            socket.emit('gameCodeExists');
            return;
        }

        games.set(gameCode, {
            host: socket.id,
            secondaryHost: null,
            players: [],
            gameState: {}
        });

        socket.join(gameCode);
        socket.gameCode = gameCode;
        socket.emit('gameCreated', { gameCode, role: 'host' });
        console.log(`Game created: ${gameCode}`);
    });

    socket.on('joinGame', ({ gameCode, playerName }) => {
        const game = games.get(gameCode);

        if (!game) {
            socket.emit('gameNotFound');
            return;
        }

        const playerRole = `player${game.players.length + 1}`;
        game.players.push({ id: socket.id, name: playerName, role: playerRole });

        socket.join(gameCode);
        socket.gameCode = gameCode;
        socket.playerName = playerName;
        socket.emit('gameJoined', { gameCode, role: playerRole, playerName });

        io.to(gameCode).emit('playersUpdated', { players: game.players });

        if (game.gameState && Object.keys(game.gameState).length > 0) {
            socket.emit('syncGameState', game.gameState);
        }

        console.log(`${playerName} joined game: ${gameCode}`);
    });

    socket.on('joinAsSecondaryHost', ({ gameCode }) => {
        const game = games.get(gameCode);

        if (!game) {
            socket.emit('gameNotFound');
            return;
        }

        game.secondaryHost = socket.id;
        socket.join(gameCode);
        socket.gameCode = gameCode;
        socket.emit('secondaryHostJoined', { gameCode, role: 'secondaryHost' });

        if (game.gameState && Object.keys(game.gameState).length > 0) {
            socket.emit('syncGameState', game.gameState);
        }

        console.log(`Secondary host joined game: ${gameCode}`);
    });

    socket.on('syncState', (gameState) => {
        const game = games.get(socket.gameCode);
        if (game && socket.id === game.host) {
            game.gameState = gameState;
            socket.to(socket.gameCode).emit('syncGameState', gameState);
        }
    });

    socket.on('hostAction', ({ type, params }) => {
        const game = games.get(socket.gameCode);
        if (game && socket.id === game.host) {
            socket.to(socket.gameCode).emit('gameAction', { type, params });
        }
    });

    socket.on('buzzIn', () => {
        const game = games.get(socket.gameCode);
        if (game && socket.playerName) {
            io.to(socket.gameCode).emit('playerBuzzed', { playerName: socket.playerName });
        }
    });

    socket.on('playerClickedTile', ({ tileId }) => {
        const game = games.get(socket.gameCode);
        if (game) {
            io.to(game.host).emit('playerClickedTile', { tileId });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        if (socket.gameCode) {
            const game = games.get(socket.gameCode);
            if (game) {
                if (socket.id === game.host) {
                    io.to(socket.gameCode).emit('hostDisconnected');
                    games.delete(socket.gameCode);
                    console.log(`Game ${socket.gameCode} ended (host disconnected)`);
                } else {
                    game.players = game.players.filter(p => p.id !== socket.id);
                    io.to(socket.gameCode).emit('playersUpdated', { players: game.players });
                }
            }
        }
    });
});

// Export the Express app as a Firebase Function
exports.app = functions.https.onRequest(app);

// Attach Socket.IO to the function
const socketIoHandler = (req, res) => {
    if (!res.socket.server.io) {
        res.socket.server.io = io;
        io.attach(res.socket.server);
    }
    res.end();
};

exports.app = functions.https.onRequest((req, res) => {
    socketIoHandler(req, res);
    app(req, res);
});
