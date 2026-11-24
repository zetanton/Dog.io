import { Vector3 } from 'three';

interface PlayerState {
  id: string;
  name: string;
  colorIndex: number;
  position: Vector3;
  rotation: number;
  size: number;
  bones: number;
  isAI: boolean;
  actions: {
    isMoving: boolean;
    isBiting: boolean;
    isMarking: boolean;
    hasZoomies: boolean;
  };
}

interface GameState {
  players: Map<string, PlayerState>;
  bones: Array<{
    id: string;
    position: Vector3;
    collected: boolean;
  }>;
  hydrants: {
    id: string;
    position: Vector3;
    owner: string;
    timestamp: number;
  }[];
  territories: {
    id: string;
    position: Vector3;
    radius: number;
    owner: string;
    timestamp: number;
  }[];
}

export class GameStateManager {
  private gameStates: Map<string, GameState> = new Map();

  initializePlayer(roomCode: string, socketId: string, playerName: string, colorIndex: number): void {
    let gameState = this.gameStates.get(roomCode);
    if (!gameState) {
      gameState = this.createInitialGameState();
      this.gameStates.set(roomCode, gameState);
    }

    const playerState: PlayerState = {
      id: socketId,
      name: playerName,
      colorIndex,
      position: new Vector3(0, 0.5, 0),
      rotation: 0,
      size: 1,
      bones: 0,
      isAI: false,
      actions: {
        isMoving: false,
        isBiting: false,
        isMarking: false,
        hasZoomies: false
      }
    };

    gameState.players.set(socketId, playerState);
    this.addAIPlayers(roomCode);
  }

  handlePlayerUpdate(socketId: string, update: Partial<PlayerState>): void {
    for (const [roomCode, gameState] of this.gameStates.entries()) {
      const player = gameState.players.get(socketId);
      if (player) {
        Object.assign(player, update);
        break;
      }
    }
  }

  getGameState(roomCode: string): GameState | undefined {
    return this.gameStates.get(roomCode);
  }

  private createInitialGameState(): GameState {
    return {
      players: new Map(),
      bones: this.generateInitialBones(),
      hydrants: [],
      territories: []
    };
  }

  private generateInitialBones(count: number = 50): Array<{ id: string; position: Vector3; collected: boolean; }> {
    const bones: Array<{ id: string; position: Vector3; collected: boolean; }> = [];
    const stageSize = 100;
    
    for (let i = 0; i < count; i++) {
      bones.push({
        id: `bone_${i}`,
        position: new Vector3(
          (Math.random() - 0.5) * stageSize,
          0.5,
          (Math.random() - 0.5) * stageSize
        ),
        collected: false
      });
    }
    
    return bones;
  }

  private addAIPlayers(roomCode: string): void {
    const gameState = this.gameStates.get(roomCode);
    if (!gameState) return;

    const humanPlayerCount = Array.from(gameState.players.values()).filter(p => !p.isAI).length;
    const aiCount = Math.max(0, 10 - humanPlayerCount); // Total players should be 10

    for (let i = 0; i < aiCount; i++) {
      const aiId = `ai_${i}_${roomCode}`;
      const aiState: PlayerState = {
        id: aiId,
        name: `AI Dog ${i + 1}`,
        colorIndex: Math.floor(Math.random() * 8), // Assuming 8 colors available
        position: new Vector3(
          (Math.random() - 0.5) * 80,
          0.5,
          (Math.random() - 0.5) * 80
        ),
        rotation: Math.random() * Math.PI * 2,
        size: 1,
        bones: 0,
        isAI: true,
        actions: {
          isMoving: false,
          isBiting: false,
          isMarking: false,
          hasZoomies: false
        }
      };

      gameState.players.set(aiId, aiState);
    }
  }
} 