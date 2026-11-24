import * as THREE from 'three';
import { Character } from './Character';
import AudioManager from '../../utils/AudioManager';
import dogNames from '../../data/dogNames.json';
import TWEEN from '@tweenjs/tween.js';
import { NetworkManager } from '../../network/NetworkManager';

export interface Bone {
  id: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
  timestamp: number;
  lifespan?: number;
  boundingBox?: THREE.Box3;
  lastPosition?: THREE.Vector3;
}

interface DroppingBone extends Bone {
  velocity: THREE.Vector3;
  rotationSpeed: THREE.Vector3;
  dropTimer: number;
  collectionDelay?: number;
}

interface PlayerCache {
  boundingBox: THREE.Box3;
  lastPosition: THREE.Vector3;
  lastSize: number;
}

interface NameTagCache {
  lastPosition: THREE.Vector3;
  lastBones: number;
  lastScreenX: number;
  lastScreenY: number;
  lastHasWon: boolean;
}

export interface PowerUp {
  id: string;
  type: string;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
}

export class Stage {
  scene: THREE.Scene;
  public bones: Bone[] = [];
  droppingBones: DroppingBone[] = [];
  players: Character[] = [];
  platforms: THREE.Mesh[] = [];
  collidableObjects: THREE.Object3D[] = [];
  nameTags: { [key: string]: HTMLDivElement } = {};
  private readonly STAGE_SIZE = 100;
  private readonly TARGET_BONES = 50;
  private readonly BONE_DROP_DURATION = 0.5;
  private readonly GRAVITY = 9.8;
  private readonly RESPAWN_DELAY = 3.0;
  private bonePool: THREE.Group[] = [];
  private readonly BONE_POOL_SIZE = 200;
  private readonly MAX_EXPLOSION_BONES = 15;
  private activeBones = new Set<THREE.Group>();
  private spawnLocations: { position: THREE.Vector3; weight: number }[] = [];
  private totalSpawnWeight: number = 0;
  private readonly CELL_SIZE = 10; // Size of each grid cell
  private readonly GRID_SIZE = 10; // Number of cells in each dimension
  private spatialGrid: Set<Bone>[][] = [];
  private boneBoundingBoxes = new Map<Bone, THREE.Box3>();
  private playerCache: WeakMap<Character, PlayerCache> = new WeakMap();
  private nameTagCache: WeakMap<Character, NameTagCache> = new WeakMap();
  powerUps: PowerUp[] = [];
  aiDogs: Character[] = [];
  public isLayoutInitialized: boolean = false; // Track if we're using server layout

  // Shared geometries and materials for bones
  private static boneGeometry: THREE.CylinderGeometry;
  private static boneEndGeometry: THREE.SphereGeometry;
  private static boneMaterial: THREE.MeshPhongMaterial;
  private static boneBlinkingMaterial: THREE.MeshPhongMaterial;

  private clippingPlanes: THREE.Plane[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initSharedResources();
    this.createGround();
    this.createBoundaries();
    this.initBonePool();
    this.initSpawnLocations();
    this.initSpatialGrid();
    
    // Don't create stage elements yet - wait for server data
    // this.createEnvironment();
    // this.createPlatforms();
    // this.spawnInitialBones();
  }

  private initSharedResources() {
    if (!Stage.boneGeometry) {
      Stage.boneGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8);
      Stage.boneEndGeometry = new THREE.SphereGeometry(0.15, 8, 8);
      Stage.boneMaterial = new THREE.MeshPhongMaterial({ color: 0xFFFFFF });
      Stage.boneBlinkingMaterial = new THREE.MeshPhongMaterial({ 
        color: 0xFFFFFF,
        transparent: true,
        opacity: 1.0
      });
    }
  }

  private createGround() {
    const groundGeometry = new THREE.PlaneGeometry(this.STAGE_SIZE, this.STAGE_SIZE);
    const groundMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x90EE90,
      side: THREE.DoubleSide 
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private createTree(x: number, z: number, scale: number = 1) {
    const treeGroup = new THREE.Group();
    
    // Tree trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.4 * scale, 0.6 * scale, 3 * scale, 8);
    const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 1.5 * scale;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    // Tree leaves (multiple layers)
    const leafMaterial = new THREE.MeshPhongMaterial({ color: 0x228B22 });
    const createLeafLayer = (y: number, size: number) => {
      const leafGeometry = new THREE.OctahedronGeometry(size * scale);
      const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
      leaf.position.y = y * scale;
      leaf.castShadow = true;
      treeGroup.add(leaf);
    };

    createLeafLayer(3, 1.2);
    createLeafLayer(4, 1.0);
    createLeafLayer(5, 0.8);

    treeGroup.position.set(x, 0, z);
    this.scene.add(treeGroup);
    this.collidableObjects.push(treeGroup);
  }

  private createRock(x: number, z: number, scale: number = 1) {
    const rockGeometry = new THREE.DodecahedronGeometry(scale);
    const rockMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x808080
    });
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    rock.position.set(x, scale, z);
    rock.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.scene.add(rock);
    this.collidableObjects.push(rock);
  }

  private createPlatform(x: number, y: number, z: number, width: number = 6, height: number = 1, depth: number = 6) {
    const platformGeometry = new THREE.BoxGeometry(width, height, depth);
    const platformMaterial = new THREE.MeshPhongMaterial({ 
      color: 0xA0522D
    });
    
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.set(x, y, z);
    platform.castShadow = true;
    platform.receiveShadow = true;
    
    this.platforms.push(platform);
    this.collidableObjects.push(platform);
    this.scene.add(platform);
  }





  private createBoundaries() {
    const wallGeometry = new THREE.BoxGeometry(1, 4, this.STAGE_SIZE);
    const wallMaterial = new THREE.MeshPhongMaterial({ color: 0x808080 });

    // Create four walls
    const walls = [
      { pos: [this.STAGE_SIZE/2, 2, 0], rot: [0, 0, 0] },
      { pos: [-this.STAGE_SIZE/2, 2, 0], rot: [0, 0, 0] },
      { pos: [0, 2, this.STAGE_SIZE/2], rot: [0, Math.PI/2, 0] },
      { pos: [0, 2, -this.STAGE_SIZE/2], rot: [0, Math.PI/2, 0] }
    ];

    walls.forEach(({ pos, rot }) => {
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(pos[0], pos[1], pos[2]);
      wall.rotation.set(rot[0], rot[1], rot[2]);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
      this.collidableObjects.push(wall);
    });
  }

  private initBonePool() {
    // Initialize shared geometries if not already done
    if (!Stage.boneGeometry) {
      this.initSharedResources();
    }

    // Clear existing pool and active bones
    this.bonePool = [];
    this.activeBones.clear();

    // Create new bones for the pool
    for (let i = 0; i < this.BONE_POOL_SIZE; i++) {
      const bone = this.createBoneMesh();
      bone.visible = false;
      bone.position.set(0, -1000, 0); // Move out of sight
      this.scene.add(bone);
      this.bonePool.push(bone);
    }
    console.log('Initialized bone pool with size:', this.BONE_POOL_SIZE);
  }

  private getBoneFromPool(): THREE.Group | null {
    // First try to find an invisible bone
    const availableBone = this.bonePool.find(bone => 
      !bone.visible && !this.activeBones.has(bone)
    );

    if (availableBone) {
      this.activeBones.add(availableBone);
      availableBone.visible = true;
      return availableBone;
    }

    // If no available bones, try to reuse the oldest active bone
    if (this.bonePool.length > 0) {
      const oldestBone = this.bonePool[0];
      oldestBone.visible = true;
      // Move bone to end of pool to maintain age order
      this.bonePool.push(this.bonePool.shift()!);
      return oldestBone;
    }

    console.warn('No bones available in pool');
    return null;
  }

  private returnBoneToPool(bone: THREE.Group) {
    bone.visible = false;
    bone.position.set(0, -1000, 0); // Move out of sight
    bone.rotation.set(0, 0, 0);
    this.activeBones.delete(bone);
  }

  private createBoneMesh(): THREE.Group {
    const boneGroup = new THREE.Group();
    
    // Use shared geometry and material for the bone body
    const bone = new THREE.Mesh(Stage.boneGeometry, Stage.boneMaterial);
    bone.rotation.x = Math.PI / 2;
    bone.castShadow = true;
    boneGroup.add(bone);

    // Use shared geometry and material for bone ends
    const end1 = new THREE.Mesh(Stage.boneEndGeometry, Stage.boneMaterial);
    end1.position.z = 0.25;
    end1.castShadow = true;
    boneGroup.add(end1);

    const end2 = new THREE.Mesh(Stage.boneEndGeometry, Stage.boneMaterial);
    end2.position.z = -0.25;
    end2.castShadow = true;
    boneGroup.add(end2);

    boneGroup.name = 'bone';
    return boneGroup;
  }

  public createBone(position: THREE.Vector3): Bone {
    const boneGroup = this.getBoneFromPool();
    if (!boneGroup) {
      console.warn('Could not get bone from pool, creating new one');
      return this.createBoneWithNewMesh();
    }

    boneGroup.position.copy(position);
    boneGroup.rotation.y = Math.random() * Math.PI * 2;
    boneGroup.visible = true;
    
    // Ensure the bone is in the scene
    if (!this.scene.getObjectById(boneGroup.id)) {
      this.scene.add(boneGroup);
    }
    
    const bone: Bone = {
      id: Math.random().toString(36).substr(2, 9),
      mesh: boneGroup,
      position: position.clone(),
      collected: false,
      timestamp: Date.now(),
      lastPosition: position.clone(),
      boundingBox: new THREE.Box3().setFromObject(boneGroup)
    };
    
    // Add to spatial grid immediately
    this.updateBoneSpatialPosition(bone);
    
    return bone;
  }

  private createBoneWithNewMesh(): Bone {
    const boneGroup = this.createBoneMesh();
    const position = new THREE.Vector3();
    
    // Try to find a valid position
    const margin = 5;
    const stageMargin = 10;
    let attempts = 50;
    
    while (attempts > 0) {
      position.set(
        (Math.random() - 0.5) * (this.STAGE_SIZE - stageMargin * 2),
        0.5,
        (Math.random() - 0.5) * (this.STAGE_SIZE - stageMargin * 2)
      );
      
      // Check for collisions with obstacles
      let validPosition = true;
      for (const object of this.collidableObjects) {
        const objectBox = new THREE.Box3().setFromObject(object);
        const objectCenter = new THREE.Vector3();
        objectBox.getCenter(objectCenter);
        
        if (position.distanceTo(objectCenter) < margin) {
          validPosition = false;
          break;
        }
      }
      
      if (validPosition) break;
      attempts--;
    }
    
    boneGroup.position.copy(position);
    boneGroup.rotation.y = Math.random() * Math.PI * 2;
    boneGroup.visible = true;
    this.scene.add(boneGroup);
    
    const bone: Bone = {
      id: Math.random().toString(36).substr(2, 9),
      mesh: boneGroup,
      position: position.clone(),
      collected: false,
      timestamp: Date.now(),
      lastPosition: position.clone(),
      boundingBox: new THREE.Box3().setFromObject(boneGroup)
    };
    
    return bone;
  }

  private spawnInitialBones() {
    // Clear any existing bones first
    this.bones.forEach(bone => {
      this.cleanupBone(bone);
    });
    this.bones = [];
    
    console.log('Spawning initial bones:', this.TARGET_BONES);
    const stageMargin = 10; // Distance from stage edges
    const positions: THREE.Vector3[] = [];

    // Create a grid of possible positions
    const gridSize = Math.ceil(Math.sqrt(this.TARGET_BONES * 2)); // Multiply by 2 to have more positions than needed
    const spacing = (this.STAGE_SIZE - stageMargin * 2) / gridSize;

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const xPos = -this.STAGE_SIZE/2 + stageMargin + x * spacing + Math.random() * spacing;
        const zPos = -this.STAGE_SIZE/2 + stageMargin + z * spacing + Math.random() * spacing;
        positions.push(new THREE.Vector3(xPos, 0.5, zPos));
      }
    }

    // Shuffle positions
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    // Use the first TARGET_BONES positions
    let bonesCreated = 0;
    for (let i = 0; i < positions.length && bonesCreated < this.TARGET_BONES; i++) {
      const bone = this.createBone(positions[i]);
      if (bone) {
        this.bones.push(bone);
        bonesCreated++;
      }
    }
    console.log('Total bones created:', this.bones.length);
  }

  createPlayer(name: string, colorIndex: number): Character {
    const player = new Character(false, colorIndex, name);
    const safePosition = this.findSafeRespawnLocation();
    player.state.position = new THREE.Vector3(
      safePosition.x,
      safePosition.y,
      safePosition.z
    );
    player.updateDogPosition();
    this.players.push(player);
    this.scene.add(player.dog);
    this.createNameTag(player, player.state.name);
    return player;
  }

  createAIDogs() {
    const availableNames = [...dogNames.names];
    
    for (let i = 1; i < 10; i++) {
      const nameIndex = Math.floor(Math.random() * availableNames.length);
      const name = availableNames.splice(nameIndex, 1)[0];
      
      const aiDog = new Character(true, i % Character.DOG_COLORS.length, name);
      const safePosition = this.findSafeRespawnLocation();
      aiDog.state.position = new THREE.Vector3(
        safePosition.x,
        safePosition.y,
        safePosition.z
      );
      aiDog.state.id = `ai_${i}`; // Add unique ID for AI dogs
      aiDog.updateDogPosition();
      
      this.players.push(aiDog);
      this.scene.add(aiDog.dog);
      this.createNameTag(aiDog, aiDog.state.name);
    }
  }

  createNameTag(character: Character, tagId: string) {
    const nameTag = document.createElement('div');
    nameTag.id = tagId;
    nameTag.style.position = 'absolute';
    nameTag.style.transform = 'translate(-50%, -50%)';
    nameTag.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    nameTag.style.color = 'white';
    nameTag.style.padding = '2px 6px';
    nameTag.style.borderRadius = '4px';
    nameTag.style.fontSize = '14px';
    nameTag.style.fontWeight = 'bold';
    nameTag.style.whiteSpace = 'nowrap';
    nameTag.style.pointerEvents = 'none';
    nameTag.textContent = `${character.state.name} (${character.state.bones})`;
    
    const container = document.querySelector('.nametags-container');
    if (container) {
      container.appendChild(nameTag);
      this.nameTags[character.state.name] = nameTag;
      
      // Initialize cache for this character
      this.nameTagCache.set(character, {
        lastPosition: new THREE.Vector3(
          character.state.position.x,
          character.state.position.y,
          character.state.position.z
        ),
        lastBones: character.state.bones,
        lastScreenX: 0,
        lastScreenY: 0,
        lastHasWon: character.state.hasWon
      });
    }
  }

  private updateNameTags(camera: THREE.Camera) {
    const tempVector = new THREE.Vector3();
    
    for (const player of this.players) {
      const nameTag = this.nameTags[player.state.name];
      if (!nameTag) continue;

      let cache = this.nameTagCache.get(player);
      if (!cache) {
        // Initialize cache if it doesn't exist
        cache = {
          lastPosition: new THREE.Vector3(
            player.state.position.x,
            player.state.position.y,
            player.state.position.z
          ),
          lastBones: player.state.bones,
          lastScreenX: 0,
          lastScreenY: 0,
          lastHasWon: player.state.hasWon
        };
        this.nameTagCache.set(player, cache);
      }

      // Get current world position
      tempVector.set(
        player.state.position.x,
        player.state.position.y + 1.5 + player.state.size,
        player.state.position.z
      );
      tempVector.project(camera);

      // Hide nametag if behind camera or too far away
      if (tempVector.z > 1) {
        nameTag.style.display = 'none';
        continue;
      }

      // Calculate screen coordinates
      const x = (tempVector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-tempVector.y * 0.5 + 0.5) * window.innerHeight;

      // Hide if outside screen bounds with some padding
      if (x < -100 || x > window.innerWidth + 100 || 
          y < -100 || y > window.innerHeight + 100) {
        nameTag.style.display = 'none';
        continue;
      }

      // Show nametag if it was previously hidden
      nameTag.style.display = '';

      // Check if position has changed significantly (using small threshold for floating point comparison)
      const positionChanged = !cache.lastPosition.equals(tempVector) ||
        Math.abs(cache.lastScreenX - x) > 0.1 ||
        Math.abs(cache.lastScreenY - y) > 0.1;

      // Check if other properties have changed
      const bonesChanged = cache.lastBones !== player.state.bones;
      const winStateChanged = cache.lastHasWon !== player.state.hasWon;

      // Only update DOM if necessary
      if (positionChanged) {
        nameTag.style.transform = `translate(${x}px, ${y}px)`;
        cache.lastScreenX = x;
        cache.lastScreenY = y;
        cache.lastPosition.copy(tempVector);
      }

      if (bonesChanged || winStateChanged) {
        nameTag.textContent = `${player.state.name} (${player.state.bones}${player.state.hasWon ? ' - WINNER!' : ''})`;
        cache.lastBones = player.state.bones;
        cache.lastHasWon = player.state.hasWon;
      }
    }
  }

  getPlatforms() {
    return this.platforms;
  }

  private createDroppingBone(position: THREE.Vector3, velocity: THREE.Vector3): DroppingBone | undefined {
    const bone = this.createBone(position);
    bone.lifespan = 12000; // 12 seconds total: 10 seconds visible + 2 seconds blinking
    
    // Ensure the bone is properly tracked in the scene
    if (!this.scene.getObjectById(bone.mesh.id)) {
      this.scene.add(bone.mesh);
    }
    
    return {
      ...bone,
      velocity: velocity,
      rotationSpeed: new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5
      ),
      dropTimer: this.BONE_DROP_DURATION,
      collectionDelay: 0.5 // Half second delay before bones can be collected
    };
  }

  public findSafeRespawnLocation(): THREE.Vector3 {
    const margin = 7; // Increased minimum distance from other objects
    const maxAttempts = 100; // Increased max attempts
    const gridSize = 10; // Number of grid sections to try
    
    // Try random positions first
    for (let attempt = 0; attempt < maxAttempts / 2; attempt++) {
      // Generate random position within bounds, avoiding the very edges
      const position = new THREE.Vector3(
        (Math.random() - 0.5) * (this.STAGE_SIZE - 30),
        0.5,
        (Math.random() - 0.5) * (this.STAGE_SIZE - 30)
      );

      if (this.isPositionSafe(position, margin)) {
        return position;
      }
    }

    // If random attempts fail, try grid-based approach
    const sectionSize = (this.STAGE_SIZE - 30) / gridSize;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const position = new THREE.Vector3(
          (-this.STAGE_SIZE / 2 + 15 + x * sectionSize + Math.random() * sectionSize),
          0.5,
          (-this.STAGE_SIZE / 2 + 15 + z * sectionSize + Math.random() * sectionSize)
        );

        if (this.isPositionSafe(position, margin)) {
          return position;
        }
      }
    }

    // If all else fails, return a default safe position
    return new THREE.Vector3(0, 0.5, 0);
  }

  private isPositionSafe(position: THREE.Vector3, margin: number): boolean {
    // Check distance from all collidable objects
    for (const object of this.collidableObjects) {
        const objectBox = new THREE.Box3().setFromObject(object);
        const objectCenter = new THREE.Vector3();
        objectBox.getCenter(objectCenter);
        
        if (position.distanceTo(objectCenter) < margin) {
            return false;
        }
    }

    // Check distance from other players
    for (const player of this.players) {
        if (!player.state.isDying) {
            const playerPos = new THREE.Vector3(
                player.state.position.x,
                player.state.position.y,
                player.state.position.z
            );
            if (position.distanceTo(playerPos) < margin) {
                return false;
            }
        }
    }

    // Check if position is within stage bounds
    if (Math.abs(position.x) > this.STAGE_SIZE / 2 - 10 || 
        Math.abs(position.z) > this.STAGE_SIZE / 2 - 10) {
        return false;
    }

    return true;
  }

  private cleanupObject(object: THREE.Object3D) {
    // Recursively dispose of geometries and materials
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
    
    // Remove from parent (scene)
    object.parent?.remove(object);
  }

  private initSpatialGrid() {
    this.spatialGrid = Array(this.GRID_SIZE).fill(null).map(() => 
      Array(this.GRID_SIZE).fill(null).map(() => new Set<Bone>())
    );
  }

  private getGridCoordinates(position: { x: number; y: number; z: number }) {
    const x = Math.floor((position.x + this.STAGE_SIZE / 2) / this.CELL_SIZE);
    const z = Math.floor((position.z + this.STAGE_SIZE / 2) / this.CELL_SIZE);
    return {
      x: Math.max(0, Math.min(x, this.GRID_SIZE - 1)),
      z: Math.max(0, Math.min(z, this.GRID_SIZE - 1))
    };
  }

  private updateBoneSpatialPosition(bone: Bone) {
    // Remove from all cells first
    for (const row of this.spatialGrid) {
      for (const cell of row) {
        cell.delete(bone);
      }
    }

    if (bone.collected) {
      return;
    }

    // Initialize lastPosition if it doesn't exist
    if (!bone.lastPosition) {
      bone.lastPosition = bone.position.clone();
    }

    // Always add to current position's grid cell
    const { x, z } = this.getGridCoordinates(bone.position);
    this.spatialGrid[x][z].add(bone);

    // Only update bounding box if position has changed
    if (!bone.position.equals(bone.lastPosition)) {
      if (!bone.boundingBox) {
        bone.boundingBox = new THREE.Box3();
      }
      bone.boundingBox.setFromObject(bone.mesh);
    }

    // Update lastPosition
    bone.lastPosition.copy(bone.position);
  }

  private getNearbyBones(playerPos: { x: number; y: number; z: number }): Bone[] {
    // Convert grid coordinates
    const { x: gridX, z: gridZ } = this.getGridCoordinates(playerPos);
    
    // Get bones from surrounding cells
    const nearbyBones: Bone[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const x = gridX + dx;
        const z = gridZ + dz;
        if (x >= 0 && x < this.GRID_SIZE && z >= 0 && z < this.GRID_SIZE) {
          this.spatialGrid[x][z].forEach(bone => {
            if (!bone.collected) {
              nearbyBones.push(bone);
            }
          });
        }
      }
    }
    return nearbyBones;
  }

  private updatePlayerBoundingBox(player: Character): THREE.Box3 {
    let cache = this.playerCache.get(player);
    const currentPosition = new THREE.Vector3(
      player.state.position.x,
      player.state.position.y,
      player.state.position.z
    );
    
    // Check if we need to create or update the cache
    if (!cache || 
        !cache.lastPosition.equals(currentPosition) || 
        cache.lastSize !== player.state.size) {
      
      // Create new cache if it doesn't exist
      if (!cache) {
        cache = {
          boundingBox: new THREE.Box3(),
          lastPosition: currentPosition.clone(),
          lastSize: player.state.size
        };
        this.playerCache.set(player, cache);
      }

      // Update the bounding box with new dimensions
      const bodyWidth = 0.8 * player.state.size;
      const bodyHeight = 0.6 * player.state.size;
      const bodyLength = 1.2 * player.state.size;
      
      cache.boundingBox.min.set(
        currentPosition.x - bodyWidth/2,
        currentPosition.y,
        currentPosition.z - bodyLength/2
      );
      cache.boundingBox.max.set(
        currentPosition.x + bodyWidth/2,
        currentPosition.y + bodyHeight,
        currentPosition.z + bodyLength/2
      );

      // Update cache values
      cache.lastPosition.copy(currentPosition);
      cache.lastSize = player.state.size;
    }

    return cache.boundingBox;
  }

  private updateBones(deltaTime: number) {
    // Update spatial grid for all bones
    [...this.bones, ...this.droppingBones].forEach(bone => {
      if (!bone.collected) {
        // Update position from mesh before spatial grid update
        bone.position.copy(bone.mesh.position);
        this.updateBoneSpatialPosition(bone);

        // Spin uncollected bones
        if (!bone.collected) {
          bone.mesh.rotation.y += deltaTime * 2; // Spin at 2 radians per second
        }

        // Check for expired bones
        if (bone.lifespan) {
          const timeLeft = bone.lifespan - (Date.now() - bone.timestamp);
          
          // Start blinking in the last 2 seconds
          if (timeLeft <= 2000) {
            // Get all meshes in the bone group
            if (timeLeft <= 0) {
              bone.collected = true;
              this.cleanupBone(bone);
            } else {
              // Blink faster as time runs out
              const blinkSpeed = Math.max(50, timeLeft / 10);
              const shouldBeVisible = Math.floor(Date.now() / blinkSpeed) % 2 === 0;
              
              // Update the shared blinking material's opacity
              Stage.boneBlinkingMaterial.opacity = shouldBeVisible ? 
                (timeLeft / 2000) : 0;

              // Apply blinking material if not already applied
              bone.mesh.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material !== Stage.boneBlinkingMaterial) {
                  child.material = Stage.boneBlinkingMaterial;
                }
              });
            }
          }
        }
      }
    });

    // Update player bounding boxes only when needed
    for (const player of this.players) {
      if (!player.state.isDying) {
        this.updatePlayerBoundingBox(player);
      }
    }

    // Update dropping bones physics
    const remainingBones: DroppingBone[] = [];
    for (const bone of this.droppingBones) {
      // Skip if already collected
      if (bone.collected) {
        continue;
      }

      // Update collection delay
      if (bone.collectionDelay !== undefined) {
        bone.collectionDelay = Math.max(0, bone.collectionDelay - deltaTime);
      }

      // Apply gravity to velocity
      bone.velocity.y -= this.GRAVITY * deltaTime;

      // Update position with boundary checks
      const nextX = bone.mesh.position.x + bone.velocity.x * deltaTime;
      const nextZ = bone.mesh.position.z + bone.velocity.z * deltaTime;
      const nextY = bone.mesh.position.y + bone.velocity.y * deltaTime;

      // Check X boundaries
      if (nextX > 45 || nextX < -45) {
        bone.velocity.x *= -0.6;
        bone.mesh.position.x = nextX > 45 ? 45 : -45;
      } else {
        bone.mesh.position.x = nextX;
      }

      // Check Z boundaries
      if (nextZ > 45 || nextZ < -45) {
        bone.velocity.z *= -0.6;
        bone.mesh.position.z = nextZ > 45 ? 45 : -45;
      } else {
        bone.mesh.position.z = nextZ;
      }

      // Check for platform collisions
      let hasLanded = false;
      let landingY = 0.5;

      const rayStart = new THREE.Vector3(bone.mesh.position.x, bone.mesh.position.y, bone.mesh.position.z);
      const rayDir = new THREE.Vector3(0, -1, 0);
      const raycaster = new THREE.Raycaster(rayStart, rayDir);
      
      const platformIntersects = raycaster.intersectObjects(this.platforms);
      if (platformIntersects.length > 0 && nextY <= platformIntersects[0].point.y + 0.5) {
        hasLanded = true;
        landingY = platformIntersects[0].point.y + 0.5;
      } else if (nextY <= 0.5) {
        hasLanded = true;
        landingY = 0.5;
      }

      if (hasLanded) {
        bone.mesh.position.y = landingY;
        bone.velocity.set(0, 0, 0);
        bone.rotationSpeed.set(0, 1, 0);
        bone.position.copy(bone.mesh.position);
        
        // Only add to regular bones if not in collection delay and not already collected
        if ((!bone.collectionDelay || bone.collectionDelay <= 0) && !bone.collected) {
          const landedBone: Bone = {
            id: bone.id,
            mesh: bone.mesh,
            position: bone.position.clone(),
            collected: false,
            timestamp: bone.timestamp,
            lifespan: bone.lifespan
          };
          this.bones.push(landedBone);
        } else {
          remainingBones.push(bone);
        }
      } else {
        bone.mesh.position.y = nextY;
        bone.mesh.rotation.x += bone.rotationSpeed.x * deltaTime;
        bone.mesh.rotation.y += bone.rotationSpeed.y * deltaTime;
        bone.mesh.rotation.z += bone.rotationSpeed.z * deltaTime;
        remainingBones.push(bone);
      }

      if (!bone.collected) {
        this.updateBoneSpatialPosition(bone);
      }
    }
    this.droppingBones = remainingBones;

    // Use cached bounding boxes for collision detection
    for (const player of this.players) {
      if (!player.state.isDying && !player.state.isHit && player.state.knockbackTime <= 0) {
        const playerBox = this.updatePlayerBoundingBox(player);
        if (!playerBox) continue;

        const nearbyBones = this.getNearbyBones(player.state.position);

        for (const bone of nearbyBones) {
          if (!bone.collected && 
              bone.mesh && 
              bone.mesh.id && 
              this.scene.getObjectById(bone.mesh.id) && 
              (!('collectionDelay' in bone) || ((bone as DroppingBone).collectionDelay ?? 0) <= 0)) {
            
            const boneRadius = 0.3;
            const bonePosition = bone.mesh.position;
            
            const sphereIntersectsBox = (
              bonePosition.x + boneRadius >= playerBox.min.x &&
              bonePosition.x - boneRadius <= playerBox.max.x &&
              bonePosition.y + boneRadius >= playerBox.min.y &&
              bonePosition.y - boneRadius <= playerBox.max.y &&
              bonePosition.z + boneRadius >= playerBox.min.z &&
              bonePosition.z - boneRadius <= playerBox.max.z
            );

            if (sphereIntersectsBox) {
              bone.collected = true;
              this.cleanupBone(bone);
              player.collectBone();
              
              // Notify server about collected bone
              const networkManager = NetworkManager.getInstance();
              if (networkManager && networkManager.isConnected()) {
                networkManager.updatePlayerState({
                  id: player.state.id,
                  bones: player.state.bones,
                  size: player.state.size
                });
              }

              if (player.state.bones >= 100) {
                player.state.bones = 100;
                player.state.hasWon = true;
                player.updateDogPosition();
              }
            }
          }
        }
      }
    }
  }

  private cleanupBone(bone: Bone) {
    this.returnBoneToPool(bone.mesh as THREE.Group);
    this.scene.remove(bone.mesh);
    this.boneBoundingBoxes.delete(bone);
    // Remove from spatial grid
    for (const row of this.spatialGrid) {
      for (const cell of row) {
        cell.delete(bone);
      }
    }
    bone.collected = true;
  }

  private initSpawnLocations() {
    // Clear existing spawn locations
    this.spawnLocations = [];
    this.totalSpawnWeight = 0;

    // Add ground level spawn points
    const groundSpawnPoints = 20;
    const groundRadius = 20;
    for (let i = 0; i < groundSpawnPoints; i++) {
      const angle = (i / groundSpawnPoints) * Math.PI * 2;
      const x = Math.cos(angle) * groundRadius;
      const z = Math.sin(angle) * groundRadius;
      this.spawnLocations.push({
        position: new THREE.Vector3(x, 0.5, z),
        weight: 1
      });
      this.totalSpawnWeight += 1;
    }

    // Add platform spawn points
    for (const platform of this.platforms) {
      const box = new THREE.Box3().setFromObject(platform);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      // Add spawn points on the platform
      const spawnPoints = Math.max(1, Math.floor((size.x * size.z) / 4));
      for (let i = 0; i < spawnPoints; i++) {
        const x = center.x + (Math.random() - 0.5) * (size.x - 1);
        const z = center.z + (Math.random() - 0.5) * (size.z - 1);
        this.spawnLocations.push({
          position: new THREE.Vector3(x, center.y + size.y / 2 + 0.5, z),
          weight: 1.5 // Higher weight for platform spawns
        });
        this.totalSpawnWeight += 1.5;
      }
    }
  }

  // Add new reset method
  reset() {
    // Clear all bones
    for (const bone of [...this.bones, ...this.droppingBones]) {
      this.cleanupBone(bone);
    }
    this.bones = [];
    this.droppingBones = [];
    this.activeBones.clear();

    // Reset all players
    for (const player of this.players) {
      player.state.bones = 0;
      player.state.hasWon = false;
      player.state.size = 1;
      player.state.isDying = false;
      player.state.isHit = false;
      player.state.knockbackTime = 0;
      player.state.biteTimer = 0;
      
      // Find new spawn position
      const safePosition = this.findSafeRespawnLocation();
      player.state.position = {
        x: safePosition.x,
        y: safePosition.y,
        z: safePosition.z
      };
      player.updateDogPosition();
    }

    // Reinitialize spatial grid
    this.initSpatialGrid();

    // Respawn initial bones
    this.spawnInitialBones();
  }

  update(deltaTime: number, _keys: { [key: string]: boolean }, camera: THREE.Camera) {
    // Update TWEEN animations
    TWEEN.update();

    // Check for winner first
    const hasWinner = this.players.some(player => player.state.hasWon);
    if (hasWinner) {
      // Only update nametags when game is frozen
      this.updateNameTags(camera);
      return; // Exit early to freeze all game activity
    }

    // Filter out collected bones first
    this.bones = this.bones.filter(bone => !bone.collected);
    this.droppingBones = this.droppingBones.filter(bone => !bone.collected);

    // Count only permanent bones (ones without lifespan and not collected)
    const permanentBones = this.bones.filter(bone => !bone.lifespan && !bone.collected).length;
    
    // Always spawn new permanent bones if we're below target and no winner
    if (permanentBones < this.TARGET_BONES && !hasWinner) {
      const bonesToSpawn = this.TARGET_BONES - permanentBones;
      for (let i = 0; i < bonesToSpawn; i++) {
        const position = this.findSafeRespawnLocation();
        const bone = this.createBone(position);
        if (bone) {
          this.bones.push(bone);
        }
      }
    }

    // Update bones with optimized physics
    this.updateBones(deltaTime);

    // Cache bounding boxes for collision detection
    const collidableBoxes = this.collidableObjects.map(obj => new THREE.Box3().setFromObject(obj));

    // Create array of all bones for AI targeting
    const allBones = [...this.bones, ...this.droppingBones]
      .filter(bone => !bone.collected)
      .map(bone => bone.mesh);
    
    // IMPORTANT: We're not controlling any players here - just handling non-input updates
    // like collision detection. Player input is managed by Game.tsx for the local player only.
    
    // Process non-input physics and collisions for all players
    for (const player of this.players) {
      // Use empty keys for ALL players - no input handling in Stage
      const emptyKeys = {};
      
      if (player.state.isDying) {
        // Only handle dying animation
        player.update(emptyKeys, deltaTime, [], undefined, this.players);
      } else {
        const otherPlayers = this.players
          .filter(p => p !== player && !p.state.isDying)
          .map(p => p.dog);
        
        // Pass cached collidable boxes and bones to Character update method
        const allCollidables = [...this.collidableObjects, ...otherPlayers, ...allBones];
        const allBoxes = [...collidableBoxes, ...otherPlayers.map(obj => new THREE.Box3().setFromObject(obj))];
        
        // Set bone names for AI targeting
        allBones.forEach(bone => {
          if (!bone.name) bone.name = 'bone';
        });
        
        // Only process collision detection and physics
        player.update(emptyKeys, deltaTime, allCollidables, allBoxes, this.players);
      }
    }

    // Handle dying dogs and cleanup
    const deadDogs: Character[] = [];
    this.players = this.players.filter(player => {
      if (player.state.isDying && player.state.dyingTimer <= 0) {
        // Cleanup THREE.js objects
        this.cleanupObject(player.dog);
        
        // Remove nametag
        const nameTag = this.nameTags[player.state.name];
        if (nameTag) {
          nameTag.remove();
          delete this.nameTags[player.state.name];
        }
        
        deadDogs.push(player);
        return false;
      }
      return true;
    });

    // Respawn dead dogs with optimized object creation
    for (const deadDog of deadDogs) {
      setTimeout(() => {
        const safePosition = this.findSafeRespawnLocation();
        deadDog.respawn();
        deadDog.state.position = {
          x: safePosition.x,
          y: safePosition.y,
          z: safePosition.z
        };
        deadDog.updateDogPosition();
        this.scene.add(deadDog.dog);
        this.players.push(deadDog);
        this.createNameTag(deadDog, deadDog.state.name);
      }, this.RESPAWN_DELAY * 1000);
    }

    // Replace the existing nametag update code with the new optimized version
    this.updateNameTags(camera);

    // Optimized collision detection between players using cached bounding boxes
    for (const attacker of this.players) {
      // Only check for bites when the dog is actively biting
      if (attacker.state.isBiting && attacker.state.biteTimer > 0) {
        const biteBox = attacker.bite();
        
        // Expand the bite box slightly to make detection more forgiving
        biteBox.expandByScalar(1.0);

        for (const victim of this.players) {
          // Prevent hitting if: self-bite, dying, or currently in hit sequence
          if (attacker !== victim && 
              !victim.state.isDying && 
              !victim.state.isHit && 
              victim.state.knockbackTime <= 0) {
            
            const victimBox = this.updatePlayerBoundingBox(victim);
            if (!victimBox) continue;

            // Calculate distance between attacker and victim for more precise detection
            const attackerPos = new THREE.Vector3(
              attacker.state.position.x,
              attacker.state.position.y,
              attacker.state.position.z
            );
            const victimPos = new THREE.Vector3(
              victim.state.position.x,
              victim.state.position.y,
              victim.state.position.z
            );
            const distance = attackerPos.distanceTo(victimPos);

            // Calculate forward vector of attacker
            const forwardX = -Math.sin(attacker.state.rotation);
            const forwardZ = -Math.cos(attacker.state.rotation);
            const forward = new THREE.Vector3(forwardX, 0, forwardZ);

            // Calculate vector to victim
            const toVictim = new THREE.Vector3()
              .subVectors(victimPos, attackerPos)
              .normalize();

            // Check if victim is in front of attacker (dot product > 0)
            const dotProduct = forward.dot(toVictim);

            // Check both box intersection and distance, and ensure victim is in front
            const maxBiteDistance = (attacker.state.size + victim.state.size) * 1.2;
            if ((biteBox.intersectsBox(victimBox) || distance <= maxBiteDistance) && dotProduct > 0.5) {
              this.handleBiteCollision(attacker, victim);
              // Stop checking for more victims and stop attacker's bite
              attacker.state.biteTimer = 0;
              break;
            }
          }
        }
      }
    }
  }

  private handleBiteCollision(attacker: Character, victim: Character) {
    // Set hit state immediately to prevent multiple hits
    victim.state.isHit = true;
    victim.state.hitTimer = 0.5; // Half second hit flash duration

    // Always play bite sound and flash immediately
    AudioManager.getInstance().playBiteSound();
    
    // Flash the victim's model to indicate hit
    const victimMesh = victim.dog.children[0] as THREE.Mesh;
    const victimMaterial = victimMesh.material as THREE.MeshPhongMaterial;
    if (victimMaterial) {
      const originalColor = victimMaterial.color.clone();
      victimMaterial.color.setHex(0xff0000); // Flash red
      setTimeout(() => {
        victimMaterial.color.copy(originalColor);
      }, 100);
    }

    // Apply knockback immediately
    victim.applyKnockback(attacker, 7.0);

    // Only prevent bone dropping if victim is dying
    if (victim.state.isDying) {
      return;
    }

    let droppedBones = 0;

    // Handle bone dropping logic
    if (victim.state.bones === 0) {
      droppedBones = victim.dropAllBones();
    } else if (attacker.state.bones >= victim.state.bones) {
      if (victim.state.bones > 0) {
        droppedBones = victim.dropAllBones();
      } else {
        victim.dropAllBones(); // This will trigger the death animation even with 0 bones
      }
    } else {
      const dropPercentage = 0.25 + Math.random() * 0.15; // Drop 25-40% of bones
      const bonesToDrop = Math.min(Math.ceil(victim.state.bones * dropPercentage), 10); // Cap at 10 bones
      if (bonesToDrop > 0) {
        droppedBones = victim.dropSomeBones(bonesToDrop);
      }
    }

    // Create bone explosion if any bones were dropped
    if (droppedBones > 0) {
      const victimPos = new THREE.Vector3(
        victim.state.position.x,
        victim.state.position.y,
        victim.state.position.z
      );
      this.createBonePile(victimPos, droppedBones, 5);
    }

    // Update nametag with new stats
    const nameTag = this.nameTags[victim.state.name];
    if (nameTag) {
      nameTag.textContent = `${victim.state.name} (${victim.state.bones})`;
    }
  }

  // Helper method to create bone piles
  private createBonePile(position: THREE.Vector3, count: number, baseVelocity: number) {
    const actualCount = Math.min(count, this.MAX_EXPLOSION_BONES);
    
    for (let i = 0; i < actualCount; i++) {
      const angle = (i / actualCount) * Math.PI * 2;
      const randomRadius = Math.random() * 0.5 + 0.5;
      
      const velocity = new THREE.Vector3(
        Math.cos(angle) * baseVelocity * randomRadius,
        baseVelocity * 2,
        Math.sin(angle) * baseVelocity * randomRadius
      );

      const bone = this.createDroppingBone(position.clone(), velocity);
      
      if (bone) {
        this.droppingBones.push(bone);
      }
    }
  }

  createPowerUp(type: string, position: THREE.Vector3): PowerUp {
    const powerUp = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      mesh: new THREE.Mesh(),
      position: position.clone()
    };
    this.powerUps.push(powerUp);
    return powerUp;
  }

  createAIDog(colorIndex: number) {
    const aiDog = new Character(true, colorIndex);
    this.aiDogs.push(aiDog);
    this.scene.add(aiDog.dog);
    return aiDog;
  }

  public updateBonePosition(bone: Bone, position: THREE.Vector3) {
    bone.position.copy(position);
    bone.mesh.position.copy(position);
  }

  public updateBounds(min: THREE.Vector3, max: THREE.Vector3) {
    // Update clipping planes for the stage boundaries
    this.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), max.x),   // Right wall
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), -min.x), // Left wall
      new THREE.Plane(new THREE.Vector3(0, 0, 1), max.z),   // Front wall
      new THREE.Plane(new THREE.Vector3(0, 0, -1), -min.z)  // Back wall
    ];

    // Update any materials that use clipping planes
    this.updateMaterialClipping();
  }

  private updateMaterialClipping() {
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.Material;
        if (material) {
          material.clippingPlanes = this.clippingPlanes;
          material.needsUpdate = true;
        }
      }
    });
  }

  // Initialize stage layout from server data
  public initializeFromServerLayout(serverLayout: any): void {
    if (this.isLayoutInitialized) {
      console.warn('Stage layout already initialized, ignoring server layout');
      return;
    }

    console.log('Initializing stage from server layout with seed:', serverLayout.seed);
    
    // Clear any existing layout
    this.clearExistingLayout();
    
    // Create trees from server layout
    serverLayout.trees.forEach((tree: any) => {
      this.createTree(tree.position.x, tree.position.z, tree.scale);
    });
    
    // Create rocks from server layout
    serverLayout.rocks.forEach((rock: any) => {
      this.createRock(rock.position.x, rock.position.z, rock.scale);
    });
    
    // Create platforms from server layout
    serverLayout.platforms.forEach((platform: any) => {
      this.createPlatform(
        platform.position.x,
        platform.position.y,
        platform.position.z,
        platform.width,
        platform.height,
        platform.depth
      );
    });
    
    // Create walls from server layout
    serverLayout.walls.forEach((wall: any) => {
      this.createWall(
        wall.position.x,
        wall.position.y,
        wall.position.z,
        wall.width,
        wall.height,
        wall.depth
      );
    });
    
    // Mark layout as initialized
    this.isLayoutInitialized = true;
    console.log('Stage layout initialized from server');
  }
  
  // Create a wall mesh for boundaries
  private createWall(x: number, y: number, z: number, width: number, height: number, depth: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshPhongMaterial({ 
      color: 0x808080, // Gray color to match original walls
      side: THREE.DoubleSide
    });
    
    const wall = new THREE.Mesh(geometry, material);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.name = "wall"; // Identify as a wall object
    
    this.scene.add(wall);
    return wall;
  }
  
  // Clear any existing layout elements
  private clearExistingLayout(): void {
    // Remove all existing environment objects
    this.collidableObjects.forEach(obj => {
      this.scene.remove(obj);
    });
    this.collidableObjects = [];
    
    // Clear platforms
    this.platforms.forEach(platform => {
      this.scene.remove(platform);
    });
    this.platforms = [];
  }
}