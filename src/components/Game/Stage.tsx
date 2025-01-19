import * as THREE from 'three';
import { Character } from './Character';
import AudioManager from '../../utils/AudioManager';
import dogNames from '../../data/dogNames.json';

interface Bone {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  collected: boolean;
}

interface DroppingBone extends Bone {
  velocity: THREE.Vector3;
  rotationSpeed: THREE.Vector3;
  dropTimer: number;
  collectionDelay?: number;
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
  private readonly MAX_BONES = 50;
  private readonly BONE_DROP_DURATION = 0.5;
  private readonly BONE_INITIAL_Y = 1.5;
  private readonly GRAVITY = 9.8;
  private readonly RESPAWN_DELAY = 3.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.createGround();
    this.createBoundaries();
    this.createEnvironment();
    this.createPlatforms();
    this.spawnInitialBones();
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
    for (let i = 0; i < maxAttempts; i++) {
      const position = new THREE.Vector3(
        (Math.random() - 0.5) * (this.STAGE_SIZE - radius * 2),
        0,
        (Math.random() - 0.5) * (this.STAGE_SIZE - radius * 2)
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

  private createBone(): Bone {
    // Create a group for the bone
    const boneGroup = new THREE.Group();
    const boneMaterial = new THREE.MeshPhongMaterial({ color: 0xFFFFFF });

    // Create the middle part (shaft)
    const shaftGeometry = new THREE.BoxGeometry(0.2, 0.15, 0.5);
    const shaft = new THREE.Mesh(shaftGeometry, boneMaterial);
    boneGroup.add(shaft);

    // Create the end parts (knobs)
    const knobGeometry = new THREE.BoxGeometry(0.4, 0.25, 0.25);
    
    const knob1 = new THREE.Mesh(knobGeometry, boneMaterial);
    knob1.position.z = 0.25;
    boneGroup.add(knob1);

    const knob2 = new THREE.Mesh(knobGeometry, boneMaterial);
    knob2.position.z = -0.25;
    boneGroup.add(knob2);

    // Random position within stage bounds
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * (this.STAGE_SIZE - 10),
      0.5,
      (Math.random() - 0.5) * (this.STAGE_SIZE - 10)
    );
    
    boneGroup.position.copy(position);
    boneGroup.rotation.y = Math.random() * Math.PI * 2; // Random initial rotation
    
    // Add shadows
    boneGroup.children.forEach(part => {
      part.castShadow = true;
    });
    
    this.scene.add(boneGroup);

    return {
      mesh: boneGroup,
      position: position,
      collected: false
    };
  }

  private spawnInitialBones() {
    for (let i = 0; i < this.MAX_BONES; i++) {
      this.bones.push(this.createBone());
    }
  }

  createPlayer(name: string, colorIndex: number): Character {
    const player = new Character(false, colorIndex, name);
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
      const position = this.findSafeRespawnLocation();
      
      // Get a random name from the available pool
      const nameIndex = Math.floor(Math.random() * availableNames.length);
      const name = availableNames.splice(nameIndex, 1)[0];
      
      const aiDog = new Character(true, i, name);
      aiDog.state.position = {
        x: position.x,
        y: position.y,
        z: position.z
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
    }
  }

  getPlatforms() {
    return this.platforms;
  }

  private createDroppingBone(position: THREE.Vector3, velocity: THREE.Vector3): DroppingBone {
    const bone = this.createBone();
    bone.mesh.position.copy(position);
    bone.mesh.position.y = this.BONE_INITIAL_Y;
    
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

  private updateDroppingBones(deltaTime: number) {
    const remainingBones: DroppingBone[] = [];
    const STAGE_BOUND = 45; // Match the boundary used in Character.tsx
    const WALL_ELASTICITY = 0.6; // How bouncy the walls are

    for (const bone of this.droppingBones) {
      // Update collection delay
      if (bone.collectionDelay !== undefined) {
        bone.collectionDelay = Math.max(0, bone.collectionDelay - deltaTime);
      }

      // Apply gravity to velocity
      bone.velocity.y -= this.GRAVITY * deltaTime;

      // Update position with boundary checks
      const nextX = bone.mesh.position.x + bone.velocity.x * deltaTime;
      const nextZ = bone.mesh.position.z + bone.velocity.z * deltaTime;

      // Check X boundaries
      if (nextX > STAGE_BOUND || nextX < -STAGE_BOUND) {
        bone.velocity.x *= -WALL_ELASTICITY; // Reverse and dampen X velocity
        bone.mesh.position.x = nextX > STAGE_BOUND ? STAGE_BOUND : -STAGE_BOUND;
      } else {
        bone.mesh.position.x = nextX;
      }

      // Check Z boundaries
      if (nextZ > STAGE_BOUND || nextZ < -STAGE_BOUND) {
        bone.velocity.z *= -WALL_ELASTICITY; // Reverse and dampen Z velocity
        bone.mesh.position.z = nextZ > STAGE_BOUND ? STAGE_BOUND : -STAGE_BOUND;
      } else {
        bone.mesh.position.z = nextZ;
      }

      // Update Y position
      bone.mesh.position.y += bone.velocity.y * deltaTime;

      // Apply rotation
      bone.mesh.rotation.x += bone.rotationSpeed.x * deltaTime;
      bone.mesh.rotation.y += bone.rotationSpeed.y * deltaTime;
      bone.mesh.rotation.z += bone.rotationSpeed.z * deltaTime;

      // Check if bone has landed
      if (bone.mesh.position.y <= 0.5) {
        bone.mesh.position.y = 0.5;
        bone.velocity.set(0, 0, 0);
        // Keep a slow spin after landing
        bone.rotationSpeed.set(0, 1, 0); // Only spin around Y axis
        
        // Update the bone's stored position
        bone.position.copy(bone.mesh.position);
        
        // Add to regular bones once landed and collection delay is over
        if (!bone.collectionDelay || bone.collectionDelay <= 0) {
          this.bones.push({
            mesh: bone.mesh,
            position: bone.position,
            collected: false
          });
        } else {
          remainingBones.push(bone);
        }
      } else {
        // Keep bone if it hasn't landed yet
        remainingBones.push(bone);
      }
    }

    this.droppingBones = remainingBones;
  }

  private findSafeRespawnLocation(): THREE.Vector3 {
    const margin = 5; // Minimum distance from other objects
    const maxAttempts = 50;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Generate random position within bounds
      const position = new THREE.Vector3(
        (Math.random() - 0.5) * (this.STAGE_SIZE - 20),
        0.5,
        (Math.random() - 0.5) * (this.STAGE_SIZE - 20)
      );

      // Check distance from all collidable objects
      let isSafe = true;
      for (const object of this.collidableObjects) {
        const objectBox = new THREE.Box3().setFromObject(object);
        const objectCenter = new THREE.Vector3();
        objectBox.getCenter(objectCenter);
        
        if (position.distanceTo(objectCenter) < margin) {
          isSafe = false;
          break;
        }
      }

      // Check distance from other players
      for (const player of this.players) {
        if (!player.state.isDying && 
            position.distanceTo(new THREE.Vector3(
            player.state.position.x,
            player.state.position.y,
            player.state.position.z
            )) < margin) {
          isSafe = false;
          break;
        }
      }

      if (isSafe) {
        return position;
      }
    }

    // If no safe spot found, return a fallback position
    return new THREE.Vector3(0, 0.5, 0);
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

  private cleanupBone(bone: Bone) {
    this.cleanupObject(bone.mesh);
    bone.collected = true;
  }

  update(deltaTime: number, keys: { [key: string]: boolean }, camera: THREE.Camera) {
    // Cleanup collected bones first
    for (const bone of [...this.bones, ...this.droppingBones]) {
      if (bone.collected) {
        this.cleanupBone(bone);
      }
    }

    // Filter out collected bones
    this.bones = this.bones.filter(bone => !bone.collected);
    this.droppingBones = this.droppingBones.filter(bone => !bone.collected);

    // Spawn new bones if needed
    const totalBones = this.bones.length + this.droppingBones.length;
    const hasWinner = this.players.some(player => player.state.hasWon);
    
    if (totalBones < this.MAX_BONES && !hasWinner) {
      const bonesToSpawn = this.MAX_BONES - totalBones;
      for (let i = 0; i < bonesToSpawn; i++) {
        this.bones.push(this.createBone());
      }
    }

    // Update dropping bones with optimized physics
    this.updateDroppingBones(deltaTime);

    // Spin regular bones
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

    // Update nametags with cached world positions
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

    // Optimized collision detection between players using cached bounding boxes
    for (const attacker of this.players) {
      // Only check for bites when the dog is actively biting and not in hit state
      if (attacker.state.isBiting && attacker.state.biteTimer > 0) {
        const biteBox = attacker.bite();
        for (const victim of this.players) {
          // Only check collision if it's not self, victim isn't dying, and victim isn't in hit state or knockback
          if (attacker !== victim && 
              !victim.state.isDying && 
              !victim.state.isHit && 
              victim.state.knockbackTime <= 0) {
            const victimBox = playerBoundingBoxes.get(victim);
            if (victimBox && biteBox.intersectsBox(victimBox)) {
              this.handleBiteCollision(attacker, victim);
              // Stop checking for more victims and stop attacker's bite
              attacker.state.biteTimer = 0;
              break;
            }
          }
        }
      }
    }

    // Optimized bone collection using cached player bounding boxes
    const availableBones = [
      ...this.bones.filter(bone => !bone.collected),
      ...this.droppingBones.filter(bone => !bone.collected)
    ];

    for (const player of this.players) {
      if (!player.state.isDying && !player.state.isHit && player.state.knockbackTime <= 0) {
        const playerBox = playerBoundingBoxes.get(player);
        if (!playerBox) continue;

        for (const bone of availableBones) {
          if (!bone.collected && this.scene.getObjectById(bone.mesh.id)) {
            const boneBox = new THREE.Box3().setFromObject(bone.mesh);
            if (playerBox.intersectsBox(boneBox)) {
              bone.collected = true;
              this.cleanupBone(bone);
              player.collectBone();
            }
          }
        }
      }
    }
  }

  private handleBiteCollision(attacker: Character, victim: Character) {
    console.log('\n=== BITE COLLISION SEQUENCE START ===');
    
    // Play bite sound
    AudioManager.getInstance().playBiteSound();
    
    // Only prevent if victim is dying
    if (victim.state.isDying) {
      console.log('[Sequence] Victim is dying, ignoring bite');
      return;
    }

    console.log('[Initial State]');
    console.log(`Attacker: ${attacker.state.name} (Bones: ${attacker.state.bones}, Size: ${attacker.state.size.toFixed(2)})`);
    console.log(`Victim: ${victim.state.name} (Bones: ${victim.state.bones}, Size: ${victim.state.size.toFixed(2)})`);

    // Step 1: Handle bone dropping logic
    if (victim.state.bones === 0) {
      // If victim has no bones, they die immediately
      console.log('FATAL HIT - Victim has 0 bones');
      victim.dropAllBones();
    } else if (attacker.state.bones >= victim.state.bones) {
      // Bigger dog (more bones) attacks smaller dog (fewer bones) - fatal hit
      console.log('FATAL HIT - Dog with more bones attacked dog with fewer bones');
      const droppedBones = victim.state.bones;
      if (droppedBones > 0) {
        console.log(`[1.1] Dropping all ${droppedBones} bones`);
        const actualDroppedBones = victim.dropAllBones();
        console.log(`[1.2] Actually dropped ${actualDroppedBones} bones`);
        console.log(`[1.3] Creating bone explosion effect`);
        this.createBonePile(victim.state.position, actualDroppedBones, 5);
      } else {
        console.log('[1.1] Victim has no bones, starting death sequence');
        victim.dropAllBones(); // This will trigger the death animation even with 0 bones
      }
    } else {
      // Smaller dog (fewer bones) attacks bigger dog (more bones)
      console.log('PARTIAL HIT - Dog with fewer bones attacked dog with more bones');
      const dropPercentage = 0.25 + Math.random() * 0.15; // Drop 25-40% of bones
      const bonesToDrop = Math.ceil(victim.state.bones * dropPercentage);
      console.log(`[1.1] Calculated ${bonesToDrop} bones to drop (${(dropPercentage * 100).toFixed(1)}% of ${victim.state.bones})`);

      if (bonesToDrop > 0) {
        console.log('[1.2] Calling dropSomeBones');
        const actualDroppedBones = victim.dropSomeBones(bonesToDrop);
        console.log(`[1.3] Actually dropped ${actualDroppedBones} bones`);
        console.log(`[1.4] Victim now has ${victim.state.bones} bones and size ${victim.state.size.toFixed(2)}`);
        console.log('[1.5] Creating bone explosion effect');
        this.createBonePile(victim.state.position, actualDroppedBones, 5);
      }
    }

    // Step 2: Update nametag with new stats
    const nameTag = this.nameTags[victim.state.name];
    if (nameTag) {
      nameTag.textContent = `${victim.state.name} (${victim.state.bones})`;
    }

    // Step 3: Apply knockback and hit effects
    console.log('\n[Step 3] Applying knockback and hit effects');
    victim.applyKnockback(attacker, 7.0);

    console.log(`Victim: Bones=${victim.state.bones}, Size=${victim.state.size.toFixed(2)}, IsHit=${victim.state.isHit}, KnockbackTime=${victim.state.knockbackTime}, IsDying=${victim.state.isDying}`);
    console.log('=== BITE COLLISION SEQUENCE END ===\n');
  }

  // Helper method to create bone piles
  private createBonePile(position: { x: number, y: number, z: number }, count: number, baseVelocity: number) {
    console.log(`[createBonePile] Creating pile of ${count} bones at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
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
      this.droppingBones.push(bone);
    }
    console.log(`[createBonePile] Added ${count} bones to droppingBones array (total: ${this.droppingBones.length})`);
  }
}