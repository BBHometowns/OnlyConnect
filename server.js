 const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static('public'));

// Store active game sessions
const gameSessions = new Map();

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Create new game session
    socket.on('createGame', (gameCode) => {
        if (gameSessions.has(gameCode)) {
            socket.emit('gameCodeExists');
            return;
        }

        // Create new session with host
        gameSessions.set(gameCode, {
            host: socket.id,
            players: [],
            gameState: {
                score: 0,
                view: 'rounds',
                currentRound: null,
                currentQuestion: null,
                cluesRevealed: 0,
                answerRevealed: false,
                completedQuestions: [],
                timerStartTime: null,
                timerStopped: false,
                timerElapsedWhenStopped: 0,
                // Round 3 state
                wallTiles: [],
                selectedTiles: [],
                solvedGroups: [],
                wallLives: 3,
                wallPhase: 'solving',
                connectionGuesses: [],
                wallTimerReady: false,
                showTimeUpModal: false,
                showWallFrozenModal: false,
                // Round 4 state
                vowelsCurrentCategory: 0,
                vowelsCurrentClue: 0,
                vowelsCategoryRevealed: false,
                vowelsCategoryAnimating: false,
                vowelsClueRevealed: false,
                vowelsAnswerRevealed: false,
                vowelsShowTimeUpModal: false
            }
        });

        socket.join(gameCode);
        socket.gameCode = gameCode;
        socket.role = 'host';

        socket.emit('gameCreated', { gameCode, role: 'host' });
        console.log(`Game ${gameCode} created by ${socket.id}`);
    });

    // Join existing game session
    socket.on('joinGame', ({ gameCode, playerName }) => {
        const session = gameSessions.get(gameCode);
        
        if (!session) {
            socket.emit('gameNotFound');
            return;
        }

        // Add player to session
        const playerNumber = session.players.length + 1;
        const playerData = {
            id: socket.id,
            name: playerName,
            number: playerNumber,
            role: `Player ${playerNumber}`
        };

        session.players.push(playerData);
        socket.join(gameCode);
        socket.gameCode = gameCode;
        socket.role = `player${playerNumber}`;
        socket.playerName = playerName;

        // Send role info to player
        socket.emit('gameJoined', { 
            gameCode, 
            role: socket.role,
            playerNumber,
            playerName
        });

        // Notify host and all players of updated player list
        io.to(gameCode).emit('playersUpdated', {
            players: session.players
        });

        // Send current game state to new player
        socket.emit('syncGameState', session.gameState);

        console.log(`Player ${playerName} (${socket.id}) joined game ${gameCode} as Player ${playerNumber}`);
    });

    socket.on('joinAsSecondaryHost', ({ gameCode }) => {
        const session = gameSessions.get(gameCode);
        
        if (!session) {
            socket.emit('gameNotFound');
            return;
        }

        // Join as secondary host (read-only)
        socket.join(gameCode);
        socket.gameCode = gameCode;
        socket.role = 'secondaryHost';

        // Send role info to secondary host
        socket.emit('secondaryHostJoined', { 
            gameCode, 
            role: 'secondaryHost'
        });

        // Send current game state to secondary host
        socket.emit('syncGameState', session.gameState);

        console.log(`Secondary host (${socket.id}) joined game ${gameCode}`);
    });

    // Player buzzes in
    socket.on('buzzIn', () => {
        const session = gameSessions.get(socket.gameCode);
        if (!session || socket.role === 'host') return;

        // Broadcast buzz to all clients in the game
        io.to(socket.gameCode).emit('playerBuzzed', {
            playerName: socket.playerName,
            playerId: socket.id
        });
    });

    // Host actions - only host can trigger these
    socket.on('hostAction', (action) => {
        const session = gameSessions.get(socket.gameCode);
        if (!session || socket.role !== 'host') return;

        // Broadcast action to all clients
        io.to(socket.gameCode).emit('gameAction', action);
    });

    // Sync game state from host
    socket.on('syncState', (gameState) => {
        const session = gameSessions.get(socket.gameCode);
        if (!session || socket.role !== 'host') return;

        // Update stored game state
        session.gameState = gameState;

        // Broadcast to all players (except sender)
        socket.to(socket.gameCode).emit('syncGameState', gameState);
    });

    // Player action for Round 3 (wall)
    socket.on('playerWallAction', (action) => {
        const session = gameSessions.get(socket.gameCode);
        if (!session || socket.role === 'host') return;

        // Broadcast player's wall action to host
        io.to(socket.gameCode).emit('wallAction', {
            playerId: socket.id,
            playerName: socket.playerName,
            action: action
        });
    });
    
    // Player clicked a tile
    socket.on('playerClickedTile', (data) => {
        const session = gameSessions.get(socket.gameCode);
        if (!session || socket.role === 'host') return;

        console.log('Server forwarding playerClickedTile from', socket.playerName, ':', data);

        // Send to all clients in the room (including the player who clicked)
        io.to(socket.gameCode).emit('playerClickedTile', data);
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        if (socket.gameCode) {
            const session = gameSessions.get(socket.gameCode);
            
            if (session) {
                // If host disconnects, notify players and potentially end session
                if (socket.role === 'host') {
                    io.to(socket.gameCode).emit('hostDisconnected');
                    gameSessions.delete(socket.gameCode);
                    console.log(`Game ${socket.gameCode} ended - host disconnected`);
                } else {
                    // Remove player from session
                    session.players = session.players.filter(p => p.id !== socket.id);
                    
                    // Notify remaining players
                    io.to(socket.gameCode).emit('playersUpdated', {
                        players: session.players
                    });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
