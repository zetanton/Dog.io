import { io, Socket } from 'socket.io-client';
import { Position } from '../types/Position';

export interface NetworkPlayerState {
  id: string;
  name: string;
  colorIndex: number;
  position: Position;
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
  timestamp?: number; // When this state was last updated
}

export interface NetworkGameState {
  players: { [id: string]: NetworkPlayerState };
  bones: Array<{
    id: string;
    position: Position;
    isCollected: boolean;
  }>;
  powerUps: Array<{
    id: string;
    type: string;
    position: Position;
    isActive: boolean;
  }>;
  aiDogs: Array<{
    id: string;
    name: string;
    position: Position;
    rotation: number;
    colorIndex: number;
    size: number;
    isMoving: boolean;
    timestamp?: number; // When this state was last updated
  }>;
  hydrants: Array<{
    id: string;
    position: Position;
    owner: string;
    timestamp: number;
  }>;
  territories: Array<{
    id: string;
    position: Position;
    radius: number;
    owner: string;
    timestamp: number;
  }>;
  stageState?: {
    bones: Array<{
      id: string;
      position: Position;
      isCollected: boolean;
    }>;
    stageBounds: {
      min: Position;
      max: Position;
    };
  };
  stageLayout?: {
    seed: number;
    trees: { position: Position, scale: number }[];
    rocks: { position: Position, scale: number }[];
    platforms: { 
      position: Position,
      width: number,
      height: number,
      depth: number
    }[];
    walls: { 
      position: Position,
      width: number,
      height: number,
      depth: number
    }[];
  };
  sequenceNumber?: number; // Track state order
  timestamp?: number; // When this state was generated on the server
  priority?: number; // Priority of this update (1-3, with 1 being highest)
}

// Define state update priorities
export enum UpdatePriority {
  HIGH = 1,   // Critical updates (player actions, collisions)
  MEDIUM = 2, // Important but not critical (AI movements, bone collection)
  LOW = 3     // Background updates (distant entity movements)
}

type GameStateCallback = (state: NetworkGameState) => void;
type PlayerJoinedCallback = (players: { id: string; name: string; }[]) => void;
type ErrorCallback = (error: string) => void;

interface BufferedState {
  state: NetworkGameState;
  timestamp: number;
  applied: boolean;
}

export class NetworkManager {
  private static instance: NetworkManager;
  private socket: Socket;
  private gameStateCallback?: GameStateCallback;
  private playerJoinedCallback?: PlayerJoinedCallback;
  private errorCallback?: ErrorCallback;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private lastReceivedSequence = 0;
  private pendingStateUpdates: Map<number, NetworkGameState> = new Map();
  private readonly STATE_UPDATE_INTERVAL = 50; // 20 updates per second
  
  // Buffer for state reconciliation
  private stateBuffer: BufferedState[] = [];
  private readonly MAX_BUFFER_SIZE = 10;
  private clockSyncOffset = 0; // Time difference between client and server
  private lastServerTime = 0;
  private stateRequestTimer?: NodeJS.Timeout;

  private constructor() {
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    this.socket = io(serverUrl, {
      withCredentials: true,
      secure: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000
    });

    this.setupSocketListeners();
    this.initializeClockSync();
    this.startStateRequestLoop();
  }
  
  // Synchronize client-server clocks for accurate timing
  private initializeClockSync(): void {
    // Initial sync
    this.syncClock();
    
    // Periodically sync clocks to account for drift
    setInterval(() => this.syncClock(), 60000); // Every minute
  }
  
  private syncClock(): void {
    if (!this.socket.connected) return;
    
    const clientTime = Date.now();
    this.socket.emit('clockSync', { clientTime }, (response: { serverTime: number }) => {
      const receivedTime = Date.now();
      const roundTripTime = receivedTime - clientTime;
      const serverTime = response.serverTime;
      
      // Estimate server time by accounting for half the round trip
      this.clockSyncOffset = serverTime - (clientTime + roundTripTime / 2);
      console.log(`Clock synchronized. Offset: ${this.clockSyncOffset}ms, RTT: ${roundTripTime}ms`);
    });
  }
  
  // Get current server time (estimated)
  public getServerTime(): number {
    return Date.now() + this.clockSyncOffset;
  }

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  private startStateRequestLoop(): void {
    this.stateRequestTimer = setInterval(() => {
      if (this.socket.connected) {
        this.socket.emit('requestState', { lastSequence: this.lastReceivedSequence });
      }
    }, this.STATE_UPDATE_INTERVAL);
  }

  private stopStateRequestLoop(): void {
    if (this.stateRequestTimer) {
      clearInterval(this.stateRequestTimer);
      this.stateRequestTimer = undefined;
    }
  }

  private setupSocketListeners(): void {
    this.socket.on('connect', () => {
      console.log('[NetworkManager] Connected to server with socket ID:', this.socket.id);
      this.reconnectAttempts = 0;
      this.lastReceivedSequence = 0;
      this.pendingStateUpdates.clear();
      this.stateBuffer = [];
      this.syncClock();
    });

    this.socket.on('disconnect', () => {
      console.log('[NetworkManager] Disconnected from server');
      this.stopStateRequestLoop();
    });

    this.socket.on('gameState', (state: NetworkGameState) => {
      if (state.timestamp) {
        this.lastServerTime = state.timestamp;
      }

      if (state.sequenceNumber !== undefined) {
        const timeDiff = Date.now() - (state.timestamp || 0);
        console.log(`[NetworkManager] Received state update:
          - Sequence: ${state.sequenceNumber} (last: ${this.lastReceivedSequence})
          - Players: ${Object.keys(state.players || {}).length}
          - AI Dogs: ${state.aiDogs?.length || 0}
          - Active bones: ${state.stageState?.bones?.filter(b => !b.isCollected).length || 0}
          - Time diff: ${timeDiff}ms
          - Layout seed: ${state.stageLayout?.seed}
        `);

        if (state.sequenceNumber > this.lastReceivedSequence) {
          this.addToStateBuffer(state);
          this.processGameState(state);
          this.lastReceivedSequence = state.sequenceNumber;
        } else {
          console.warn(`[NetworkManager] Ignoring outdated state:
            - Received: ${state.sequenceNumber}
            - Current: ${this.lastReceivedSequence}
            - Time diff: ${timeDiff}ms
          `);
        }
      }
    });

    this.socket.on('playerStateUpdate', (update: NetworkPlayerState) => {
      console.log(`[NetworkManager] Received player update:
        - Player: ${update.name} (${update.id})
        - Position: (${update.position.x.toFixed(2)}, ${update.position.z.toFixed(2)})
        - Bones: ${update.bones}
        - Size: ${update.size}
        - Actions: ${JSON.stringify(update.actions)}
        - Time diff: ${Date.now() - (update.timestamp || 0)}ms
      `);

      if (this.gameStateCallback) {
        const currentState = this.getLatestState();
        if (currentState && currentState.players) {
          const oldState = currentState.players[update.id];
          currentState.players[update.id] = {
            ...currentState.players[update.id],
            ...update
          };
          this.gameStateCallback(currentState);

          if (oldState) {
            console.log(`[NetworkManager] Updated player state:
              - Position: (${oldState.position.x.toFixed(2)}, ${oldState.position.z.toFixed(2)}) -> (${update.position.x.toFixed(2)}, ${update.position.z.toFixed(2)})
              - Bones: ${oldState.bones} -> ${update.bones}
              - Size: ${oldState.size} -> ${update.size}
            `);
          }
        } else {
          console.warn('[NetworkManager] Cannot update player state - no current state available');
        }
      }
    });

    this.socket.on('boneCollected', (data: { boneId: string, playerId: string, timestamp: number }) => {
      console.log(`[NetworkManager] Bone collected:
        - Bone ID: ${data.boneId}
        - Player: ${data.playerId}
        - Time diff: ${Date.now() - data.timestamp}ms
      `);

      if (this.gameStateCallback) {
        const currentState = this.getLatestState();
        if (currentState) {
          const bone = currentState.stageState?.bones.find(b => b.id === data.boneId);
          if (bone) {
            bone.isCollected = true;
            this.gameStateCallback(currentState);
          } else {
            console.warn(`[NetworkManager] Cannot find bone ${data.boneId} to mark as collected`);
          }
        } else {
          console.warn('[NetworkManager] Cannot process bone collection - no current state available');
        }
      }
    });

    this.socket.on('playerJoined', (data: { code: string; players: string[] }) => {
      if (this.playerJoinedCallback) {
        this.playerJoinedCallback(data.players.map(name => ({ id: '', name })));
      }
    });

    this.socket.on('playerLeft', (data: { playerId: string, timestamp: number }) => {
      console.log(`[NetworkManager] Player left:
        - Player ID: ${data.playerId}
        - Time diff: ${Date.now() - data.timestamp}ms`
      );
    });

    this.socket.on('gameStart', () => {
      console.log('[NetworkManager] Game started');
    });

    this.socket.on('error', (error: { message: string }) => {
      console.error('[NetworkManager] Socket error:', error);
      if (this.errorCallback) {
        this.errorCallback(error.message);
      }
    });

    this.socket.on('connect_error', () => {
      this.reconnectAttempts++;
      if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
        this.errorCallback?.('Failed to connect to server after multiple attempts');
      }
    });
  }
  
  
  // Add state to buffer for reconciliation purposes
  private addToStateBuffer(state: NetworkGameState): void {
    this.stateBuffer.push({
      state,
      timestamp: state.timestamp || Date.now(),
      applied: false
    });
    
    // Keep buffer at a reasonable size
    while (this.stateBuffer.length > this.MAX_BUFFER_SIZE) {
      this.stateBuffer.shift();
    }
  }
  
  // Process game state with callbacks
  private processGameState(state: NetworkGameState): void {
    console.log(`[NetworkManager] Processing game state:
      - Players: ${Object.keys(state.players || {}).map(id => 
        `${state.players[id].name}(${id}): ${state.players[id].bones} bones`).join(', ')}
      - Active bones: ${state.stageState?.bones?.filter(b => !b.isCollected).length || 0}
      - AI Dogs: ${state.aiDogs?.length || 0}
      - Sequence: ${state.sequenceNumber}
      - Layout seed: ${state.stageLayout?.seed}
    `);

    const bufferEntry = this.stateBuffer.find(entry => 
      entry.state.sequenceNumber === state.sequenceNumber);
    if (bufferEntry) {
      bufferEntry.applied = true;
    }
    
    if (this.gameStateCallback) {
      this.gameStateCallback(state);
    }
  }
  
  // Get latest state from buffer
  public getLatestState(): NetworkGameState | null {
    if (this.stateBuffer.length === 0) return null;
    
    // Find the most recent applied state
    const latestApplied = this.stateBuffer
      .filter(entry => entry.applied)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
      
    return latestApplied?.state || null;
  }
  
  // Estimate one-way latency to server in milliseconds
  public getEstimatedLatency(): number {
    if (!this.lastServerTime) return 0;
    
    // Simple estimation using the time difference and clock offset
    return Date.now() - this.lastServerTime + this.clockSyncOffset;
  }

  getRoomList(): void {
    this.socket.emit('getRooms');
  }

  createRoom(isPublic: boolean, playerName: string): void {
    this.socket.emit('createRoom', { isPublic, playerName });
  }

  joinRoom(code: string, playerName: string): void {
    this.socket.emit('joinRoom', { code, playerName }, (response: { success: boolean, error?: string }) => {
      if (!response.success) {
        console.error('Failed to join room:', response.error);
        this.errorCallback?.(response.error || 'Unknown error');
      }
    });
  }

  updatePlayerState(update: Partial<NetworkPlayerState>): void {
    const timestampedUpdate = {
      ...update,
      timestamp: Date.now()
    };
    
    console.log(`[NetworkManager] Sending player update:
      - ID: ${update.id}
      - Position: ${update.position ? `(${update.position.x.toFixed(2)}, ${update.position.z.toFixed(2)})` : 'unchanged'}
      - Actions: ${JSON.stringify(update.actions || {})}
      - Timestamp: ${timestampedUpdate.timestamp}
    `);
    
    this.socket.emit('playerUpdate', timestampedUpdate);
  }

  onGameState(callback: GameStateCallback): void {
    this.gameStateCallback = callback;
  }

  onPlayerJoined(callback: PlayerJoinedCallback): void {
    this.playerJoinedCallback = callback;
  }

  onPlayerLeft(): void {
  }

  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  disconnect(): void {
    this.socket.disconnect();
    this.stopStateRequestLoop();
  }

  isConnected(): boolean {
    return this.socket.connected;
  }

  getSocketId(): string {
    if (!this.socket.id) {
      throw new Error('Socket ID not available - not connected to server');
    }
    return this.socket.id;
  }

  on(event: string, callback: (...args: any[]) => void): void {
    this.socket.on(event, callback);
  }

  off(event: string, callback: (...args: any[]) => void): void {
    this.socket.off(event, callback);
  }

  onRoomList(callback: (rooms: Array<{ code: string; playerCount: number; isPublic: boolean }>) => void): void {
    this.socket.on('roomList', callback);
  }

  onRoomJoined(callback: (data: { code: string; players: string[] }) => void): void {
    this.socket.on('roomJoined', callback);
  }

  onRoomError(callback: (error: string) => void): void {
    this.socket.on('roomError', callback);
  }

  startGame(): void {
    this.socket.emit('startGame', (response: { error?: string; success?: boolean }) => {
      if (response.error) {
        console.error('Failed to start game:', response.error);
        if (this.errorCallback) {
          this.errorCallback(response.error);
        }
      }
    });
  }

  onGameStart(callback: () => void): void {
    this.socket.on('gameStart', callback);
  }

  updateReadyStatus(roomCode: string, isReady: boolean): void {
    this.socket.emit('playerReady', { roomCode, isReady });
  }

  onPlayerReadyUpdate(callback: (data: { playerName: string; isReady: boolean }) => void): void {
    this.socket.on('playerReadyUpdate', callback);
  }

  collectBone(boneId: string): void {
    console.log(`[NetworkManager] Requesting bone collection: ${boneId}`);
    this.socket.emit('collectBone', { boneId });
  }
} 