import * as THREE from 'three';
import AudioManager from '../../utils/AudioManager';
import dogNames from '../../data/dogNames.json';
import { AIController } from './AIController';

interface CharacterState {
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: number;
  size: number;
  bones: number;
  isBiting: boolean;
  biteTimer: number;
  isMoving: boolean;
  animationTime: number;
  color: THREE.Color;
  velocity: THREE.Vector3;
  knockbackTime: number;
  name: string;
  colorIndex: number;
  isHit: boolean;
  hitTimer: number;
  isDying: boolean;
  dyingTimer: number;
  hasWon: boolean;
  isJumping: boolean;
  jumpVelocity: number;
  barkCooldown: number;
}

export class Character {
  dog: THREE.Group;
  state: CharacterState;
  isAI: boolean;
  bodyGroup: THREE.Group = new THREE.Group();
  headGroup: THREE.Group = new THREE.Group();
  legs: THREE.Mesh[] = [];
  tail: THREE.Mesh = new THREE.Mesh();
  readonly MOVE_SPEED = 0.08;
  protected readonly ROTATION_SPEED = 0.1;
  readonly BITE_DURATION = 0.25;
  protected readonly MIN_SIZE = 1;
  protected readonly MAX_SIZE = 5;
  protected readonly GROWTH_PER_BONE = 0.021;
  protected readonly KNOCKBACK_DURATION = 0.5;
  protected readonly BITE_LUNGE_DISTANCE = 0.5;
  readonly AI_MOVE_SPEED_MULTIPLIER = 1.2;
  protected readonly BONES_TO_DROP = 3;
  protected readonly HIT_FLASH_DURATION = 0.2;
  protected readonly DEATH_ANIMATION_DURATION = 1.0;
  protected readonly KNOCKBACK_SPEED = 1.0;
  protected readonly TARGET_BONES = 190;
  readonly JUMP_FORCE = 0.2;
  readonly GRAVITY = 0.008;
  readonly GROUND_LEVEL = 0.5;
  protected readonly PLATFORM_LANDING_BUFFER = 0.3;
  readonly BARK_COOLDOWN = 2;
  private aiController: AIController | null = null;

  static readonly DOG_COLORS = [
    new THREE.Color(0x8B4513), // Brown
    new THREE.Color(0xD2691E), // Chocolate
    new THREE.Color(0xDEB887), // Burlywood
    new THREE.Color(0xF4A460), // Sandy Brown
    new THREE.Color(0xD2B48C), // Tan
    new THREE.Color(0xBC8F8F), // Rosy Brown
    new THREE.Color(0xF5DEB3), // Wheat
    new THREE.Color(0xFFE4B5), // Moccasin
    new THREE.Color(0xFFDEAD), // Navajo White
    new THREE.Color(0xFFA07A), // Light Salmon
    new THREE.Color(0x000000), // Black
    new THREE.Color(0xFFFFFF), // White
  ];

  constructor(isAI: boolean, colorIndex: number, name: string = isAI ? dogNames.names[Math.floor(Math.random() * dogNames.names.length)] : 'Player') {
    this.isAI = isAI;
    if (isAI) {
      this.aiController = new AIController(this);
    }
    this.state = {
      position: {
        x: 0,
        y: 0.5,
        z: 0
      },
      rotation: Math.random() * Math.PI * 2,
      size: this.MIN_SIZE,
      bones: 0,
      isBiting: false,
      biteTimer: 0,
      isMoving: false,
      animationTime: 0,
      color: Character.DOG_COLORS[colorIndex % Character.DOG_COLORS.length],
      velocity: new THREE.Vector3(),
      knockbackTime: 0,
      name: name,
      colorIndex: colorIndex,
      isHit: false,
      hitTimer: 0,
      isDying: false,
      dyingTimer: 0,
      hasWon: false,
      isJumping: false,
      jumpVelocity: 0,
      barkCooldown: 0,
    };

    this.dog = this.createDog();
    this.updateDogPosition();
  }

  private createDog(): THREE.Group {
    const group = new THREE.Group();
    this.bodyGroup = new THREE.Group();
    this.headGroup = new THREE.Group();

    // Body
    const bodyGeometry = new THREE.BoxGeometry(1, 0.6, 1.5);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: this.state.color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.5;
    body.castShadow = true;
    this.bodyGroup.add(body);

    // Head - moved to front of body
    this.headGroup.position.set(0, 0.7, 0.75);
    this.bodyGroup.add(this.headGroup);

    const headGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const head = new THREE.Mesh(headGeometry, bodyMaterial);
    head.castShadow = true;
    this.headGroup.add(head);

    // Snout - adjusted to point forward
    const snoutGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const snoutMaterial = new THREE.MeshPhongMaterial({ color: this.state.color.clone().multiplyScalar(0.8) });
    const snout = new THREE.Mesh(snoutGeometry, snoutMaterial);
    snout.position.set(0, 0, 0.3);
    snout.castShadow = true;
    this.headGroup.add(snout);

    // Ears - adjusted positions
    const earGeometry = new THREE.BoxGeometry(0.2, 0.3, 0.2);
    const earMaterial = new THREE.MeshPhongMaterial({ color: this.state.color.clone().multiplyScalar(0.8) });
    
    const leftEar = new THREE.Mesh(earGeometry, earMaterial);
    leftEar.position.set(0.25, 0.3, 0);
    leftEar.castShadow = true;
    this.headGroup.add(leftEar);

    const rightEar = new THREE.Mesh(earGeometry, earMaterial);
    rightEar.position.set(-0.25, 0.3, 0);
    rightEar.castShadow = true;
    this.headGroup.add(rightEar);

    // Legs - adjusted positions
    const legGeometry = new THREE.BoxGeometry(0.2, 0.5, 0.2);
    const legMaterial = new THREE.MeshPhongMaterial({ color: this.state.color.clone().multiplyScalar(0.9) });
    
    const legPositions = [
      { x: 0.35, y: 0.25, z: 0.5 },   // Front Right
      { x: -0.35, y: 0.25, z: 0.5 },  // Front Left
      { x: 0.35, y: 0.25, z: -0.5 },  // Back Right
      { x: -0.35, y: 0.25, z: -0.5 }  // Back Left
    ];

    legPositions.forEach(pos => {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      leg.position.set(pos.x, pos.y, pos.z);
      leg.castShadow = true;
      this.bodyGroup.add(leg);
      this.legs.push(leg);
    });

    // Tail - adjusted position
    const tailGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.4);
    const tailMaterial = new THREE.MeshPhongMaterial({ color: this.state.color.clone().multiplyScalar(0.9) });
    this.tail = new THREE.Mesh(tailGeometry, tailMaterial);
    this.tail.position.set(0, 0.6, -0.8);
    this.tail.rotation.x = -Math.PI / 4;
    this.tail.castShadow = true;
    this.bodyGroup.add(this.tail);

    // Rotate the entire body group 180 degrees so it faces forward
    this.bodyGroup.rotation.y = Math.PI;
    
    group.add(this.bodyGroup);
    return group;
  }

  updateDogPosition() {
    this.dog.position.set(
      this.state.position.x,
      this.state.position.y,
      this.state.position.z
    );
    
    // SIMPLE: Face where you're going. Period.
    this.dog.rotation.y = this.state.rotation;
    this.dog.scale.setScalar(this.state.size);
  }

  private animateIdle(deltaTime: number) {
    this.state.animationTime += deltaTime;
    
    // Gentle body bob
    this.bodyGroup.position.y = Math.sin(this.state.animationTime * 2) * 0.05;
    
    // Tail wag
    this.tail.rotation.z = Math.sin(this.state.animationTime * 3) * 0.2;
    
    // Reset leg positions
    this.legs.forEach(leg => {
      leg.position.y = 0.25;
    });
  }

  private animateWalking(deltaTime: number) {
    this.state.animationTime += deltaTime;
    
    // Body bob
    this.bodyGroup.position.y = Math.sin(this.state.animationTime * 8) * 0.1;
    
    // Tail wag
    this.tail.rotation.z = Math.sin(this.state.animationTime * 8) * 0.3;
    
    // Leg animation
    this.legs.forEach((leg, index) => {
      const offset = index * Math.PI / 2;
      const legAngle = this.state.animationTime * 8 + offset;
      leg.position.y = 0.25 + Math.sin(legAngle) * 0.15;
    });
  }

  private animateBiting(deltaTime: number) {
    // Update bite timer with deltaTime
    this.state.biteTimer = Math.max(0, this.state.biteTimer - deltaTime);
    const biteProgress = 1 - (this.state.biteTimer / this.BITE_DURATION);
    const lungeAmount = Math.sin(biteProgress * Math.PI) * this.BITE_LUNGE_DISTANCE;
    
    // Lunge forward
    this.bodyGroup.position.z = lungeAmount;
    
    // Head bite animation
    this.headGroup.rotation.x = -biteProgress * 0.5;
  }

  private getBoundingBox(): THREE.Box3 {
    const size = this.state.size;
    const position = new THREE.Vector3(this.state.position.x, this.state.position.y, this.state.position.z);
    const halfWidth = 0.4 * size;
    const halfHeight = 0.3 * size;
    const halfLength = 0.6 * size;
    
    return new THREE.Box3(
      new THREE.Vector3(
        position.x - halfWidth,
        position.y - halfHeight,
        position.z - halfLength
      ),
      new THREE.Vector3(
        position.x + halfWidth,
        position.y + halfHeight,
        position.z + halfLength
      )
    );
  }

  checkCollision(newPosition: THREE.Vector3, collidables?: THREE.Object3D[], collidableBoxes?: THREE.Box3[]): boolean {
    if (!collidables) return false;
    
    // Create a temporary bounding box at the new position
    const tempState = { ...this.state, position: { x: newPosition.x, y: newPosition.y, z: newPosition.z } };
    const tempThis = { ...this, state: tempState };
    const characterBox = this.getBoundingBox.call(tempThis);

    // Add a small buffer to prevent getting too close
    characterBox.min.x -= 0.1;
    characterBox.min.z -= 0.1;
    characterBox.max.x += 0.1;
    characterBox.max.z += 0.1;

    // Function to check if boxes overlap horizontally and vertically
    const checkOverlap = (box1: THREE.Box3, box2: THREE.Box3): boolean => {
      return (
        box1.min.x <= box2.max.x &&
        box1.max.x >= box2.min.x &&
        box1.min.z <= box2.max.z &&
        box1.max.z >= box2.min.z &&
        box1.min.y <= box2.max.y &&
        box1.max.y >= box2.min.y
      );
    };

    // Function to check if an object should be considered for collision
    const shouldCheckCollision = (obj: THREE.Object3D): boolean => {
      // Don't collide with self or parts of self
      if (obj === this.dog || obj.parent === this.dog) return false;
      
      // Always check collision with other dogs (they'll be THREE.Group)
      if (obj instanceof THREE.Group) return true;
      
      // Check collision with rocks and walls
      if (obj instanceof THREE.Mesh) {
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box.getSize(size);
        
        // If it's a wall (much taller than wide)
        if (size.y > Math.max(size.x, size.z) * 2) return true;
        
        // If it's roughly cube-shaped (like rocks)
        if (Math.abs(size.y - size.x) < 2 && Math.abs(size.y - size.z) < 2) return true;
      }
      
      return false;
    };

    // Use cached boxes if available
    if (collidableBoxes) {
      for (let i = 0; i < collidableBoxes.length; i++) {
        const obj = collidables[i];
        if (shouldCheckCollision(obj)) {
          const objectBox = collidableBoxes[i];
          // Only collide if we're at the same height as the object
          if (checkOverlap(characterBox, objectBox)) {
            return true;
          }
        }
      }
      return false;
    }

    // Fallback to computing boxes if not cached
    for (const object of collidables) {
      if (shouldCheckCollision(object)) {
        const objectBox = new THREE.Box3().setFromObject(object);
        if (checkOverlap(characterBox, objectBox)) {
          return true;
        }
      }
    }
    return false;
  }

  private animateHit(deltaTime: number) {
    this.state.hitTimer = Math.max(0, this.state.hitTimer - deltaTime);
    const hitProgress = this.state.hitTimer / this.HIT_FLASH_DURATION;
    
    // Flash red when hit
    this.bodyGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshPhongMaterial;
        material.emissive = new THREE.Color(0xff0000).multiplyScalar(hitProgress * 0.5);
      }
    });
  }

  private animateDeath(deltaTime: number) {
    this.state.dyingTimer = Math.max(0, this.state.dyingTimer - deltaTime);
    const deathProgress = 1 - (this.state.dyingTimer / this.DEATH_ANIMATION_DURATION);
    
    // Spin and sink into ground
    this.dog.rotation.y += deltaTime * 10;
    this.dog.position.y = this.state.position.y * (1 - deathProgress);
    this.dog.scale.setScalar(this.state.size * (1 - deathProgress));
  }

  checkGroundAndPlatformCollision(newPosition: THREE.Vector3, collidables?: THREE.Object3D[]): { collision: boolean, groundHeight: number } {
    if (!collidables) return { collision: false, groundHeight: this.GROUND_LEVEL };

    let highestCollision = this.GROUND_LEVEL;
    let hasCollision = false;

    // Create a ray starting from above the new position
    const rayStart = new THREE.Vector3(newPosition.x, newPosition.y + 5, newPosition.z);
    const rayDirection = new THREE.Vector3(0, -1, 0);
    const raycaster = new THREE.Raycaster(rayStart, rayDirection);

    // Filter only platform objects (exclude the dog and its parts)
    const platforms = collidables.filter(obj => {
      // Don't check collisions with self
      if (obj === this.dog || obj.parent === this.dog) return false;
      
      // Get the object's dimensions
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      
      // Check if it's a platform (wider/deeper than tall)
      return size.y <= Math.max(size.x, size.z);
    });

    const intersects = raycaster.intersectObjects(platforms);
    if (intersects.length > 0) {
      // Find the highest platform below or near the character's position
      for (const hit of intersects) {
        const platformTop = hit.point.y;
        
        // Check if we're falling and the platform is within landing range
        if (this.state.jumpVelocity < 0) {
          const distanceToPlat = newPosition.y - platformTop;
          if (distanceToPlat >= -this.PLATFORM_LANDING_BUFFER && 
              distanceToPlat <= this.PLATFORM_LANDING_BUFFER && 
              platformTop > highestCollision) {
            highestCollision = platformTop;
            hasCollision = true;
          }
        }
      }
    }

    return { collision: hasCollision, groundHeight: highestCollision };
  }

  update(
    keys: { [key: string]: boolean }, 
    deltaTime: number, 
    collidables?: THREE.Object3D[],
    collidableBoxes?: THREE.Box3[],
    allPlayers?: Character[]
  ) {
    this.state.animationTime += deltaTime;

    // Update bark cooldown
    if (this.state.barkCooldown > 0) {
      this.state.barkCooldown = Math.max(0, this.state.barkCooldown - deltaTime);
    }

    // Handle death animation
    if (this.state.isDying) {
      this.animateDeath(deltaTime);
      return; // Don't process other updates if dying
    }

    // Handle hit animation
    if (this.state.isHit) {
      this.animateHit(deltaTime);
      if (this.state.hitTimer <= 0) {
        this.state.isHit = false;
        // Reset materials
        this.bodyGroup.children.forEach(child => {
          if (child instanceof THREE.Mesh) {
            const material = child.material as THREE.MeshPhongMaterial;
            material.emissive = new THREE.Color(0x000000);
          }
        });
      }
    }

    if (this.isAI) {
      this.aiController?.update(deltaTime, collidables, collidableBoxes, allPlayers);
    } else {
      // Handle keyboard input for player character
      const moveDirection = new THREE.Vector3();

      if (keys['w'] || keys['ArrowUp']) {
        moveDirection.z -= 1;
      }
      if (keys['s'] || keys['ArrowDown']) {
        moveDirection.z += 1;
      }
      if (keys['a'] || keys['ArrowLeft']) {
        moveDirection.x -= 1;
      }
      if (keys['d'] || keys['ArrowRight']) {
        moveDirection.x += 1;
      }
      if (keys[' '] && !this.state.isJumping) {
        this.state.isJumping = true;
        this.state.jumpVelocity = this.JUMP_FORCE;
      }
      if (keys['r'] && this.state.barkCooldown <= 0) {
        AudioManager.getInstance().playBarkSound();
        this.state.barkCooldown = this.BARK_COOLDOWN;
      }

      // Update movement and facing direction
      if (moveDirection.length() > 0) {
        this.state.isMoving = true;
        // Immediately face movement direction
        this.state.rotation = Math.atan2(moveDirection.x, moveDirection.z) + Math.PI;
        
        // Calculate new position
        const moveSpeed = this.MOVE_SPEED * (1.5 / this.state.size);
        const newPosition = new THREE.Vector3(
          this.state.position.x + moveDirection.x * moveSpeed,
          this.state.position.y,
          this.state.position.z + moveDirection.z * moveSpeed
        );

        // Only update position if there's no collision
        if (!this.checkCollision(newPosition, collidables, collidableBoxes)) {
          this.state.position.x = newPosition.x;
          this.state.position.z = newPosition.z;
        } else {
          this.state.isMoving = false; // Stop moving animation if we hit something
        }
      } else {
        this.state.isMoving = false;
      }

      // Arrow keys for direct movement in faced direction
      if (keys['ArrowLeft']) {
        this.state.rotation += this.ROTATION_SPEED;
      }
      if (keys['ArrowRight']) {
        this.state.rotation -= this.ROTATION_SPEED;
      }
      if (keys['ArrowUp']) {
        const moveSpeed = this.MOVE_SPEED * (1.5 / this.state.size);
        const newPosition = new THREE.Vector3(
          this.state.position.x + Math.sin(this.state.rotation) * moveSpeed,
          this.state.position.y,
          this.state.position.z + Math.cos(this.state.rotation) * moveSpeed
        );
        
        if (!this.checkCollision(newPosition, collidables, collidableBoxes)) {
          this.state.position.x = newPosition.x;
          this.state.position.z = newPosition.z;
          this.state.isMoving = true;
        } else {
          this.state.isMoving = false; // Stop moving animation if we hit something
        }
      }
      if (keys['ArrowDown']) {
        const moveSpeed = this.MOVE_SPEED * (1.8 / this.state.size);
        const newPosition = new THREE.Vector3(
          this.state.position.x - Math.sin(this.state.rotation) * moveSpeed,
          this.state.position.y,
          this.state.position.z - Math.cos(this.state.rotation) * moveSpeed
        );
        
        if (!this.checkCollision(newPosition, collidables, collidableBoxes)) {
          this.state.position.x = newPosition.x;
          this.state.position.z = newPosition.z;
          this.state.isMoving = true;
        } else {
          this.state.isMoving = false; // Stop moving animation if we hit something
        }
      }

      // Check for ground support and apply gravity
      const currentPos = new THREE.Vector3(
        this.state.position.x,
        this.state.position.y,
        this.state.position.z
      );
      const { collision: hasSupport } = this.checkGroundAndPlatformCollision(currentPos, collidables);

      // If no support and not already jumping, start falling
      if (!hasSupport && !this.state.isJumping && this.state.position.y > this.GROUND_LEVEL) {
        this.state.isJumping = true;
        this.state.jumpVelocity = 0; // Start with no upward velocity
      }

      // Apply gravity and update vertical position if jumping or falling
      if (this.state.isJumping) {
        this.state.jumpVelocity -= this.GRAVITY * deltaTime * 60; // Scale gravity by deltaTime for consistent physics
        const newPosition = new THREE.Vector3(
          this.state.position.x,
          this.state.position.y + this.state.jumpVelocity,
          this.state.position.z
        );

        const { collision, groundHeight } = this.checkGroundAndPlatformCollision(newPosition, collidables);

        if (this.state.jumpVelocity < 0 && (collision || newPosition.y <= groundHeight)) {
          // Land on platform or ground
          this.state.position.y = groundHeight;
          this.state.isJumping = false;
          this.state.jumpVelocity = 0;
        } else {
          // Continue jumping/falling
          this.state.position.y = newPosition.y;
        }
      }

      // Biting
      if (keys['b'] && !this.state.isBiting && this.state.knockbackTime <= 0) {
        this.state.isBiting = true;
        this.state.biteTimer = this.BITE_DURATION;
      }

      // Keep within bounds
      const BOUND = 45;
      this.state.position.x = Math.max(-BOUND, Math.min(BOUND, this.state.position.x));
      this.state.position.z = Math.max(-BOUND, Math.min(BOUND, this.state.position.z));
    }

    // Update bite timer
    if (this.state.isBiting) {
      if (this.state.biteTimer <= 0) {
        this.state.isBiting = false;
        // Reset bite animations
        this.bodyGroup.position.z = 0;
        this.headGroup.rotation.x = 0;
      }
    }

    // Update knockback timer
    if (this.state.knockbackTime > 0) {
      this.state.knockbackTime -= deltaTime;
      // Apply knockback movement
      this.state.position.x += this.state.velocity.x * deltaTime;
      this.state.position.z += this.state.velocity.z * deltaTime;
      // Slow down velocity
      this.state.velocity.multiplyScalar(0.9);
    }

    // Apply animations
    if (this.state.isBiting) {
      this.animateBiting(deltaTime);
    } else if (this.state.isMoving) {
      this.animateWalking(deltaTime);
    } else {
      this.animateIdle(deltaTime);
    }

    this.updateDogPosition();
  }

  bite(): THREE.Box3 {
    // Create a bite hitbox that only extends in front of the dog
    const biteBox = new THREE.Box3();
    const biteOffset = (1 + this.BITE_LUNGE_DISTANCE) * this.state.size;
    const biteWidth = this.state.size * 0.8;
    const biteHeight = this.state.size * 1.2;
    
    // Calculate bite position in front of the dog
    const headHeight = this.state.size * 0.7;
    const dogPosition = new THREE.Vector3(
      this.state.position.x,
      this.state.position.y + headHeight,
      this.state.position.z
    );
    
    // Calculate forward direction vector based on rotation (flipped signs to match correct direction)
    const forwardX = -Math.sin(this.state.rotation);
    const forwardZ = -Math.cos(this.state.rotation);
    
    // Calculate right vector (perpendicular to forward)
    const rightX = -forwardZ;
    const rightZ = forwardX;
    
    // Calculate corners of the bite area
    const frontCenter = new THREE.Vector3(
      this.state.position.x + forwardX * biteOffset,
      this.state.position.y + headHeight,
      this.state.position.z + forwardZ * biteOffset
    );
    
    // Set box bounds to create a rectangular area in front of the dog
    biteBox.set(
      new THREE.Vector3(
        Math.min(dogPosition.x, frontCenter.x - rightX * biteWidth),
        this.state.position.y,
        Math.min(dogPosition.z, frontCenter.z - rightZ * biteWidth)
      ),
      new THREE.Vector3(
        Math.max(dogPosition.x, frontCenter.x + rightX * biteWidth),
        this.state.position.y + biteHeight,
        Math.max(dogPosition.z, frontCenter.z + rightZ * biteWidth)
      )
    );
    
    return biteBox;
  }

  applyKnockback(attacker: Character, multiplier: number = 1.0) {
    // Calculate knockback direction away from attacker
    const knockbackDir = new THREE.Vector3(
        this.state.position.x - attacker.state.position.x,
        0,
        this.state.position.z - attacker.state.position.z
    ).normalize();

    // Set knockback velocity with increased speed and multiplier
    this.state.velocity.copy(knockbackDir.multiplyScalar(this.KNOCKBACK_SPEED * multiplier));
    this.state.knockbackTime = this.KNOCKBACK_DURATION;
    
    // Reset hit state and timer
    this.state.isHit = true;
    this.state.hitTimer = this.HIT_FLASH_DURATION;

    // Store attacker for revenge if AI
    if (this.isAI && this.aiController) {
      this.aiController.setLastAttacker(attacker);
    }
  }

  collectBone() {
    this.state.bones++;
    this.state.size = Math.min(
      this.MAX_SIZE,
      this.MIN_SIZE + (this.state.bones * this.GROWTH_PER_BONE)
    );
    
    // Check for win condition
    if (this.state.bones >= this.TARGET_BONES) {
      this.state.hasWon = true;
    }
    
    this.updateDogPosition();
  }

  dropAllBones(): number {
    if (this.state.bones <= 0) {
      // If no bones, just start death animation
      this.state.isDying = true;
      this.state.dyingTimer = this.DEATH_ANIMATION_DURATION;
      // Play death sound
      AudioManager.getInstance().playYelpSound();
      return 0;
    }

    const droppedBones = this.state.bones;
    this.state.bones = 0;
    this.state.size = this.MIN_SIZE;
    
    // Start death animation and play sound
    this.state.isDying = true;
    this.state.dyingTimer = this.DEATH_ANIMATION_DURATION;
    AudioManager.getInstance().playYelpSound();
    
    this.updateDogPosition();
    return droppedBones;
  }

  dropSomeBones(bonesToDrop?: number): number {
    console.log(`[dropSomeBones] ===== START =====`);
    console.log(`[dropSomeBones] Initial state - Bones: ${this.state.bones}, Size: ${this.state.size.toFixed(2)}`);
    
    if (this.state.bones <= 0) {
      console.log('[dropSomeBones] No bones to drop, returning 0');
      return 0;
    }

    // Calculate bones to drop
    const bonesDropped = bonesToDrop || this.BONES_TO_DROP;
    const actualBonesToDrop = Math.min(bonesDropped, this.state.bones);
    console.log(`[dropSomeBones] Will drop ${actualBonesToDrop} out of ${this.state.bones} bones`);

    // Update bones count
    const oldBones = this.state.bones;
    this.state.bones = Math.max(0, this.state.bones - actualBonesToDrop);
    console.log(`[dropSomeBones] Bones updated: ${oldBones} -> ${this.state.bones}`);
    
    // Recalculate size based on remaining bones
    const oldSize = this.state.size;
    this.state.size = Math.max(
      this.MIN_SIZE,
      this.MIN_SIZE + (this.state.bones * this.GROWTH_PER_BONE)
    );
    console.log(`[dropSomeBones] Size updated: ${oldSize.toFixed(2)} -> ${this.state.size.toFixed(2)}`);
    
    // Update the dog's physical appearance immediately
    console.log('[dropSomeBones] Updating physical appearance');
    this.updateDogPosition();
    
    // Trigger hit animation after size change
    console.log('[dropSomeBones] Setting hit state for visual feedback');
    this.state.isHit = true;
    this.state.hitTimer = this.HIT_FLASH_DURATION;
    
    console.log(`[dropSomeBones] ===== END =====`);
    return actualBonesToDrop;
  }

  respawn() {
    // Reset state but don't set position (Stage will handle this)
    this.state.rotation = Math.random() * Math.PI * 2;
    this.state.size = this.MIN_SIZE;
    this.state.bones = 0;
    this.state.isBiting = false;
    this.state.biteTimer = 0;
    this.state.isMoving = false;
    this.state.velocity = new THREE.Vector3();
    this.state.knockbackTime = 0;
    this.state.isHit = false;
    this.state.hitTimer = 0;
    this.state.isDying = false;
    this.state.dyingTimer = 0;
    this.state.hasWon = false;
    
    this.updateDogPosition();
  }
}

export default Character; 