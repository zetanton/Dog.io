export interface NetworkPlayer {
  id: string;
  name: string;
  colorIndex: number;
  position: { x: number, y: number, z: number };
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

export interface NetworkBone {
  id: string;
  position: { x: number, y: number, z: number };
  isCollected: boolean;
}

export interface NetworkAIPlayer {
  id: string;
  name: string;
  position: { x: number, y: number, z: number };
  rotation: number;
  colorIndex: number;
  size: number;
  isMoving: boolean;
}

export interface NetworkGameState {
  players?: { [id: string]: NetworkPlayer };
  bones?: NetworkBone[];
  aiDogs?: NetworkAIPlayer[];
  stageLayout?: {
    seed: number;
    trees: { position: { x: number, y: number, z: number }, scale: number }[];
    rocks: { position: { x: number, y: number, z: number }, scale: number }[];
    platforms: { 
      position: { x: number, y: number, z: number },
      width: number,
      height: number,
      depth: number
    }[];
  };
} 