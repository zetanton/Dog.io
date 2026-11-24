import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { RoomManager } from './RoomManager.js';
import { GameStateManager } from './GameStateManager.js';
import { PlayerManager } from './PlayerManager.js';
import { Vector3 } from 'three';

const app = express();
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST'],
  credentials: true
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Allow all origins
    methods: ['GET', 'POST'],
    credentials: true
  },
  // Add secure connection settings
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Add health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const roomManager = new RoomManager();
const gameStateManager = new GameStateManager(io);
const playerManager = new PlayerManager();

const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;
let sequenceNumber = 0;

// Improved error handling middleware
const handleSocketError = (socket: any, error: Error) => {
  console.error('Socket error:', error);
  socket.emit('error', { message: error.message });
};

io.on('connection', (socket) => {
  console.log('[Server] Client connected:', socket.id);

  // Handle room management
  socket.on('getRooms', () => {
    try {
      const publicRooms = roomManager.getPublicRooms();
      socket.emit('roomList', publicRooms);
    } catch (error) {
      handleSocketError(socket, error as Error);
    }
  });

  socket.on('createRoom', ({ isPublic, playerName }) => {
    try {
      const roomCode = roomManager.createRoom(isPublic);
      const success = roomManager.joinRoom(roomCode, socket.id, playerName);
      
      if (success) {
        socket.join(roomCode);
        const players = roomManager.getPlayersInRoom(roomCode);
        socket.emit('roomJoined', { code: roomCode, players: players.map(p => p.name) });
        io.emit('roomList', roomManager.getPublicRooms());
      } else {
        socket.emit('roomError', 'Failed to create room');
      }
    } catch (error) {
      handleSocketError(socket, error as Error);
    }
  });

  socket.on('joinRoom', ({ code, playerName }, callback) => {
    try {
      const room = roomManager.getRoom(code);
      if (room && room.players.size < 10) {
        const success = roomManager.joinRoom(code, socket.id, playerName);
        if (success) {
          socket.join(code);
          const players = roomManager.getPlayersInRoom(code);
          io.to(code).emit('roomJoined', { code, players: players.map(p => p.name) });
          gameStateManager.initializePlayer(code, socket.id, playerName, 0);
          io.emit('roomList', roomManager.getPublicRooms());
          callback({ success: true });
        } else {
          callback({ success: false, error: 'Failed to join room' });
        }
      } else {
        callback({ success: false, error: 'Room is full or does not exist' });
      }
    } catch (error) {
      handleSocketError(socket, error as Error);
      callback({ success: false, error: 'Internal server error' });
    }
  });

  // Handle player updates with validation
  socket.on('playerUpdate', (data: any) => {
    try {
      const roomCode = roomManager.getRoomByPlayerId(socket.id);
      if (!roomCode) {
        console.warn(`[Server] Player ${socket.id} not in a room, ignoring update`);
        return;
      }

      const room = roomManager.getRoom(roomCode);
      if (!room || !room.inGame) {
        console.warn(`[Server] Room ${roomCode} not active, ignoring update from ${socket.id}`);
        return;
      }

      console.log(`[Server] Received player update:
        - Player: ${socket.id}
        - Room: ${roomCode}
        - Position: ${data.position ? `(${data.position.x.toFixed(2)}, ${data.position.z.toFixed(2)})` : 'unchanged'}
        - Actions: ${JSON.stringify(data.actions)}
      `);

      // Update player state on server
      gameStateManager.handlePlayerUpdate(roomCode, socket.id, {
        position: new Vector3(data.x, data.y, data.z),
        rotation: data.rotation,
        actions: data.actions
      });
      
      // Broadcast player update to all other players in room
      socket.to(roomCode).emit('playerStateUpdate', {
        id: socket.id,
        ...data,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[Server] Error handling player update:', error);
    }
  });

  // Game state synchronization
  socket.on('clockSync', (data: { clientTime: number }, callback) => {
    const response = { serverTime: Date.now() };
    if (typeof callback === 'function') {
      callback(response);
    } else {
      socket.emit('clockSync', response);
    }
  });

  // Request game state
  socket.on('requestState', (data: { lastSequenceNumber: number }, callback) => {
    try {
      const roomCode = roomManager.getRoomByPlayerId(socket.id);
      if (!roomCode) {
        if (typeof callback === 'function') {
          callback({ error: 'Player not in a room' });
        }
        return;
      }

      const gameState = gameStateManager.getGameState(roomCode);
      if (gameState) {
        const stateWithSequence = {
          ...gameState,
          sequenceNumber: ++sequenceNumber,
          timestamp: Date.now()
        };
        
        if (typeof callback === 'function') {
          callback(stateWithSequence);
        } else {
          socket.emit('gameState', stateWithSequence);
        }
      }
    } catch (error) {
      handleSocketError(socket, error as Error);
    }
  });

  // Handle bone collection
  socket.on('collectBone', (data: { boneId: string }) => {
    try {
      const roomCode = roomManager.getRoomByPlayerId(socket.id);
      if (!roomCode) {
        console.warn(`[Server] Player ${socket.id} not in a room, ignoring bone collection`);
        return;
      }

      const room = roomManager.getRoom(roomCode);
      if (!room || !room.inGame) {
        console.warn(`[Server] Room ${roomCode} not active, ignoring bone collection from ${socket.id}`);
        return;
      }

      console.log(`[Server] Bone collection:
        - Player: ${socket.id}
        - Room: ${roomCode}
        - Bone: ${data.boneId}
      `);

      // Update bone state on server
      gameStateManager.updateBoneInRoom(roomCode, data.boneId, true);
      
      // Broadcast bone collection to all players in room
      io.to(roomCode).emit('boneCollected', {
        boneId: data.boneId,
        playerId: socket.id,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[Server] Error handling bone collection:', error);
    }
  });

  // Handle player ready status
  socket.on('playerReady', (data: { isReady: boolean }) => {
    try {
      const roomCode = roomManager.getRoomByPlayerId(socket.id);
      if (!roomCode) {
        console.warn(`[Server] Player ${socket.id} not in a room, ignoring ready status`);
        return;
      }

      console.log(`[Server] Player ready status:
        - Player: ${socket.id}
        - Room: ${roomCode}
        - Ready: ${data.isReady}
      `);

      roomManager.setPlayerReady(roomCode, socket.id, data.isReady);
      const players = roomManager.getPlayersInRoom(roomCode);
      const readyPlayers = players.filter(p => roomManager.isPlayerReady(roomCode, p.id));
      
      // Get player name for the ready update
      const playerName = players.find(p => p.id === socket.id)?.name || socket.id;
      
      // Broadcast ready status update to all players in room
      io.to(roomCode).emit('playerReadyUpdate', {
        playerId: socket.id,
        playerName: playerName,
        isReady: data.isReady,
        readyPlayers: readyPlayers.map(p => p.id)
      });

      // Log ready status of all players
      console.log(`[Server] Room ${roomCode} ready status:
        - Total players: ${players.length}
        - Ready players: ${readyPlayers.length}
        - Ready player names: ${readyPlayers.map(p => p.name).join(', ')}
      `);
    } catch (error) {
      console.error('[Server] Error handling player ready status:', error);
    }
  });

  // Handle game start
  socket.on('startGame', (callback) => {
    try {
      const roomCode = roomManager.getRoomByPlayerId(socket.id);
      if (!roomCode) {
        if (typeof callback === 'function') {
          callback({ error: 'Player not in a room' });
        }
        return;
      }

      const room = roomManager.getRoom(roomCode);
      if (!room) {
        if (typeof callback === 'function') {
          callback({ error: 'Room not found' });
        }
        return;
      }

      // Only allow host to start the game
      const [hostId] = room.players.keys();
      if (socket.id !== hostId) {
        if (typeof callback === 'function') {
          callback({ error: 'Only the host can start the game' });
        }
        return;
      }

      // Check if all non-host players are ready
      if (!roomManager.areAllPlayersReady(roomCode)) {
        if (typeof callback === 'function') {
          callback({ error: 'Not all players are ready' });
        }
        return;
      }

      roomManager.markRoomInGame(roomCode);
      
      // Initialize game state for the room
      const initialState = gameStateManager.getGameState(roomCode);
      if (initialState) {
        const stateWithSequence = {
          ...initialState,
          sequenceNumber: ++sequenceNumber,
          timestamp: Date.now()
        };
        
        console.log(`[Server] Starting game in room ${roomCode}:
          - Players: ${Object.keys(stateWithSequence.players).length}
          - AI Dogs: ${stateWithSequence.aiDogs.length}
          - Initial bones: ${stateWithSequence.bones.length}
          - Sequence: ${stateWithSequence.sequenceNumber}
        `);
        
        // Broadcast initial game state and start signal
        io.to(roomCode).emit('gameState', stateWithSequence);
        io.to(roomCode).emit('gameStart');
      }

      if (typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (error) {
      handleSocketError(socket, error as Error);
    }
  });

  socket.on('disconnect', () => {
    try {
      console.log('[Server] Client disconnected:', socket.id);
      const roomCode = roomManager.getRoomByPlayerId(socket.id);
      if (roomCode) {
        roomManager.leaveRoom(roomCode, socket.id);
        
        // Broadcast player left to room
        io.to(roomCode).emit('playerLeft', {
          playerId: socket.id,
          timestamp: Date.now()
        });
        
        const room = roomManager.getRoom(roomCode);
        if (!room || room.players.size === 0) {
          console.log(`[Server] Cleaning up empty room ${roomCode}`);
          roomManager.cleanupRoom(roomCode);
          io.emit('roomList', roomManager.getPublicRooms());
        }
      }
    } catch (error) {
      console.error('[Server] Error handling disconnect:', error);
    }
  });
});

// Game state update loop
setInterval(() => {
  const currentTime = Date.now();

  // Update each active room
  for (const roomCode of roomManager.getAllRooms()) {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.inGame) continue;

    try {
      // Update AI dogs
      gameStateManager.updateAIDogs(roomCode, TICK_INTERVAL / 1000);
      
      // Get complete game state
      const gameState = gameStateManager.getGameState(roomCode);
      if (gameState) {
        // Add sequence number and timestamp
        const stateWithSequence = {
          ...gameState,
          sequenceNumber: ++sequenceNumber,
          timestamp: currentTime
        };

        console.log(`[Server] Broadcasting state to room ${roomCode}:
          - Sequence: ${stateWithSequence.sequenceNumber}
          - Players: ${Object.keys(stateWithSequence.players).length}
          - AI Dogs: ${stateWithSequence.aiDogs.length}
          - Active bones: ${stateWithSequence.bones.filter(b => !b.collected).length}
          - Timestamp: ${stateWithSequence.timestamp}
        `);

        // Broadcast complete state to all players in room
        io.to(roomCode).emit('gameState', stateWithSequence);
      }
    } catch (error) {
      console.error(`[Server] Error updating game state for room ${roomCode}:`, error);
    }
  }
}, TICK_INTERVAL);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 