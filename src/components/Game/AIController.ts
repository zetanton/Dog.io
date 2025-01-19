import * as THREE from 'three';
import Character from './Character';
import AudioManager from '../../utils/AudioManager';

export class AIController {
    private readonly STUCK_THRESHOLD = 0.1;
    private readonly STUCK_CHECK_INTERVAL = 30;
    private readonly STUCK_MEMORY = 4;
    private readonly DIRECTION_CHANGE_DURATION = 20;
    private readonly CHASE_DISTANCE = 25;
    private readonly FLEE_DISTANCE = 15;
    private readonly BONE_DETECTION_RANGE = 60;
    private readonly BONE_CHASE_SPEED_MULTIPLIER = 1.3;
    private readonly MINIMUM_SAFE_BONES = 3;
    private readonly REVENGE_DURATION = 60;
    private readonly REVENGE_DISTANCE = 30;

    private character: Character;
    private lastPositions: THREE.Vector3[] = [];
    private stuckCheckCounter = 0;
    private directionChangeCounter = 0;
    private lastDirection: THREE.Vector3 | null = null;
    private lastAttacker: Character | null = null;
    private revengeTimer: number = 0;

    constructor(character: Character) {
        this.character = character;
    }

    private isStuck(): boolean {
        if (this.lastPositions.length < this.STUCK_MEMORY) return false;
        
        let totalMovement = 0;
        let isOscillating = true;
        
        // Check total movement
        for (let i = 1; i < this.lastPositions.length; i++) {
            const movement = this.lastPositions[i].distanceTo(this.lastPositions[i - 1]);
            totalMovement += movement;
            
            // Check if movement is consistently in different directions (oscillating)
            if (i > 1) {
                const prevDiff = this.lastPositions[i-1].clone().sub(this.lastPositions[i-2]);
                const currentDiff = this.lastPositions[i].clone().sub(this.lastPositions[i-1]);
                const dotProduct = prevDiff.dot(currentDiff);
                if (dotProduct > 0) {
                    isOscillating = false;
                }
            }
        }
        
        // Check if we're moving in a very small area
        const boundingBox = new THREE.Box3();
        this.lastPositions.forEach(pos => boundingBox.expandByPoint(pos));
        const boxSize = new THREE.Vector3();
        boundingBox.getSize(boxSize);
        const areaSize = boxSize.x * boxSize.z;
        
        return totalMovement < this.STUCK_THRESHOLD || 
               (isOscillating && areaSize < this.STUCK_THRESHOLD * 2) ||
               areaSize < this.STUCK_THRESHOLD;
    }

    private findAlternativeDirection(currentDirection: THREE.Vector3, collidables?: THREE.Object3D[]): THREE.Vector3 {
        const angles = [
            Math.PI/6, -Math.PI/6,    // Small adjustments
            Math.PI/4, -Math.PI/4,    // Medium turns
            Math.PI/2, -Math.PI/2,    // Right angles
            Math.PI*2/3, -Math.PI*2/3,// Wide turns
            Math.PI, -Math.PI         // Complete reversal if needed
        ];
        
        let bestDirection = currentDirection.clone();
        let maxClearDistance = 0;
        const position = new THREE.Vector3(
            this.character.state.position.x,
            this.character.state.position.y,
            this.character.state.position.z
        );

        // Cast rays in multiple directions and heights
        const heights = [-0.5, 0, 0.5];  // Check below, at, and above current height
        
        for (const angle of angles) {
            let totalClearDistance = 0;
            let rayCount = 0;
            
            const testDirection = currentDirection.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            
            for (const height of heights) {
                const rayStart = position.clone();
                rayStart.y += height;
                
                // Cast three parallel rays (left, center, right) for each height
                const offsets = [-0.5, 0, 0.5];
                for (const offset of offsets) {
                    const offsetVec = new THREE.Vector3(-testDirection.z, 0, testDirection.x).multiplyScalar(offset);
                    const rayOrigin = rayStart.clone().add(offsetVec);
                    
                    const raycaster = new THREE.Raycaster(rayOrigin, testDirection, 0, 8);
                    const intersects = collidables ? raycaster.intersectObjects(collidables) : [];
                    
                    const clearDistance = intersects.length > 0 ? intersects[0].distance : 8;
                    totalClearDistance += clearDistance;
                    rayCount++;
                }
            }
            
            const averageClearDistance = totalClearDistance / rayCount;
            
            // Prefer directions closer to current direction
            const directionPreference = 1 - Math.abs(angle) / Math.PI;
            const weightedDistance = averageClearDistance * (0.7 + 0.3 * directionPreference);
            
            if (weightedDistance > maxClearDistance) {
                maxClearDistance = weightedDistance;
                bestDirection = testDirection;
            }
        }

        return bestDirection;
    }

    setLastAttacker(attacker: Character) {
        this.lastAttacker = attacker;
        this.revengeTimer = this.REVENGE_DURATION;
    }

    update(deltaTime: number, collidables?: THREE.Object3D[], collidableBoxes?: THREE.Box3[], allPlayers?: Character[]) {
        // Update revenge timer
        if (this.revengeTimer > 0) {
            this.revengeTimer--;
            if (this.revengeTimer <= 0) {
                this.lastAttacker = null;
            }
        }

        // Update position history for stuck detection
        this.stuckCheckCounter++;
        if (this.stuckCheckCounter >= this.STUCK_CHECK_INTERVAL) {
            this.lastPositions.push(new THREE.Vector3(
                this.character.state.position.x,
                this.character.state.position.y,
                this.character.state.position.z
            ));
            if (this.lastPositions.length > this.STUCK_MEMORY) {
                this.lastPositions.shift();
            }
            this.stuckCheckCounter = 0;
        }

        // Find nearest bone and player
        let nearestBone: { position: THREE.Vector3, distance: number } | null = null;
        let nearestPlayer: { character: Character, distance: number } | null = null;
        let weakestPlayer: { character: Character, distance: number } | null = null;
        let revengeTarget: { character: Character, distance: number } | null = null;
        let nearbyBones: { position: THREE.Vector3, distance: number }[] = [];

        // Get all bones and players from the scene
        const bones = collidables?.filter(obj => 
            obj instanceof THREE.Object3D && 
            obj.name === 'bone' && 
            obj.visible && 
            obj.parent
        ) || [];

        const players = allPlayers?.filter(p => p !== this.character) || [];

        // Find and track all nearby bones
        for (const bone of bones) {
            const distance = new THREE.Vector3(
                bone.position.x - this.character.state.position.x,
                0,
                bone.position.z - this.character.state.position.z
            ).length();

            if (distance < this.BONE_DETECTION_RANGE) {
                const boneInfo = {
                    position: bone.position,
                    distance: distance
                };
                nearbyBones.push(boneInfo);
                
                if (!nearestBone || distance < nearestBone.distance) {
                    nearestBone = boneInfo;
                }
            }
        }

        // Find nearest and weakest players, and check for revenge target
        for (const player of players) {
            const distance = new THREE.Vector3(
                player.state.position.x - this.character.state.position.x,
                0,
                player.state.position.z - this.character.state.position.z
            ).length();

            if (!nearestPlayer || distance < nearestPlayer.distance) {
                nearestPlayer = {
                    character: player,
                    distance: distance
                };
            }

            if (this.lastAttacker === player && distance < this.REVENGE_DISTANCE) {
                revengeTarget = {
                    character: player,
                    distance: distance
                };
            }

            if (this.character.state.bones >= this.MINIMUM_SAFE_BONES && 
                distance < this.CHASE_DISTANCE && 
                (player.state.bones <= this.character.state.bones * 1.2) &&
                (!weakestPlayer || player.state.bones < weakestPlayer.character.state.bones)) {
                weakestPlayer = {
                    character: player,
                    distance: distance
                };
            }
        }

        // Decision making based on state
        let targetPosition: THREE.Vector3 | null = null;
        let shouldBite = false;
        let isPursuing = false;
        let isHuntingBones = false;

        // Decision tree for behavior
        if (revengeTarget) {
            targetPosition = new THREE.Vector3(
                revengeTarget.character.state.position.x,
                revengeTarget.character.state.position.y,
                revengeTarget.character.state.position.z
            );
            shouldBite = revengeTarget.distance < 4;
            isPursuing = true;
        }
        else if (nearestPlayer && 
            nearestPlayer.distance < this.FLEE_DISTANCE && 
            this.character.state.bones < (nearestPlayer.character.state.bones * 0.7)) {
            const awayVector = new THREE.Vector3(
                this.character.state.position.x - nearestPlayer.character.state.position.x,
                0,
                this.character.state.position.z - nearestPlayer.character.state.position.z
            ).normalize();

            let bestFleeTarget = null;
            let bestFleeScore = -1;
            for (const bone of nearbyBones) {
                const toBone = new THREE.Vector3(
                    bone.position.x - this.character.state.position.x,
                    0,
                    bone.position.z - this.character.state.position.z
                ).normalize();
                
                const alignmentScore = awayVector.dot(toBone) + 1;
                const distanceScore = 1 - (bone.distance / this.BONE_DETECTION_RANGE);
                const score = alignmentScore * distanceScore;
                
                if (score > bestFleeScore) {
                    bestFleeScore = score;
                    bestFleeTarget = bone.position;
                }
            }

            if (bestFleeTarget && bestFleeScore > 0.5) {
                targetPosition = bestFleeTarget;
                isHuntingBones = true;
            } else {
                targetPosition = new THREE.Vector3(
                    this.character.state.position.x + awayVector.x * 15,
                    this.character.state.position.y,
                    this.character.state.position.z + awayVector.z * 15
                );
            }
        }
        else if (weakestPlayer) {
            targetPosition = new THREE.Vector3(
                weakestPlayer.character.state.position.x,
                weakestPlayer.character.state.position.y,
                weakestPlayer.character.state.position.z
            );
            shouldBite = weakestPlayer.distance < 3.5;
            isPursuing = true;
        }
        else if (nearestBone) {
            targetPosition = nearestBone.position;
            isHuntingBones = true;
        }

        this.moveTowardsTarget(targetPosition, isPursuing, isHuntingBones, shouldBite, deltaTime, collidables, collidableBoxes);

        // Random barking with different probabilities based on state
        if (this.character.state.barkCooldown <= 0) {
            let barkChance = 0.0002 * deltaTime * 60; // Base chance for idle barking
            
            if (isPursuing) {
                barkChance = 0.001 * deltaTime * 60; // Higher chance when chasing
            } else if (isHuntingBones) {
                barkChance = 0.0005 * deltaTime * 60; // Medium chance when hunting bones
            }
            
            if (Math.random() < barkChance) {
                AudioManager.getInstance().playBarkSound();
                this.character.state.barkCooldown = this.character.BARK_COOLDOWN;
            }
        }
    }

    private moveTowardsTarget(
        targetPosition: THREE.Vector3 | null,
        isPursuing: boolean,
        isHuntingBones: boolean,
        shouldBite: boolean,
        deltaTime: number,
        collidables?: THREE.Object3D[],
        collidableBoxes?: THREE.Box3[]
    ) {
        if (targetPosition) {
            const direction = new THREE.Vector3(
                targetPosition.x - this.character.state.position.x,
                0,
                targetPosition.z - this.character.state.position.z
            ).normalize();

            const isCurrentlyStuck = this.isStuck();

            // Enhanced obstacle detection using multiple raycasters
            const mainRaycaster = new THREE.Raycaster(
                new THREE.Vector3(
                    this.character.state.position.x,
                    this.character.state.position.y,
                    this.character.state.position.z
                ),
                direction,
                0,
                4
            );
            
            // Cast additional rays at angles to detect obstacles early
            const sideRays = [
                direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI/6),
                direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI/6)
            ];
            
            const allRays = [direction, ...sideRays];
            let closestObstacle = Infinity;
            
            for (const ray of allRays) {
                mainRaycaster.set(
                    new THREE.Vector3(
                        this.character.state.position.x,
                        this.character.state.position.y,
                        this.character.state.position.z
                    ),
                    ray
                );
                const intersects = collidables ? mainRaycaster.intersectObjects(collidables) : [];
                if (intersects.length > 0 && intersects[0].distance < closestObstacle) {
                    closestObstacle = intersects[0].distance;
                }
            }

            if (isCurrentlyStuck || this.directionChangeCounter > 0 || closestObstacle < 2.5) {
                if ((isCurrentlyStuck || closestObstacle < 2.5) && this.directionChangeCounter <= 0) {
                    this.lastDirection = this.findAlternativeDirection(direction, collidables);
                    this.directionChangeCounter = this.DIRECTION_CHANGE_DURATION;
                    
                    // More aggressive jumping when stuck
                    if (!this.character.state.isJumping && Math.random() < 0.9) {
                        this.character.state.isJumping = true;
                        this.character.state.jumpVelocity = this.character.JUMP_FORCE * 
                            (isCurrentlyStuck ? 1.4 : 1.2);
                    }
                }
                
                if (this.lastDirection) {
                    const blendFactor = isCurrentlyStuck ? 0.8 : 
                                      (closestObstacle < 2.5 ? 0.6 : 0.4);
                    direction.lerp(this.lastDirection, blendFactor);
                    direction.normalize();
                }
                
                this.directionChangeCounter = Math.max(0, this.directionChangeCounter - 1);
            }

            this.character.state.rotation = Math.atan2(-direction.x, -direction.z);

            const raycaster = new THREE.Raycaster(
                new THREE.Vector3(
                    this.character.state.position.x,
                    this.character.state.position.y,
                    this.character.state.position.z
                ),
                direction,
                0,
                3
            );
            const obstacles = collidables ? raycaster.intersectObjects(collidables) : [];

            let moveSpeed = this.character.MOVE_SPEED * this.character.AI_MOVE_SPEED_MULTIPLIER * (1 / this.character.state.size) * deltaTime * 60;
            if (isHuntingBones) {
                moveSpeed *= this.BONE_CHASE_SPEED_MULTIPLIER;
            } else if (isPursuing) {
                moveSpeed *= 1.3;
            }

            const newPosition = new THREE.Vector3(
                this.character.state.position.x + direction.x * moveSpeed,
                this.character.state.position.y,
                this.character.state.position.z + direction.z * moveSpeed
            );

            const shouldJump = obstacles.length > 0 && !this.character.state.isJumping;

            if (shouldJump) {
                const jumpChance = isPursuing ? 0.6 : (isHuntingBones ? 0.5 : 0.4);
                if (Math.random() < jumpChance) {
                    this.character.state.isJumping = true;
                    this.character.state.jumpVelocity = this.character.JUMP_FORCE * (isPursuing ? 1.2 : 1.0);
                }
            }

            if (isPursuing && !this.character.state.isJumping && Math.random() < 0.03) {
                this.character.state.isJumping = true;
                this.character.state.jumpVelocity = this.character.JUMP_FORCE * 1.1;
            }

            if (!this.character.checkCollision(newPosition, collidables, collidableBoxes)) {
                this.character.state.position.x = newPosition.x;
                this.character.state.position.z = newPosition.z;
                this.character.state.isMoving = true;
            }
        } else {
            if (Math.random() < 0.04 * deltaTime * 60) {
                this.character.state.rotation += (Math.random() - 0.5) * Math.PI * deltaTime;
                if (!this.character.state.isJumping && Math.random() < 0.15) {
                    this.character.state.isJumping = true;
                    this.character.state.jumpVelocity = this.character.JUMP_FORCE;
                }
            }
        }

        if (shouldBite && !this.character.state.isBiting && this.character.state.knockbackTime <= 0) {
            const biteChance = isPursuing ? 0.95 : 0.8;
            if (Math.random() < biteChance) {
                this.character.state.isBiting = true;
                this.character.state.biteTimer = this.character.BITE_DURATION;
            }
        }

        // Keep within bounds
        const BOUND = 45;
        this.character.state.position.x = Math.max(-BOUND, Math.min(BOUND, this.character.state.position.x));
        this.character.state.position.z = Math.max(-BOUND, Math.min(BOUND, this.character.state.position.z));
    }
} 