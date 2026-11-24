import { Vector3 } from 'three';
import { dogNames } from './data/dogNames';

interface Position {
  x: number;
  y: number;
  z: number;
}

interface StageObject {
  position: Vector3;
  scale: number;
  width: number;
  height: number;
  depth: number;
}

interface StageLayout {
  seed: number;
  trees: StageObject[];
  rocks: StageObject[];
  platforms: StageObject[];
  walls: StageObject[];
}

interface PlayerState {
  id: string;
  name: string;
  position: Vector3;
  rotation: number;
  colorIndex: number;
  size: number;
  bones: number;
  isAI: boolean;
  lastUpdate: number;
  actions: {
    isMoving: boolean;
    isBiting: boolean;
    isMarking: boolean;
    hasZoomies: boolean;
  };
}

interface GameState {
  sequenceNumber: number;
  timestamp: number;
  players: Map<string, PlayerState>;
  aiDogs: AIDog[];
  bones: Bone[];
  stageLayout: StageLayout;
  hydrants: any[];
  territories: any[];
  stageState: {
    bones: any[];
    activePowerUps: any[];
    stageBounds: any;
  };
}

interface AIDog {
  id: string;
  name: string;
  position: Vector3;
  rotation: number;
  colorIndex: number;
  size: number;
  isMoving: boolean;
  lastUpdate: number;
  targetPosition: Vector3 | null;
  currentState: string;
  update?: (deltaTime: number) => void;
}

interface Bone {
  id: string;
  position: Vector3;
  collected: boolean;
  lastUpdate: number;
}

interface SerializedGameState {
  sequenceNumber: number;
  timestamp: number;
  players: Record<string, PlayerState>;
  aiDogs: AIDog[];
  bones: Bone[];
  stageLayout: StageLayout;
  hydrants: any[];
  territories: any[];
  stageState: {
    bones: any[];
    stageBounds: any;
  };
}

export class GameStateManager {
  private io: any; // Socket.io instance
  private gameStates: Map<string, GameState>;
  private lastUpdateTimes: Map<string, number>;
  private readonly UPDATE_INTERVAL = 100; // ms between updates
  private readonly AI_SPEED = 5; // units per second
  private readonly AI_DETECTION_RADIUS = 10;
  private readonly STAGE_SIZE = 100;
  private readonly STAGE_BOUNDS = {
    min: new Vector3(-50, 0, -50),
    max: new Vector3(50, 0, 50)
  };
  private readonly WALL_HEIGHT = 10;
  private readonly WALL_THICKNESS = 1;

  constructor(io: any) {
    this.io = io;
    this.gameStates = new Map();
    this.lastUpdateTimes = new Map();
  }

  initializePlayer(roomCode: string, socketId: string, playerName: string, colorIndex: number): void {
    let gameState = this.gameStates.get(roomCode);
    
    // Create new game state if it doesn't exist
    if (!gameState) {
      gameState = this.createInitialGameState();
      this.gameStates.set(roomCode, gameState);
      this.lastUpdateTimes.set(roomCode, Date.now());
      console.log(`[GameStateManager] 🎮 Created new room ${roomCode}:
        - Seed: ${gameState.stageLayout.seed}
        - Trees: ${gameState.stageLayout.trees.length}
        - Rocks: ${gameState.stageLayout.rocks.length}
        - Platforms: ${gameState.stageLayout.platforms.length}
        - Initial bones: ${gameState.bones.length}
        - Stage bounds: ${JSON.stringify(this.STAGE_BOUNDS)}
        - Timestamp: ${Date.now()}`
      );
    }

    // Check if player already exists
    if (gameState.players.has(socketId)) {
      console.log(`[GameStateManager] 🔄 Player ${socketId} already exists in room ${roomCode}, updating state:
        - Name: ${playerName}
        - Color: ${colorIndex}
        - Current players: ${Array.from(gameState.players.entries()).map(([id, p]) => `${p.name}(${id})`).join(', ')}
        - Total players: ${gameState.players.size}
        - AI dogs: ${gameState.aiDogs?.length || 0}
        - Timestamp: ${Date.now()}`
      );
      const existingPlayer = gameState.players.get(socketId)!;
      existingPlayer.name = playerName;
      existingPlayer.colorIndex = colorIndex;
      existingPlayer.lastUpdate = Date.now();
    } else {
      // Create new player state with random starting position
      const startPosition = this.generateValidPosition();
      const playerState: PlayerState = {
        id: socketId,
        name: playerName,
        position: startPosition,
        rotation: Math.random() * Math.PI * 2,
        colorIndex: colorIndex,
        size: 1,
        bones: 0,
        isAI: false,
        actions: {
          isMoving: false,
          isBiting: false,
          isMarking: false,
          hasZoomies: false
        },
        lastUpdate: Date.now()
      };

      gameState.players.set(socketId, playerState);
      console.log(`[GameStateManager] 👤 Player joined room ${roomCode}:
        - ID: ${socketId}
        - Name: ${playerName}
        - Color: ${colorIndex}
        - Position: (${startPosition.x.toFixed(2)}, ${startPosition.y.toFixed(2)}, ${startPosition.z.toFixed(2)})
        - Current players: ${Array.from(gameState.players.entries()).map(([id, p]) => `${p.name}(${id})`).join(', ')}
        - Total players: ${gameState.players.size}
        - AI dogs: ${gameState.aiDogs?.length || 0}
        - Timestamp: ${Date.now()}`
      );
    }

    // Update AI dogs whenever player count changes
    this.updateAIDogCount(roomCode);
  }

  private updateAIDogCount(roomCode: string): void {
    const gameState = this.gameStates.get(roomCode);
    if (!gameState) return;

    // Count only human players
    const humanPlayerCount = Array.from(gameState.players.values())
      .filter(p => !p.isAI)
      .length;

    // Target is 10 total players (human + AI)
    const targetAICount = Math.max(0, 10 - humanPlayerCount);

    if (gameState.aiDogs.length !== targetAICount) {
      console.log(`[GameState] 🔄 Adjusting AI dog count in room ${roomCode}:
        - Current AI: ${gameState.aiDogs.length}
        - Target AI: ${targetAICount}
        - Human players: ${humanPlayerCount}
        - Total players: ${gameState.players.size}`
      );

      // Remove excess AI dogs
      while (gameState.aiDogs.length > targetAICount) {
        gameState.aiDogs.pop();
      }

      // Add new AI dogs with spread out positions
      while (gameState.aiDogs.length < targetAICount) {
        const existingNames = new Set(gameState.aiDogs.map(dog => dog.name));
        let name;
        do {
          name = dogNames[Math.floor(Math.random() * dogNames.length)];
        } while (existingNames.has(name));

        // Generate position away from other AI dogs
        const position = this.generateSpreadPosition(gameState.aiDogs);

        const aiDog: AIDog = {
          id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name,
          position,
          rotation: Math.random() * Math.PI * 2,
          colorIndex: Math.floor(Math.random() * 8),
          size: 1,
          isMoving: true,
          lastUpdate: Date.now(),
          targetPosition: this.generateValidPosition(),
          currentState: 'moving',
          update: (deltaTime: number) => {
            // AI behavior will be implemented in updateAIDogs
            this.updateAIDogs(roomCode, deltaTime);
          }
        };
        gameState.aiDogs.push(aiDog);
      }
    }
  }

  private generateSpreadPosition(existingDogs: any[]): Vector3 {
    const MAX_ATTEMPTS = 50;
    const MIN_DISTANCE = 5; // Minimum distance between AI dogs
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const position = this.generateValidPosition();
      
      // Check distance from other dogs
      const tooClose = existingDogs.some(dog => 
        new Vector3(
          dog.position.x - position.x,
          0,
          dog.position.z - position.z
        ).length() < MIN_DISTANCE
      );
      
      if (!tooClose) {
        return position;
      }
    }
    
    // If we couldn't find a good position, return a random one
    return this.generateValidPosition();
  }

  handlePlayerUpdate(roomCode: string, socketId: string, update: Partial<PlayerState>): void {
    const gameState = this.gameStates.get(roomCode);
    if (!gameState) return;

    const player = gameState.players.get(socketId);
    if (player) {
      // Update player state
      Object.assign(player, update);
      
      // Log significant changes
      if (update.position) {
        console.log(`[GameState] 🔄 Player ${player.name} position update:
          - New pos: (${update.position.x.toFixed(2)}, ${update.position.y.toFixed(2)}, ${update.position.z.toFixed(2)})
          - Room: ${roomCode}
          - Sequence: ${gameState.sequenceNumber}`);
      }
    }
  }

  getGameState(roomCode: string): SerializedGameState | undefined {
    const gameState = this.gameStates.get(roomCode);
    if (!gameState) return undefined;

    // Convert Map to plain object for serialization
    const players: { [key: string]: PlayerState } = {};
    gameState.players.forEach((player, id) => {
      players[id] = player;
    });

    return {
      sequenceNumber: gameState.sequenceNumber,
      timestamp: gameState.timestamp,
      players,
      bones: gameState.bones,
      aiDogs: gameState.aiDogs,
      hydrants: gameState.hydrants,
      territories: gameState.territories,
      stageState: {
        bones: gameState.stageState.bones,
        stageBounds: gameState.stageState.stageBounds
      },
      stageLayout: gameState.stageLayout
    };
  }

  private createInitialGameState(): GameState {
    const seed = Math.floor(Math.random() * 1000000);
    console.log(`[GameState] Creating new game state with seed: ${seed}`);

    const gameState: GameState = {
      players: new Map<string, PlayerState>(),
      bones: this.generateInitialBones(),
      aiDogs: [],
      hydrants: [],
      territories: [],
      sequenceNumber: 0,
      timestamp: Date.now(),
      stageState: {
        bones: [],
        activePowerUps: [],
        stageBounds: this.STAGE_BOUNDS
      },
      stageLayout: this.generateStageLayout(seed)
    };

    console.log(`[GameState] Initial state created:
      - Layout seed: ${seed}
      - Initial bones: ${gameState.bones.length}
      - Stage bounds: ${JSON.stringify(this.STAGE_BOUNDS)}
    `);

    return gameState;
  }

  private generateStageLayout(seed: number): StageLayout {
    console.log(`Generating stage layout with seed: ${seed}`);
    const seededRandom = (max: number, min: number = 0) => {
      const x = Math.sin(seed++) * 10000;
      return min + (x - Math.floor(x)) * (max - min);
    };

    const layout: StageLayout = {
      seed,
      trees: [],
      rocks: [],
      platforms: [],
      walls: []
    };

    // Generate trees (8 trees with scales between 1.7 and 2.3)
    for (let i = 0; i < 8; i++) {
      const scale = 1.7 + seededRandom(0.6); // Scale between 1.7 and 2.3
      const angle = seededRandom(Math.PI * 2);
      const distance = 15 + seededRandom(30); // Distance from center between 15 and 45
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      
      layout.trees.push({
        position: new Vector3(x, 0, z),
        scale,
        width: 1,
        height: 1,
        depth: 1
      });
    }

    // Generate rocks (7 rocks with scales between 1.2 and 1.8)
    for (let i = 0; i < 7; i++) {
      const scale = 1.2 + seededRandom(0.6); // Scale between 1.2 and 1.8
      const angle = seededRandom(Math.PI * 2);
      const distance = 10 + seededRandom(35); // Distance from center between 10 and 45
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      
      layout.rocks.push({
        position: new Vector3(x, 0, z),
        scale,
        width: 1,
        height: 1,
        depth: 1
      });
    }

    // Generate platforms (6 platforms with standard height)
    for (let i = 0; i < 6; i++) {
      const width = 4 + seededRandom(4); // Width between 4 and 8
      const depth = 4 + seededRandom(4); // Depth between 4 and 8
      const height = 1; // Standard height
      const angle = seededRandom(Math.PI * 2);
      const distance = 12 + seededRandom(30); // Distance from center between 12 and 42
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      
      layout.platforms.push({
        position: new Vector3(x, 2, z), // Fixed height at 2
        width,
        height,
        depth,
        scale: 1
      });
    }

    // Generate walls (stage boundaries)
    const halfSize = this.STAGE_SIZE / 2;
    const wallHeight = this.WALL_HEIGHT;
    const thickness = this.WALL_THICKNESS;
    
    // Create the four boundary walls
    layout.walls.push(
      // North wall
      {
        position: new Vector3(0, wallHeight / 2, -halfSize),
        width: this.STAGE_SIZE,
        height: wallHeight,
        depth: thickness,
        scale: 1
      },
      // South wall
      {
        position: new Vector3(0, wallHeight / 2, halfSize),
        width: this.STAGE_SIZE,
        height: wallHeight,
        depth: thickness,
        scale: 1
      },
      // East wall
      {
        position: new Vector3(halfSize, wallHeight / 2, 0),
        width: thickness,
        height: wallHeight,
        depth: this.STAGE_SIZE,
        scale: 1
      },
      // West wall
      {
        position: new Vector3(-halfSize, wallHeight / 2, 0),
        width: thickness,
        height: wallHeight,
        depth: this.STAGE_SIZE,
        scale: 1
      }
    );

    return layout;
  }

  private generateInitialBones(count: number = 50): Array<{ 
    id: string; 
    position: Vector3; 
    collected: boolean;
    lastUpdate: number;
  }> {
    const bones: Array<{ 
      id: string; 
      position: Vector3; 
      collected: boolean;
      lastUpdate: number;
    }> = [];
    
    // Create a deterministic seed based on the current time
    let seed = Date.now();
    const seededRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    
    // Get stage layout if available
    const stageLayout = this.gameStates.size > 0 ? 
      Array.from(this.gameStates.values())[0].stageLayout : 
      null;
    
    // Helper function to check if position is valid (not overlapping with objects)
    const isValidPosition = (position: Vector3): boolean => {
      const MIN_DISTANCE = 2; // Minimum distance from obstacles
      
      // First check distance from other bones
      for (const existingBone of bones) {
        if (position.distanceTo(existingBone.position) < MIN_DISTANCE) {
          return false;
        }
      }
      
      // Then check for collisions with stage objects if available
      if (stageLayout) {
        // Check distance from trees
        for (const tree of stageLayout.trees) {
          const distance = position.distanceTo(tree.position);
          if (distance < MIN_DISTANCE * tree.scale) {
            return false;
          }
        }
        
        // Check distance from rocks
        for (const rock of stageLayout.rocks) {
          const distance = position.distanceTo(rock.position);
          if (distance < MIN_DISTANCE * rock.scale) {
            return false;
          }
        }
        
        // Check distance from platforms
        for (const platform of stageLayout.platforms) {
          // Simple box collision check
          const halfWidth = platform.width / 2 + MIN_DISTANCE;
          const halfDepth = platform.depth / 2 + MIN_DISTANCE;
          
          if (
            position.x >= platform.position.x - halfWidth &&
            position.x <= platform.position.x + halfWidth &&
            position.z >= platform.position.z - halfDepth &&
            position.z <= platform.position.z + halfDepth
          ) {
            return false;
          }
        }
      }
      
      return true;
    };
    
    const stageSize = 100;
    const maxAttempts = 50;
    
    for (let i = 0; i < count; i++) {
      let position: Vector3;
      let isPositionFound = false;
      let attempts = 0;
      
      // Try to find a valid position
      while (!isPositionFound && attempts < maxAttempts) {
        attempts++;
        position = new Vector3(
          (seededRandom() - 0.5) * (stageSize - 20), // Keep away from edges
          0.5,
          (seededRandom() - 0.5) * (stageSize - 20)
        );
        
        if (isValidPosition(position)) {
          isPositionFound = true;
          
          bones.push({
            id: `bone_${i}_${Date.now()}`,
            position,
            collected: false,
            lastUpdate: Date.now()
          });
          
          break;
        }
      }
      
      // If we failed to find a valid position after max attempts, try a different approach
      if (!isPositionFound) {
        console.warn(`Failed to find valid position for bone ${i} after ${maxAttempts} attempts, using fallback`);
        
        // Place bone in a less crowded area with some randomness
        const fallbackPosition = new Vector3(
          (seededRandom() - 0.5) * (stageSize / 2),
          0.5,
          (seededRandom() - 0.5) * (stageSize / 2)
        );
        
        bones.push({
          id: `bone_${i}_${Date.now()}`,
          position: fallbackPosition,
          collected: false,
          lastUpdate: Date.now()
        });
      }
    }
    
    console.log(`Generated ${bones.length} initial bones`);
    return bones;
  }

  private generateValidPosition(): Vector3 {
    const STAGE_BOUND = 45;
    const MAX_ATTEMPTS = 50;
    
    // Create a deterministic seed based on current time
    let seed = Date.now() % 10000;
    
    // Simple seeded random function
    const seededRandom = (max: number) => {
      seed = (seed * 9301 + 49297) % 233280;
      return (seed / 233280) * max;
    };
    
    // Generate a position within stage bounds
    return new Vector3(
      (seededRandom(2) - 1) * STAGE_BOUND,
      0.5,
      (seededRandom(2) - 1) * STAGE_BOUND
    );
  }

  updateGameState(roomCode: string): void {
    const currentTime = Date.now();
    const lastUpdateTime = this.lastUpdateTimes.get(roomCode) || currentTime;
    const deltaTime = (currentTime - lastUpdateTime) / 1000; // Convert to seconds

    // Only update if enough time has passed
    if (deltaTime < this.UPDATE_INTERVAL / 1000) {
      return;
    }

    const gameState = this.gameStates.get(roomCode);
    if (!gameState) return;

    // Update last update time
    this.lastUpdateTimes.set(roomCode, currentTime);

    // Log state before update
    console.log(`[GameState] 🔄 Updating room ${roomCode}:
      - Delta time: ${deltaTime.toFixed(3)}s
      - Players: ${Object.keys(gameState.players).length}
      - AI Dogs: ${gameState.aiDogs?.length || 0}
      - Active bones: ${gameState.bones.length}
      - Sequence: ${gameState.sequenceNumber}
      - Timestamp: ${currentTime}`);

    // Update AI dogs
    this.updateAIDogs(roomCode, deltaTime);

    // Increment sequence number with overflow protection
    gameState.sequenceNumber = (gameState.sequenceNumber + 1) % Number.MAX_SAFE_INTEGER;
    gameState.timestamp = currentTime;

    // Broadcast updated state to all clients in the room
    this.io.to(roomCode).emit('gameState', this.serializeGameState(gameState));
  }

  public updateAIDogs(roomCode: string, deltaTime: number): void {
    const gameState = this.gameStates.get(roomCode);
    if (!gameState || !gameState.aiDogs) return;

    // Count human players correctly
    const humanPlayers = Array.from(gameState.players.values()).filter(p => !p.isAI);
    const humanPlayerCount = humanPlayers.length;

    // Ensure correct number of AI dogs (10 total players - human players)
    const targetAICount = Math.max(0, 10 - humanPlayerCount);
    
    if (gameState.aiDogs.length !== targetAICount) {
      console.log(`[GameState] 🔄 Adjusting AI dog count in room ${roomCode}:
        - Current: ${gameState.aiDogs.length}
        - Target: ${targetAICount}
        - Human players: ${humanPlayerCount}`);
      this.addAIPlayers(roomCode);
    }

    // Update each AI dog
    gameState.aiDogs.forEach(aiDog => {
      // Find nearby players and bones
      const nearbyPlayers = humanPlayers.filter(p => 
        this.getDistance(aiDog.position, p.position) < this.AI_DETECTION_RADIUS
      );
      
      const nearbyBones = gameState.bones.filter(b => 
        !b.collected && 
        this.getDistance(aiDog.position, b.position) < this.AI_DETECTION_RADIUS
      );

      // Determine target position
      let targetPosition = aiDog.position;
      if (nearbyBones.length > 0) {
        // Move towards closest bone
        const closestBone = nearbyBones.reduce((closest, bone) => 
          this.getDistance(aiDog.position, bone.position) < this.getDistance(aiDog.position, closest.position) 
            ? bone 
            : closest
        );
        targetPosition = closestBone.position;
      } else if (nearbyPlayers.length > 0) {
        // Move towards closest player
        const closestPlayer = nearbyPlayers.reduce((closest, player) =>
          this.getDistance(aiDog.position, player.position) < this.getDistance(aiDog.position, closest.position)
            ? player
            : closest
        );
        targetPosition = closestPlayer.position;
      } else {
        // Random movement
        const angle = Math.random() * Math.PI * 2;
        targetPosition = new Vector3(
          aiDog.position.x + Math.cos(angle) * this.AI_SPEED * deltaTime,
          0.5,
          aiDog.position.z + Math.sin(angle) * this.AI_SPEED * deltaTime
        );
      }

      // Calculate movement
      const dx = targetPosition.x - aiDog.position.x;
      const dz = targetPosition.z - aiDog.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Update position and rotation
      if (distance > 0.1) {
        const moveX = (dx / distance) * this.AI_SPEED * deltaTime;
        const moveZ = (dz / distance) * this.AI_SPEED * deltaTime;
        
        const newPosition = new Vector3(
          aiDog.position.x + moveX,
          0.5,
          aiDog.position.z + moveZ
        );

        // Update rotation
        aiDog.rotation = Math.atan2(moveX, moveZ);
        
        // Only update position if no collision
        if (!this.checkCollision(newPosition, gameState.stageLayout)) {
          aiDog.position = newPosition;
        }
      }

      // Log AI dog update
      console.log(`[GameState] 🤖 AI dog ${aiDog.name} (${aiDog.id}) update:
        - Old pos: (${aiDog.position.x.toFixed(2)}, ${aiDog.position.y.toFixed(2)}, ${aiDog.position.z.toFixed(2)})
        - Target: (${targetPosition.x.toFixed(2)}, ${targetPosition.y.toFixed(2)}, ${targetPosition.z.toFixed(2)})
        - Distance to target: ${distance.toFixed(3)}
        - Nearby players: ${nearbyPlayers.length}
        - Nearby bones: ${nearbyBones.length}
        - Is moving: ${distance > 0.1}
        - Rotation: ${aiDog.rotation.toFixed(2)}
        - Sequence: ${gameState.sequenceNumber}
        - Timestamp: ${Date.now()}
        - Delta time: ${deltaTime.toFixed(3)}s`);
    });
  }

  private getDistance(pos1: Position, pos2: Position): number {
    const dx = pos1.x - pos2.x;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // Handle player joining
  handlePlayerJoin(roomCode: string, socketId: string, playerName: string): void {
    console.log(`[GameState] 👤 Player ${playerName} (${socketId}) joining room ${roomCode}`);
    
    let gameState = this.gameStates.get(roomCode);
    if (!gameState) {
      gameState = this.createInitialGameState();
      this.gameStates.set(roomCode, gameState);
      console.log(`[GameState] 🎮 Created new room ${roomCode}`);
    }

    // Initialize player state
    const spawnPosition = this.generateValidPosition();
    const colorIndex = Math.floor(Math.random() * 8);
    const playerState: PlayerState = {
      id: socketId,
      name: playerName,
      position: spawnPosition,
      rotation: 0,
      colorIndex,
      size: 1,
      bones: 0,
      isAI: false,
      lastUpdate: Date.now(),
      actions: {
        isMoving: false,
        isBiting: false,
        isMarking: false,
        hasZoomies: false
      }
    };

    // Add player to game state
    gameState.players.set(socketId, playerState);
    
    console.log(`[GameState] ✨ Initialized player ${playerName}:
      - ID: ${socketId}
      - Position: (${spawnPosition.x.toFixed(2)}, ${spawnPosition.y.toFixed(2)}, ${spawnPosition.z.toFixed(2)})
      - Room: ${roomCode}
      - Total players: ${Object.keys(gameState.players).length}`);

    // Update AI dogs count
    this.addAIPlayers(roomCode);
  }

  // Handle player leaving
  handlePlayerLeave(roomCode: string, socketId: string): void {
    const gameState = this.gameStates.get(roomCode);
    if (!gameState) return;

    const player = gameState.players.get(socketId);
    if (player) {
      console.log(`[GameState] 👋 Player ${player.name} (${socketId}) leaving room ${roomCode}`);
      gameState.players.delete(socketId);
      
      // Update AI dogs count
      this.addAIPlayers(roomCode);
    }
  }

  // Add methods to manage game objects within the GameState
  addBoneToRoom(roomCode: string, bone: { id: string; position: Vector3; collected: boolean }) {
    const gameState = this.gameStates.get(roomCode);
    if (gameState) {
      gameState.bones.push({
        ...bone,
        lastUpdate: Date.now()
      });
      gameState.sequenceNumber++;
    }
  }

  removeBoneFromRoom(roomCode: string, boneId: string) {
    const gameState = this.gameStates.get(roomCode);
    if (gameState) {
      gameState.bones = gameState.bones.filter(b => b.id !== boneId);
      gameState.sequenceNumber++;
    }
  }

  updateBoneInRoom(roomCode: string, boneId: string, isCollected: boolean) {
    const gameState = this.gameStates.get(roomCode);
    if (gameState) {
      const bone = gameState.bones.find(b => b.id === boneId);
      if (bone) {
        const oldState = { ...bone };
        bone.collected = isCollected;
        bone.lastUpdate = Date.now();
        gameState.sequenceNumber++;
        
        console.log(`[GameState] 🦴 Bone update in room ${roomCode}:
          - Bone ID: ${boneId}
          - Position: (${bone.position.x.toFixed(2)}, ${bone.position.y.toFixed(2)}, ${bone.position.z.toFixed(2)})
          - Collected: ${isCollected}
          - Previous state: ${JSON.stringify(oldState)}
          - Remaining bones: ${gameState.bones.filter(b => !b.collected).length}
          - Total bones: ${gameState.bones.length}
          - Sequence: ${gameState.sequenceNumber}
          - Timestamp: ${Date.now()}
          - Latency: ${Date.now() - bone.lastUpdate}ms`
        );
      } else {
        console.warn(`[GameState] ❌ Cannot find bone ${boneId} in room ${roomCode}`);
      }
    }
  }

  // Serialize game state for network transmission
  private serializeGameState(gameState: GameState): any {
    return {
      sequenceNumber: gameState.sequenceNumber,
      timestamp: gameState.timestamp,
      players: gameState.players,
      aiDogs: gameState.aiDogs,
      bones: gameState.bones,
      stageLayout: gameState.stageLayout
    };
  }

  // Check for collisions with stage objects
  private checkCollision(position: Vector3, stageLayout: StageLayout): boolean {
    const MIN_DISTANCE = 2; // Minimum distance from obstacles
    
    // Check distance from trees
    for (const tree of stageLayout.trees) {
      const distance = position.distanceTo(tree.position);
      if (distance < MIN_DISTANCE * (tree.scale ?? 1)) {
        return true;
      }
    }
    
    // Check distance from rocks
    for (const rock of stageLayout.rocks) {
      const distance = position.distanceTo(rock.position);
      if (distance < MIN_DISTANCE * (rock.scale ?? 1)) {
        return true;
      }
    }
    
    // Check distance from platforms
    for (const platform of stageLayout.platforms) {
      // Simple box collision check
      const halfWidth = (platform.width ?? 4) / 2 + MIN_DISTANCE;
      const halfDepth = (platform.depth ?? 4) / 2 + MIN_DISTANCE;
      
      if (
        position.x >= platform.position.x - halfWidth &&
        position.x <= platform.position.x + halfWidth &&
        position.z >= platform.position.z - halfDepth &&
        position.z <= platform.position.z + halfDepth
      ) {
        return true;
      }
    }
    
    return false;
  }

  // Add or remove AI players to maintain correct count
  private addAIPlayers(roomCode: string): void {
    const gameState = this.gameStates.get(roomCode);
    if (!gameState) return;

    const humanPlayerCount = Array.from(gameState.players.values()).filter(p => !p.isAI).length;
    const targetAICount = Math.max(0, 10 - humanPlayerCount);

    // Adjust AI dog count
    while (gameState.aiDogs.length > targetAICount) {
      gameState.aiDogs.pop();
    }

    while (gameState.aiDogs.length < targetAICount) {
      const position = this.generateValidPosition();
      const aiDog: AIDog = {
        id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: this.generateAIDogName(),
        position: new Vector3(position.x, position.y, position.z),
        rotation: Math.random() * Math.PI * 2,
        colorIndex: Math.floor(Math.random() * 8),
        size: 1,
        isMoving: false,
        lastUpdate: Date.now(),
        targetPosition: null,
        currentState: 'idle',
        update: (deltaTime: number) => {
          // AI behavior will be implemented in updateAIDogs
          this.updateAIDogs(roomCode, deltaTime);
        }
      };
      gameState.aiDogs.push(aiDog);
    }
  }

  // Generate a random name for AI dogs
  private generateAIDogName(): string {
    const names = ['Bear', 'Banjo', 'Murphy', 'Bruno', 'Rosie', 'Bentley', 'Jax', 'Hazel', 'Daisy', 'Luna'];
    return names[Math.floor(Math.random() * names.length)];
  }
} 