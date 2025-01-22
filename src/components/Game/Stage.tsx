import * as THREE from 'three';
import { Character } from './Character';
import AudioManager from '../../utils/AudioManager';
import dogNames from '../../data/dogNames.json';
import TWEEN from '@tweenjs/tween.js';

interface Bone {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  lastPosition?: THREE.Vector3;
  collected: boolean;
  timestamp: number;
  lifespan?: number; // Optional lifespan in milliseconds
  boundingBox?: THREE.Box3; // Add cached bounding box
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

export class Stage {
  scene: THREE.Scene;
  bones: Bone[] = [];
  droppingBones: DroppingBone[] = [];
  players: Character[] = [];
  platforms: THREE.Mesh[] = [];
  collidableObjects: THREE.Object3D[] = [];
  nameTags: { [key: string]: HTMLDivElement } = {};
  private readonly STAGE_SIZE = 100;
  private readonly TARGET_BONES = 50;
  private readonly BONE_DROP_DURATION = 0.5;
  private readonly BONE_INITIAL_Y = 1.5;
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

  // Shared geometries and materials for bones
  private static boneGeometry: THREE.CylinderGeometry;
  private static boneEndGeometry: THREE.SphereGeometry;
  private static boneMaterial: THREE.MeshPhongMaterial;
  private static boneBlinkingMaterial: THREE.MeshPhongMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initSharedResources();
    this.createGround();
    this.createBoundaries();
    this.createEnvironment();
    this.createPlatforms();
    this.initBonePool();
    this.initSpawnLocations();
    this.initSpatialGrid();
    this.spawnInitialBones();
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

  private isPositionOccupied(position: THREE.Vector3, radius: number, existingPositions: Array<{ pos: THREE.Vector3, radius: number }>) {
    for (const existing of existingPositions) {
      const distance = position.distanceTo(existing.pos);
      if (distance < (radius + existing.radius + 2)) { // +2 for minimum spacing
        return true;
      }
    }
    return false;
  }

  private getRandomPosition(radius: number, existingPositions: Array<{ pos: THREE.Vector3, radius: number }>, maxAttempts = 50): THREE.Vector3 | null {
    const margin = radius + 2; // Add extra margin to ensure objects are not too close to boundaries
    for (let i = 0; i < maxAttempts; i++) {
      const position = new THREE.Vector3(
        (Math.random() - 0.5) * (this.STAGE_SIZE - margin * 2),
        0,
        (Math.random() - 0.5) * (this.STAGE_SIZE - margin * 2)
      );
      
      if (!this.isPositionOccupied(position, radius, existingPositions)) {
        return position;
      }
    }
    return null; // Could not find valid position
  }

  private createEnvironment() {
    const existingPositions: Array<{ pos: THREE.Vector3, radius: number }> = [];
    
    // Add trees (8 trees with random scales)
    for (let i = 0; i < 8; i++) {
      const scale = 1.7 + Math.random() * 0.6; // Random scale between 1.7 and 2.3
      const radius = 2 * scale; // Tree radius based on scale
      
      const position = this.getRandomPosition(radius, existingPositions);
      if (position) {
        this.createTree(position.x, position.z, scale);
        existingPositions.push({ pos: position, radius });
      }
    }

    // Add rocks (7 rocks with random scales)
    for (let i = 0; i < 7; i++) {
      const scale = 1.2 + Math.random() * 0.6; // Random scale between 1.2 and 1.8
      const radius = scale;
      
      const position = this.getRandomPosition(radius, existingPositions);
      if (position) {
        this.createRock(position.x, position.z, scale);
        existingPositions.push({ pos: position, radius });
      }
    }
  }

  private createPlatforms() {
    const existingPositions: Array<{ pos: THREE.Vector3, radius: number }> = [];
    const PLATFORM_HEIGHT = 2; // Lowered from 4 to 2 to be reachable with current jump height
    
    // Create 6 elevated platforms with standard height
    for (let i = 0; i < 6; i++) {
      const width = 4 + Math.random() * 4; // Random width between 4 and 8
      const depth = 4 + Math.random() * 4; // Random depth between 4 and 8
      const radius = Math.max(width, depth) / 2;
      
      const position = this.getRandomPosition(radius, existingPositions);
      if (position) {
        this.createPlatform(position.x, PLATFORM_HEIGHT, position.z, width, 1, depth);
        existingPositions.push({ pos: position, radius });
      }
    }
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
    for (let i = 0; i < this.BONE_POOL_SIZE; i++) {
      const bone = this.createBoneMesh();
      bone.visible = false;
      this.scene.add(bone);
      this.bonePool.push(bone);
    }
  }

  private getBoneFromPool(): THREE.Group | null {
    for (let bone of this.bonePool) {
      if (!bone.visible && !this.activeBones.has(bone)) {
        bone.visible = true;
        this.activeBones.add(bone);
        return bone;
      }
    }

    if (this.activeBones.size >= this.BONE_POOL_SIZE) {
      const oldestBone = this.activeBones.values().next().value;
      if (oldestBone) {
        this.activeBones.delete(oldestBone);
        oldestBone.visible = true;
        this.activeBones.add(oldestBone);
        return oldestBone;
      }
    }

    return null;
  }

  private returnBoneToPool(bone: THREE.Group) {
    bone.visible = false;
    bone.position.set(0, 0, 0);
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

  private createBone(): Bone {
    const boneGroup = this.getBoneFromPool();
    if (!boneGroup) {
      return this.createBoneWithNewMesh();
    }

    let position = new THREE.Vector3();
    let validPosition = false;
    let maxAttempts = 50;

    // Collect all possible spawn locations
    const spawnLocations: { position: THREE.Vector3, weight: number }[] = [];
    
    // Add platform spawn locations (with higher weight for platforms)
    for (const platform of this.platforms) {
      const platformBox = new THREE.Box3().setFromObject(platform);
      const platformTop = platformBox.max.y;
      
      // Add one spawn point per platform with moderate weight
      const platformSpawn = new THREE.Vector3(
        platformBox.min.x + Math.random() * (platformBox.max.x - platformBox.min.x),
        platformTop + 0.5,
        platformBox.min.z + Math.random() * (platformBox.max.z - platformBox.min.z)
      );
      spawnLocations.push({ position: platformSpawn, weight: 1.5 }); // Moderate weight for platforms
    }
    
    // Add ground spawn locations (increased number for better ground coverage)
    for (let i = 0; i < 8; i++) {
      const groundSpawn = new THREE.Vector3(
        (Math.random() - 0.5) * (this.STAGE_SIZE - 10), // Use fixed margin of 10 for bones
        0.5,
        (Math.random() - 0.5) * (this.STAGE_SIZE - 10)
      );
      spawnLocations.push({ position: groundSpawn, weight: 1.0 }); // Base weight for ground
    }

    // Shuffle and try spawn locations
    while (!validPosition && maxAttempts > 0) {
      // Select a spawn location based on weights
      const totalWeight = spawnLocations.reduce((sum, loc) => sum + loc.weight, 0);
      let randomWeight = Math.random() * totalWeight;
      let selectedSpawn = spawnLocations[0].position;
      
      for (const location of spawnLocations) {
        randomWeight -= location.weight;
        if (randomWeight <= 0) {
          selectedSpawn = location.position;
          break;
        }
      }
      
      position = selectedSpawn.clone();

      // Check for collisions with obstacles (trees and rocks)
      let hasCollision = false;
      const boneRadius = 0.5; // Approximate radius of the bone
      const margin = 5.0; // Increased margin to prevent bones from spawning too close to boundaries or obstacles

      for (const object of this.collidableObjects) {
        // Skip platforms in collision check since we want to spawn on them
        if (this.platforms.includes(object as THREE.Mesh)) continue;

        const objectBox = new THREE.Box3().setFromObject(object);
        const objectCenter = new THREE.Vector3();
        objectBox.getCenter(objectCenter);

        // Expand the object's bounds by the margin
        objectBox.expandByScalar(margin + boneRadius);

        // Check if the bone position would be inside the expanded bounds
        if (objectBox.containsPoint(position)) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        validPosition = true;
      }

      maxAttempts--;
    }

    // If no valid position found after max attempts, use a fallback position
    if (!validPosition) {
      position = new THREE.Vector3(0, 0.5, 0);
    }

    boneGroup.position.copy(position);
    boneGroup.rotation.y = Math.random() * Math.PI * 2; // Random initial rotation
    boneGroup.name = 'bone'; // Set name for identification
    
    this.scene.add(boneGroup);

    return {
      mesh: boneGroup,
      position: position.clone(),
      lastPosition: position.clone(),
      collected: false,
      timestamp: Date.now()
    };
  }

  private createBoneWithNewMesh(): Bone {
    const boneGroup = this.createBoneMesh();
    let position = new THREE.Vector3();
    let validPosition = false;
    let maxAttempts = 50;

    // Default position in case all attempts fail
    position = new THREE.Vector3(0, 0.5, 0);

    // Try to find a valid position
    while (!validPosition && maxAttempts > 0) {
        // Try a random position if spawn locations aren't initialized yet
        if (!this.spawnLocations.length) {
            position = new THREE.Vector3(
                (Math.random() - 0.5) * (this.STAGE_SIZE - 10),
                0.5,
                (Math.random() - 0.5) * (this.STAGE_SIZE - 10)
            );
            validPosition = true;
            break;
        }

        // Get random spawn location from available platforms
        let randomWeight = Math.random() * this.totalSpawnWeight;
        let selectedSpawn = this.spawnLocations[0].position;
        
        for (const location of this.spawnLocations) {
            randomWeight -= location.weight;
            if (randomWeight <= 0) {
                selectedSpawn = location.position;
                break;
            }
        }
        
        position = selectedSpawn.clone();

        // Check for collisions with obstacles
        let hasCollision = false;
        const boneRadius = 0.5;
        const margin = 1.0;

        for (const object of this.collidableObjects) {
            if (this.platforms.includes(object as THREE.Mesh)) continue;

            const objectBox = new THREE.Box3().setFromObject(object);
            const objectCenter = new THREE.Vector3();
            objectBox.getCenter(objectCenter);
            objectBox.expandByScalar(margin + boneRadius);

            if (objectBox.containsPoint(position)) {
                hasCollision = true;
                break;
            }
        }

        if (!hasCollision) {
            validPosition = true;
        }

        maxAttempts--;
    }

    boneGroup.position.copy(position);
    boneGroup.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(boneGroup);

    return {
        mesh: boneGroup,
        position: position.clone(),
        lastPosition: position.clone(),
        collected: false,
        timestamp: Date.now()
    };
  }

  private spawnInitialBones() {
    for (let i = 0; i < this.TARGET_BONES; i++) {
      this.bones.push(this.createBone());
    }
  }

  createPlayer(name: string, colorIndex: number): Character {
    const player = new Character(false, colorIndex, name);
    const safePosition = this.findSafeRespawnLocation();
    player.state.position = {
        x: safePosition.x,
        y: safePosition.y,
        z: safePosition.z
    };
    player.updateDogPosition();
    this.players.push(player);
    this.scene.add(player.dog);
    this.createNameTag(player);
    return player;
  }

  createAIDogs() {
    // Create a pool of available names
    const availableNames = [...dogNames.names];
    
    // Create AI dogs with more varied starting positions
    for (let i = 1; i < 10; i++) {
        // Get a random name from the available pool
        const nameIndex = Math.floor(Math.random() * availableNames.length);
        const name = availableNames.splice(nameIndex, 1)[0];
        
        const aiDog = new Character(true, i, name);
        const safePosition = this.findSafeRespawnLocation();
        aiDog.state.position = {
            x: safePosition.x,
            y: safePosition.y,
            z: safePosition.z
        };
        aiDog.updateDogPosition();
        this.players.push(aiDog);
        this.scene.add(aiDog.dog);
        this.createNameTag(aiDog);
    }
  }

  createNameTag(character: Character) {
    const nameTag = document.createElement('div');
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

  private createDroppingBone(position: THREE.Vector3, velocity: THREE.Vector3): DroppingBone {
    const bone = this.createBone();
    bone.mesh.position.copy(position);
    bone.mesh.position.y = this.BONE_INITIAL_Y;
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

  private findSafeRespawnLocation(): THREE.Vector3 {
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

    // If all else fails, find the position furthest from all objects
    let bestPosition = new THREE.Vector3(0, 0.5, 0);
    let maxMinDistance = 0;

    for (let attempt = 0; attempt < 20; attempt++) {
        const position = new THREE.Vector3(
            (Math.random() - 0.5) * (this.STAGE_SIZE - 30),
            0.5,
            (Math.random() - 0.5) * (this.STAGE_SIZE - 30)
        );

        let minDistance = Infinity;
        
        // Check distance from collidable objects
        for (const object of this.collidableObjects) {
            const objectBox = new THREE.Box3().setFromObject(object);
            const objectCenter = new THREE.Vector3();
            objectBox.getCenter(objectCenter);
            const distance = position.distanceTo(objectCenter);
            minDistance = Math.min(minDistance, distance);
        }

        // Check distance from other players
        for (const player of this.players) {
            if (!player.state.isDying) {
                const playerPos = new THREE.Vector3(
                    player.state.position.x,
                    player.state.position.y,
                    player.state.position.z
                );
                const distance = position.distanceTo(playerPos);
                minDistance = Math.min(minDistance, distance);
            }
        }

        if (minDistance > maxMinDistance) {
            maxMinDistance = minDistance;
            bestPosition = position;
        }
    }

    return bestPosition;
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

  private getGridCoordinates(position: THREE.Vector3): { x: number; z: number } {
    const halfSize = (this.GRID_SIZE * this.CELL_SIZE) / 2;
    const x = Math.floor((position.x + halfSize) / this.CELL_SIZE);
    const z = Math.floor((position.z + halfSize) / this.CELL_SIZE);
    return {
      x: Math.max(0, Math.min(this.GRID_SIZE - 1, x)),
      z: Math.max(0, Math.min(this.GRID_SIZE - 1, z))
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

  private getNearbyBones(position: THREE.Vector3, radius: number = this.CELL_SIZE): Bone[] {
    const { x, z } = this.getGridCoordinates(position);
    const nearbyBones: Bone[] = [];
    const searchRadius = Math.ceil(radius / this.CELL_SIZE);

    for (let i = -searchRadius; i <= searchRadius; i++) {
      for (let j = -searchRadius; j <= searchRadius; j++) {
        const gridX = x + i;
        const gridZ = z + j;
        
        if (gridX >= 0 && gridX < this.GRID_SIZE && gridZ >= 0 && gridZ < this.GRID_SIZE) {
          this.spatialGrid[gridX][gridZ].forEach(bone => {
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
          } else {
            // Ensure bone uses regular material during the first 10 seconds
            bone.mesh.traverse((child) => {
              if (child instanceof THREE.Mesh && child.material !== Stage.boneMaterial) {
                child.material = Stage.boneMaterial;
              }
            });
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

        const nearbyBones = this.getNearbyBones(new THREE.Vector3(
          player.state.position.x,
          player.state.position.y,
          player.state.position.z
        ));

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

  update(deltaTime: number, keys: { [key: string]: boolean }, camera: THREE.Camera) {
    // Update TWEEN animations
    TWEEN.update();

    // Check for winner first
    const hasWinner = this.players.some(player => player.state.hasWon);
    if (hasWinner) {
      // Only update nametags when game is frozen
      const tempVector = new THREE.Vector3();
      for (const player of this.players) {
        const nameTag = this.nameTags[player.state.name];
        if (nameTag) {
          tempVector.set(
            player.state.position.x,
            player.state.position.y + 1.5 + player.state.size,
            player.state.position.z
          );
          tempVector.project(camera);

          const x = (tempVector.x * 0.5 + 0.5) * window.innerWidth;
          const y = (-tempVector.y * 0.5 + 0.5) * window.innerHeight;

          nameTag.style.transform = `translate(${x}px, ${y}px)`;
          nameTag.textContent = `${player.state.name} (${player.state.bones}${player.state.hasWon ? ' - WINNER!' : ''})`;
        }
      }
      return; // Exit early to freeze all game activity
    }

    // Filter out collected bones first
    this.bones = this.bones.filter(bone => !bone.collected);
    this.droppingBones = this.droppingBones.filter(bone => !bone.collected);

    // Count only permanent bones (ones without lifespan and not collected)
    const permanentBones = this.bones.filter(bone => !bone.lifespan && !bone.collected).length;
    
    // Always spawn new permanent bones if we're below target and no winner
    if (permanentBones < this.TARGET_BONES && !hasWinner) {
      // Calculate exact number needed to reach target
      const bonesToSpawn = this.TARGET_BONES - permanentBones;
      
      // Spawn all needed bones immediately to maintain minimum
      for (let i = 0; i < bonesToSpawn; i++) {
        const newBone = this.createBone();
        // Ensure no lifespan for permanent bones
        delete newBone.lifespan;
        this.bones.push(newBone);
      }
    }

    // Update dropping bones with optimized physics
    this.updateBones(deltaTime);

    // Spin only uncollected bones
    for (const bone of this.bones) {
      if (!bone.collected) {
        bone.mesh.rotation.y += deltaTime;
      }
    }

    // Cache bounding boxes for collision detection
    const playerBoundingBoxes = new Map<Character, THREE.Box3>();
    const collidableBoxes = this.collidableObjects.map(obj => new THREE.Box3().setFromObject(obj));

    // Create array of all bones for AI targeting
    const allBones = [...this.bones, ...this.droppingBones].filter(bone => !bone.collected).map(bone => bone.mesh);

    // Update players with optimized collision checks
    for (const player of this.players) {
      if (player.state.isDying) {
        player.update(keys, deltaTime, [], undefined, this.players);
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
        
        player.update(keys, deltaTime, allCollidables, allBoxes, this.players);
        
        // Cache bounding box for later use
        playerBoundingBoxes.set(player, new THREE.Box3().setFromObject(player.dog));
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
        this.createNameTag(deadDog);
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
      this.createBonePile(victim.state.position, droppedBones, 5);
    }

    // Update nametag with new stats
    const nameTag = this.nameTags[victim.state.name];
    if (nameTag) {
      nameTag.textContent = `${victim.state.name} (${victim.state.bones})`;
    }
  }

  // Helper method to create bone piles
  private createBonePile(position: { x: number, y: number, z: number }, count: number, baseVelocity: number) {
    // Limit the number of bones to prevent pool exhaustion
    const actualCount = Math.min(count, this.MAX_EXPLOSION_BONES);
    
    for (let i = 0; i < actualCount; i++) {
      const angle = (i / actualCount) * Math.PI * 2;
      const randomRadius = Math.random() * 0.5 + 0.5;
      
      const velocity = new THREE.Vector3(
        Math.cos(angle) * baseVelocity * randomRadius,
        baseVelocity * 2,
        Math.sin(angle) * baseVelocity * randomRadius
      );

      const bone = this.createDroppingBone(
        new THREE.Vector3(position.x, position.y, position.z),
        velocity
      );
      if (bone) {
        this.droppingBones.push(bone);
      }
    }
  }
}