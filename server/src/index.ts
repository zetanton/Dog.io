import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { RoomManager } from './RoomManager.js';
import { GameStateManager } from './GameStateManager.js';
import { PlayerManager } from './PlayerManager.js';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const roomManager = new RoomManager();
const gameStateManager = new GameStateManager();
const playerManager = new PlayerManager();

const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createRoom', () => {
    const roomCode = roomManager.createRoom();
    socket.emit('roomCreated', roomCode);
  });

  socket.on('joinRoom', (roomCode: string, playerName: string, colorIndex: number) => {
    const success = roomManager.joinRoom(roomCode, socket.id, playerName);
    if (success) {
      socket.join(roomCode);
      socket.emit('joinedRoom', roomCode);
      gameStateManager.initializePlayer(roomCode, socket.id, playerName, colorIndex);
      io.to(roomCode).emit('playerJoined', playerManager.getPlayersInRoom(roomCode));
    } else {
      socket.emit('error', 'Failed to join room');
    }
  });

  socket.on('playerUpdate', (update: any) => {
    gameStateManager.handlePlayerUpdate(socket.id, update);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const roomCode = roomManager.getRoomByPlayerId(socket.id);
    if (roomCode) {
      roomManager.leaveRoom(roomCode, socket.id);
      io.to(roomCode).emit('playerLeft', socket.id);
      if (roomManager.isRoomEmpty(roomCode)) {
        roomManager.cleanupRoom(roomCode);
      }
    }
  });
});

// Game state broadcast loop
setInterval(() => {
  for (const roomCode of roomManager.getAllRooms()) {
    const gameState = gameStateManager.getGameState(roomCode);
    io.to(roomCode).emit('gameState', gameState);
  }
}, TICK_INTERVAL);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 