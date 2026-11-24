import { v4 as uuidv4 } from 'uuid';

interface Room {
  code: string;
  players: Map<string, string>; // socketId -> playerName
  createdAt: number;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRooms: Map<string, string> = new Map(); // socketId -> roomCode

  createRoom(): string {
    const roomCode = this.generateRoomCode();
    this.rooms.set(roomCode, {
      code: roomCode,
      players: new Map(),
      createdAt: Date.now()
    });
    return roomCode;
  }

  joinRoom(roomCode: string, socketId: string, playerName: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    if (room.players.size >= 4) return false; // Max 4 human players per room

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

  private generateRoomCode(): string {
    // Generate a 6-character alphanumeric code
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
} 