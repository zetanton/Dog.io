import { v4 as uuidv4 } from 'uuid';

interface Room {
  code: string;
  players: Map<string, string>; // socketId -> playerName
  createdAt: number;
  isPublic: boolean;
  readyPlayers: Set<string>; // socketIds of ready players
  inGame: boolean;  // Add this to track if room is in active game
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRooms: Map<string, string> = new Map(); // socketId -> roomCode
  private readonly ROOM_TIMEOUT = 1000 * 60 * 30; // 30 minutes

  constructor() {
    // Start periodic cleanup
    setInterval(() => this.cleanupInactiveRooms(), 1000 * 60 * 5); // Check every 5 minutes
  }

  private cleanupInactiveRooms(): void {
    const now = Date.now();
    for (const [roomCode, room] of this.rooms.entries()) {
      // Clean up rooms that are:
      // 1. Empty
      // 2. Inactive for too long
      // 3. In game (they should be managed by GameStateManager)
      if (room.players.size === 0 || 
          (now - room.createdAt > this.ROOM_TIMEOUT) ||
          room.inGame) {
        this.cleanupRoom(roomCode);
      }
    }
  }

  markRoomInGame(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (room) {
      room.inGame = true;
    }
  }

  createRoom(isPublic: boolean): string {
    const roomCode = this.generateRoomCode();
    this.rooms.set(roomCode, {
      code: roomCode,
      players: new Map(),
      createdAt: Date.now(),
      isPublic,
      readyPlayers: new Set(),
      inGame: false
    });
    return roomCode;
  }

  joinRoom(roomCode: string, socketId: string, playerName: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    if (room.players.size >= 10) return false; // Max 10 human players per room

    room.players.set(socketId, playerName);
    this.playerRooms.set(socketId, roomCode);
    return true;
  }

  leaveRoom(roomCode: string, socketId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.players.delete(socketId);
    this.playerRooms.delete(socketId);
  }

  cleanupRoom(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    // Clean up all player associations
    room.players.forEach((_, socketId) => {
      this.playerRooms.delete(socketId);
    });

    this.rooms.delete(roomCode);
  }

  getRoomByPlayerId(socketId: string): string | undefined {
    return this.playerRooms.get(socketId);
  }

  getPlayersInRoom(roomCode: string): { id: string, name: string }[] {
    const room = this.rooms.get(roomCode);
    if (!room) return [];

    return Array.from(room.players.entries()).map(([id, name]) => ({ id, name }));
  }

  isRoomEmpty(roomCode: string): boolean {
    const room = this.rooms.get(roomCode);
    return !room || room.players.size === 0;
  }

  getAllRooms(): string[] {
    return Array.from(this.rooms.keys());
  }

  getPublicRooms(): Array<{ code: string; playerCount: number; isPublic: boolean }> {
    return Array.from(this.rooms.entries())
      .filter(([_, room]) => room.isPublic && !room.inGame) // Only show public rooms not in game
      .map(([code, room]) => ({
        code,
        playerCount: room.players.size,
        isPublic: room.isPublic
      }));
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode);
  }

  setPlayerReady(roomCode: string, socketId: string, isReady: boolean): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    if (isReady) {
      room.readyPlayers.add(socketId);
    } else {
      room.readyPlayers.delete(socketId);
    }
  }

  isPlayerReady(roomCode: string, socketId: string): boolean {
    const room = this.rooms.get(roomCode);
    return room ? room.readyPlayers.has(socketId) : false;
  }

  areAllPlayersReady(roomCode: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    
    // Host doesn't need to be ready
    const [hostId] = room.players.keys();
    const nonHostPlayers = Array.from(room.players.keys()).filter(id => id !== hostId);
    
    // If there are no non-host players, return true
    if (nonHostPlayers.length === 0) return true;
    
    const allReady = nonHostPlayers.every(playerId => room.readyPlayers.has(playerId));
    console.log('Ready check:', {
      roomCode,
      nonHostPlayers,
      readyPlayers: Array.from(room.readyPlayers),
      allReady
    });
    
    return allReady;
  }

  private generateRoomCode(): string {
    // Generate a 6-character alphanumeric code
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
} 