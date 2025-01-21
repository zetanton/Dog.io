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
  isZooming: boolean;
  zoomiesCooldown: number;
  isMarking: boolean;
  markingCooldown: number;
  markingLegSide?: 'left' | 'right';
  markingRadius: number;
  markingPosition?: THREE.Vector3;
  markingAnimationTime: number;
  isBarking: boolean;
  barkAnimationTime: number;
}

export class Character {
  dog: THREE.Group;
  state: CharacterState;
  isAI: boolean;
  bodyGroup: THREE.Group = new THREE.Group();
  headGroup: THREE.Group = new THREE.Group();
  legs: THREE.Mesh[] = [];
  tail: THREE.Mesh = new THREE.Mesh();
  territoryCircle?: THREE.Mesh;
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
  readonly ZOOMIES_SPEED_MULTIPLIER = 3;
  readonly ZOOMIES_DURATION = 3; // seconds
  readonly ZOOMIES_COOLDOWN = 10; // seconds
  readonly MARKING_DURATION = 5; // seconds
  readonly MARKING_COOLDOWN = 10; // seconds
  readonly MARKING_RADIUS = 15;
  readonly MARKING_EXPAND_DURATION = 1; // seconds to reach full radius
  readonly MARKING_PUSH_FORCE = 0.5;
  readonly MARKING_ANIMATION_DURATION = 1; // seconds for leg lift animation
  private readonly STAGE_SIZE = 100; // Match the stage size from Stage.tsx
  private aiController: AIController | null = null;
  private barkText?: THREE.Mesh;
  readonly BARK_ANIMATION_DURATION = 0.4; // seconds, slightly longer for text animation
  readonly BARK_WORDS = ['WOOF!', 'BARK!'];
  private clippingPlanes: THREE.Plane[];

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

    // Create clipping planes for the stage boundaries
    const halfSize = this.STAGE_SIZE / 2;
    this.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), halfSize),   // Right wall
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), halfSize),  // Left wall
      new THREE.Plane(new THREE.Vector3(0, 0, 1), halfSize),   // Front wall
      new THREE.Plane(new THREE.Vector3(0, 0, -1), halfSize)   // Back wall
    ];

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
      isZooming: false,
      zoomiesCooldown: 0,
      isMarking: false,
      markingCooldown: 0,
      markingLegSide: undefined,
      markingRadius: 0,
      markingPosition: undefined,
      markingAnimationTime: 0,
      isBarking: false,
      barkAnimationTime: 0,
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
    
    // Remove bark lines section and keep only text
    const barkGroup = new THREE.Group();
    
    // Create text as a textured plane
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 1024; // Doubled for higher resolution
    canvas.height = 512;
    
    // Set up text style with larger, bolder text
    context.font = 'bold 240px Arial'; // Doubled font size
    context.textAlign = 'center';
    context.fillStyle = 'black';
    context.fillText('WOOF!', canvas.width/2, canvas.height/2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const textMaterial = new THREE.MeshBasicMaterial({ 
      map: texture,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    
    // Create a larger plane for the text (doubled size)
    const textGeometry = new THREE.PlaneGeometry(2.4, 1.2);
    this.barkText = new THREE.Mesh(textGeometry, textMaterial);
    this.barkText.visible = false;
    
    // Add text to the head group
    this.headGroup.add(this.barkText);
    
    // Position bark group in front of snout
    barkGroup.position.set(0, 0, 0.5);
    this.headGroup.add(barkGroup);
    
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
    
    // Filter out sprites from collision checks
    const filteredCollidables = collidables.filter(obj => !(obj instanceof THREE.Sprite));
    
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
      
      // Skip sprites
      if (obj instanceof THREE.Sprite) return false;
      
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
        const obj = filteredCollidables[i];
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
    for (const object of filteredCollidables) {
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

    // Filter only platform objects (exclude the dog, its parts, and sprites)
    const platforms = collidables.filter(obj => {
      // Don't check collisions with self
      if (obj === this.dog || obj.parent === this.dog) return false;
      
      // Skip sprites
      if (obj instanceof THREE.Sprite) return false;
      
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

  private animateMarking(deltaTime: number) {
    // Randomly choose which leg to lift (if not already chosen)
    if (!this.state.markingLegSide) {
      this.state.markingLegSide = Math.random() < 0.5 ? 'left' : 'right';
    }

    // Update animation time
    this.state.markingAnimationTime += deltaTime;
    
    // Calculate animation progress (0 to 1)
    const animationProgress = Math.min(1, this.state.markingAnimationTime / this.MARKING_ANIMATION_DURATION);
    
    if (this.state.markingAnimationTime <= this.MARKING_ANIMATION_DURATION) {
      // Smooth leg lift animation using sine for natural movement
      const legLiftAngle = (Math.PI / 2.5) * Math.sin(animationProgress * Math.PI);
      
      // Tilt body in opposite direction of lifted leg
      const bodyTiltAngle = (Math.PI / 8) * Math.sin(animationProgress * Math.PI); // Less tilt than leg
      
      // Apply leg lift
      const legIndex = this.state.markingLegSide === 'left' ? 3 : 2;
      if (this.legs[legIndex]) {
        this.legs[legIndex].rotation.z = legLiftAngle;
      }
      
      // Apply body tilt (opposite direction of leg lift)
      const tiltDirection = this.state.markingLegSide === 'left' ? -1 : 1;
      this.bodyGroup.rotation.z = bodyTiltAngle * tiltDirection;
      
      // Adjust other legs for stability
      const frontLegIndex = this.state.markingLegSide === 'left' ? 1 : 0;
      const otherBackLegIndex = this.state.markingLegSide === 'left' ? 2 : 3;
      
      // Front leg on lifting side bends slightly
      if (this.legs[frontLegIndex]) {
        this.legs[frontLegIndex].rotation.z = -bodyTiltAngle * 0.5;
      }
      
      // Back leg plants firmly
      if (this.legs[otherBackLegIndex]) {
        this.legs[otherBackLegIndex].rotation.z = -bodyTiltAngle * 0.7;
      }
    }

    // Start territory effect after animation completes
    if (this.state.markingAnimationTime >= this.MARKING_ANIMATION_DURATION && !this.state.markingPosition) {
      this.state.markingPosition = new THREE.Vector3(
        this.state.position.x,
        this.state.position.y,
        this.state.position.z
      );
    }
  }

  private createTerritoryCircle(): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(1, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xFFEB3B,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      clippingPlanes: this.clippingPlanes
    });
    const circle = new THREE.Mesh(geometry, material);
    circle.rotation.x = -Math.PI / 2; // Lay flat on the ground
    circle.position.y = 0.1; // Slightly above ground to avoid z-fighting
    return circle;
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

    // Update zoomies cooldown
    if (this.state.zoomiesCooldown > 0) {
      this.state.zoomiesCooldown = Math.max(0, this.state.zoomiesCooldown - deltaTime);
    }

    // Update marking cooldown
    if (this.state.markingCooldown > 0) {
      this.state.markingCooldown = Math.max(0, this.state.markingCooldown - deltaTime);
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

    // Handle marking animation and effects
    if (this.state.isMarking) {
      this.animateMarking(deltaTime);
      
      // Set marking position when starting
      if (!this.state.markingPosition) {
        this.state.markingPosition = new THREE.Vector3(
          this.state.position.x,
          this.state.position.y,
          this.state.position.z
        );

        // Create territory circle if it doesn't exist
        if (!this.territoryCircle) {
          this.territoryCircle = this.createTerritoryCircle();
          this.dog.parent?.add(this.territoryCircle);
        }

        // Position the circle
        if (this.territoryCircle) {
          this.territoryCircle.position.set(
            this.state.markingPosition.x,
            0.1,
            this.state.markingPosition.z
          );
        }
      }

      // Expand radius during the first second
      if (this.state.markingRadius < this.MARKING_RADIUS) {
        this.state.markingRadius += (this.MARKING_RADIUS / this.MARKING_EXPAND_DURATION) * deltaTime;
        
        // Scale the territory circle
        if (this.territoryCircle) {
          const currentScale = Math.min(this.MARKING_RADIUS, this.state.markingRadius);
          this.territoryCircle.scale.set(
            currentScale,
            currentScale,
            currentScale
          );
        }
      }

      // Update circle opacity based on remaining time
      if (this.territoryCircle) {
        const material = this.territoryCircle.material as THREE.MeshBasicMaterial;
        const timeLeft = this.MARKING_DURATION - (this.MARKING_DURATION - this.state.markingCooldown);
        material.opacity = 0.3 * (timeLeft / this.MARKING_DURATION);
      }

      // Push away other dogs
      if (allPlayers && this.state.markingPosition) {
        allPlayers.forEach(otherDog => {
          if (otherDog !== this) {
            const otherPos = new THREE.Vector3(
              otherDog.state.position.x,
              otherDog.state.position.y,
              otherDog.state.position.z
            );
            const distance = new THREE.Vector3().subVectors(otherPos, this.state.markingPosition!);
            distance.y = 0; // Keep push force horizontal
            const distanceLength = distance.length();

            if (distanceLength < this.state.markingRadius) {
              // Calculate push direction and force
              const pushDirection = distance.normalize();
              const pushForce = (this.state.markingRadius - distanceLength) / this.state.markingRadius;
              const pushVector = pushDirection.multiplyScalar(this.MARKING_PUSH_FORCE * pushForce);
              
              // Apply push force
              otherDog.state.position.x += pushVector.x;
              otherDog.state.position.z += pushVector.z;
            }
          }
        });
      }
    } else {
      // Remove territory circle when not marking
      if (this.territoryCircle) {
        this.territoryCircle.removeFromParent();
        this.territoryCircle = undefined;
      }

      // Reset marking state when not marking
      this.state.markingLegSide = undefined;
      this.state.markingRadius = 0;
      this.state.markingPosition = undefined;
      
      // Reset all leg rotations and body tilt
      this.bodyGroup.rotation.z = 0;
      this.legs.forEach(leg => {
        leg.rotation.z = 0;
      });
    }

    // Handle bark animation
    if (this.state.isBarking) {
      this.animateBark(deltaTime);
    }

    if (this.isAI) {
      this.aiController?.update(deltaTime, collidables, collidableBoxes, allPlayers);
    } else {
      // Only process movement if not in marking animation
      const canMove = !this.state.isMarking || this.state.markingAnimationTime > this.MARKING_ANIMATION_DURATION;
      
      if (canMove) {
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
          this.state.isBarking = true;
          this.state.barkAnimationTime = 0;
          
          // Update bark text randomly
          const word = this.BARK_WORDS[Math.floor(Math.random() * this.BARK_WORDS.length)];
          this.updateBarkText(word);
        }

        // Handle zoomies activation
        if (keys['z'] && this.state.zoomiesCooldown === 0 && !this.state.isZooming) {
          this.state.isZooming = true;
          this.state.zoomiesCooldown = this.ZOOMIES_COOLDOWN;
          setTimeout(() => {
            this.state.isZooming = false;
          }, this.ZOOMIES_DURATION * 1000);
        }

        // Handle marking activation
        if (keys['m'] && this.state.markingCooldown === 0 && !this.state.isMarking) {
          this.state.isMarking = true;
          this.state.markingCooldown = this.MARKING_COOLDOWN;
          this.state.markingAnimationTime = 0;
          setTimeout(() => {
            this.state.isMarking = false;
            // Reset leg positions
            if (this.legs[2]) this.legs[2].rotation.z = 0;
            if (this.legs[3]) this.legs[3].rotation.z = 0;
          }, this.MARKING_DURATION * 1000);
        }

        // Calculate current move speed
        const currentMoveSpeed = this.MOVE_SPEED * (
          this.isAI ? this.AI_MOVE_SPEED_MULTIPLIER : 1
        ) * (this.state.isZooming ? this.ZOOMIES_SPEED_MULTIPLIER : 1);

        // Update movement and facing direction
        if (moveDirection.length() > 0) {
          this.state.isMoving = true;
          // Immediately face movement direction
          this.state.rotation = Math.atan2(moveDirection.x, moveDirection.z) + Math.PI;
          
          // Calculate new position
          const newPosition = new THREE.Vector3(
            this.state.position.x + moveDirection.x * currentMoveSpeed,
            this.state.position.y,
            this.state.position.z + moveDirection.z * currentMoveSpeed
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
          const forward = new THREE.Vector3(
            Math.sin(this.state.rotation),
            0,
            Math.cos(this.state.rotation)
          );
          const newPosition = new THREE.Vector3(
            this.state.position.x + forward.x * currentMoveSpeed,
            this.state.position.y,
            this.state.position.z + forward.z * currentMoveSpeed
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
          const backward = new THREE.Vector3(
            -Math.sin(this.state.rotation),
            0,
            -Math.cos(this.state.rotation)
          );
          const newPosition = new THREE.Vector3(
            this.state.position.x + backward.x * currentMoveSpeed,
            this.state.position.y,
            this.state.position.z + backward.z * currentMoveSpeed
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
    
    // Check for win condition at exactly 100 bones
    if (this.state.bones >= 100) {
      this.state.bones = 100;
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

  private updateBarkText(word: string) {
    if (!this.barkText) return;
    
    const material = this.barkText.material as THREE.MeshBasicMaterial;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 1024;
    canvas.height = 512;
    
    // Larger, bolder text
    context.font = 'bold 240px Arial'; // Doubled font size
    context.textAlign = 'center';
    context.fillStyle = 'black';
    context.fillText(word, canvas.width/2, canvas.height/2);
    
    if (material.map) material.map.dispose();
    material.map = new THREE.CanvasTexture(canvas);
    material.needsUpdate = true;
  }

  private animateBark(deltaTime: number) {
    if (!this.state.isBarking) return;
    
    this.state.barkAnimationTime += deltaTime;
    const progress = this.state.barkAnimationTime / this.BARK_ANIMATION_DURATION;
    
    if (progress >= 1) {
      this.state.isBarking = false;
      this.state.barkAnimationTime = 0;
      if (this.barkText) this.barkText.visible = false;
      return;
    }
    
    // Animate text
    if (this.barkText) {
      // Use sine wave for opacity to fade in/out smoothly
      const opacity = Math.sin(progress * Math.PI);
      const material = this.barkText.material as THREE.MeshBasicMaterial;
      material.opacity = opacity;
      this.barkText.visible = true;

      // Position text in front of the dog's mouth and make it float up
      const moveProgress = progress * 1.5;
      // Start in front of mouth and move up
      this.barkText.position.set(0, 0.3 + moveProgress * 0.5, 1.0);
      
      // Make text face the camera by rotating it to match dog's rotation plus 180 degrees
      this.barkText.rotation.y = -this.state.rotation + Math.PI;

      // Scale text for emphasis
      const scale = 1 + Math.sin(progress * Math.PI) * 0.3;
      this.barkText.scale.set(scale, scale, 1);
    }
  }
}

export default Character; 