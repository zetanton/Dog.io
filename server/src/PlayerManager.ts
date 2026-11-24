interface Player {
  id: string;
  name: string;
  roomCode: string;
  lastSeen: number;
}

export class PlayerManager {
  private players: Map<string, Player> = new Map();
  private readonly PLAYER_TIMEOUT = 10000; // 10 seconds

  addPlayer(socketId: string, name: string, roomCode: string): void {
    this.players.set(socketId, {
      id: socketId,
      name,
      roomCode,
      lastSeen: Date.now()
    });
  }

  removePlayer(socketId: string): void {
    this.players.delete(socketId);
  }

  updatePlayerLastSeen(socketId: string): void {
    const player = this.players.get(socketId);
    if (player) {
      player.lastSeen = Date.now();
    }
  }

  getPlayersInRoom(roomCode: string): { id: string; name: string; }[] {
    return Array.from(this.players.values())
      .filter(player => player.roomCode === roomCode)
      .map(({ id, name }) => ({ id, name }));
  }

  cleanupInactivePlayers(): void {
    const now = Date.now();
    for (const [socketId, player] of this.players.entries()) {
      if (now - player.lastSeen > this.PLAYER_TIMEOUT) {
        this.players.delete(socketId);
      }
    }
  }

  isPlayerActive(socketId: string): boolean {
    const player = this.players.get(socketId);
    if (!player) return false;
    return Date.now() - player.lastSeen <= this.PLAYER_TIMEOUT;
  }

  getPlayerRoom(socketId: string): string | undefined {
    return this.players.get(socketId)?.roomCode;
  }

  getPlayerCount(roomCode: string): number {
    return Array.from(this.players.values()).filter(p => p.roomCode === roomCode).length;
  }
} 