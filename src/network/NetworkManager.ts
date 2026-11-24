import { io, Socket } from 'socket.io-client';
import { Vector3 } from 'three';

export interface NetworkPlayerState {
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

export interface NetworkGameState {
  players: Map<string, NetworkPlayerState>;
  bones: {
    id: string;
    position: Vector3;
    collected: boolean;
  }[];
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

type GameStateCallback = (state: NetworkGameState) => void;
type PlayerJoinedCallback = (players: { id: string; name: string; }[]) => void;
type PlayerLeftCallback = (playerId: string) => void;
type ErrorCallback = (error: string) => void;

export class NetworkManager {
  private static instance: NetworkManager;
  private socket: Socket;
  private gameStateCallback?: GameStateCallback;
  private playerJoinedCallback?: PlayerJoinedCallback;
  private playerLeftCallback?: PlayerLeftCallback;
  private errorCallback?: ErrorCallback;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  private constructor() {
    this.socket = io('http://localhost:3001', {
      reconnection: true,
      reconnectionAttempts: this.MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
    });

    this.setupSocketListeners();
  }

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  private setupSocketListeners(): void {
    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    this.socket.on('gameState', (state: NetworkGameState) => {
      this.gameStateCallback?.(state);
    });

    this.socket.on('playerJoined', (players: { id: string; name: string; }[]) => {
      this.playerJoinedCallback?.(players);
    });

    this.socket.on('playerLeft', (playerId: string) => {
      this.playerLeftCallback?.(playerId);
    });

    this.socket.on('error', (error: string) => {
      this.errorCallback?.(error);
    });

    this.socket.on('connect_error', () => {
      this.reconnectAttempts++;
      if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
        this.errorCallback?.('Failed to connect to server after multiple attempts');
      }
    });
  }

  createRoom(): void {
    this.socket.emit('createRoom');
  }

  joinRoom(roomCode: string, playerName: string, colorIndex: number): void {
    this.socket.emit('joinRoom', roomCode, playerName, colorIndex);
  }

  updatePlayerState(update: Partial<NetworkPlayerState>): void {
    this.socket.emit('playerUpdate', update);
  }

  onGameState(callback: GameStateCallback): void {
    this.gameStateCallback = callback;
  }

  onPlayerJoined(callback: PlayerJoinedCallback): void {
    this.playerJoinedCallback = callback;
  }

  onPlayerLeft(callback: PlayerLeftCallback): void {
    this.playerLeftCallback = callback;
  }

  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  disconnect(): void {
    this.socket.disconnect();
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
} 