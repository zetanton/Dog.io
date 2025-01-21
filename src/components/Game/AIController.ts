import * as THREE from 'three';
import Character from './Character';
import AudioManager from '../../utils/AudioManager';

export class AIController {
    private readonly STUCK_THRESHOLD = 0.1;
    private readonly STUCK_CHECK_INTERVAL = 30;
    private readonly STUCK_MEMORY = 4;
    private readonly DIRECTION_CHANGE_DURATION = 20;
    private readonly CHASE_DISTANCE = 35;
    private readonly FLEE_DISTANCE = 20;
    private readonly BONE_DETECTION_RANGE = 80;
    private readonly BONE_CHASE_SPEED_MULTIPLIER = 1.5;
    private readonly MINIMUM_SAFE_BONES = 5;
    private readonly REVENGE_DURATION = 90;
    private readonly REVENGE_DISTANCE = 40;
    private readonly PLATFORM_DETECTION_RANGE = 15;
    private readonly PLATFORM_HEIGHT_THRESHOLD = 3;
    private readonly VERTICAL_ADVANTAGE_THRESHOLD = 5;
    private readonly PLATFORM_JUMP_COOLDOWN = 180;
    private readonly MIN_PLATFORM_JUMP_DISTANCE = 12;
    private readonly SAME_SPOT_THRESHOLD = 3;
    private readonly RANDOM_JUMP_CHANCE = 0.00005;
    private readonly DEFENSIVE_JUMP_DISTANCE = 3;
    private readonly DEFENSIVE_JUMP_CHANCE = 0.1;
    private readonly STUCK_JUMP_CHANCE = 0.3;
    private readonly MINIMUM_JUMP_INTERVAL = 120;
    private readonly LEADER_ATTACK_DISTANCE = 45;
    private readonly BEHIND_ATTACK_BONUS = 0.4;
    private readonly PACK_ATTACK_RANGE = 25;
    private readonly SNEAK_SPEED_MULTIPLIER = 0.8;

    private character: Character;
    private lastPositions: THREE.Vector3[] = [];
    private stuckCheckCounter = 0;
    private directionChangeCounter = 0;
    private lastDirection: THREE.Vector3 | null = null;
    private lastAttacker: Character | null = null;
    private revengeTimer: number = 0;
    private platformJumpCooldown: number = 0;
    private lastPlatformJumpPosition: THREE.Vector3 | null = null;
    private lastJumpTime: number = 0;

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

        // Random jumping behavior (when not already jumping)
        if (!this.character.state.isJumping && !this.character.state.isBiting) {
            // Base random jumping
            if (Math.random() < this.RANDOM_JUMP_CHANCE * deltaTime * 60) {
                this.character.state.isJumping = true;
                this.character.state.jumpVelocity = this.character.JUMP_FORCE * (0.8 + Math.random() * 0.4);
                AudioManager.getInstance().playBarkSound(); // Sometimes bark when doing random jumps
            }

            // Defensive jumping when other dogs are nearby
            if (allPlayers) {
                const nearbyThreat = allPlayers.find(player => {
                    if (player === this.character) return false;
                    
                    const distance = new THREE.Vector3(
                        player.state.position.x - this.character.state.position.x,
                        0,
                        player.state.position.z - this.character.state.position.z
                    ).length();

                    return distance < this.DEFENSIVE_JUMP_DISTANCE && 
                           player.state.isBiting && 
                           player.state.bones >= this.character.state.bones;
                });

                if (nearbyThreat && Math.random() < this.DEFENSIVE_JUMP_CHANCE) {
                    this.character.state.isJumping = true;
                    this.character.state.jumpVelocity = this.character.JUMP_FORCE * 1.3; // Higher defensive jumps
                    
                    // Add some horizontal velocity away from the threat
                    const awayDirection = new THREE.Vector3(
                        this.character.state.position.x - nearbyThreat.state.position.x,
                        0,
                        this.character.state.position.z - nearbyThreat.state.position.z
                    ).normalize();
                    
                    // Apply the evasive movement
                    this.character.state.position.x += awayDirection.x * 2;
                    this.character.state.position.z += awayDirection.z * 2;
                }
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
        let leaderTarget: { character: Character, distance: number, isVulnerable: boolean } | null = null;
        let nearbyBones: { position: THREE.Vector3, distance: number }[] = [];

        // Get all bones and players from the scene
        const bones = collidables?.filter(obj => 
            obj instanceof THREE.Object3D && 
            obj.name === 'bone' && 
            obj.visible && 
            obj.parent
        ) || [];

        const players = allPlayers?.filter(p => p !== this.character) || [];

        // Find the current leader
        let currentLeader = players.reduce((leader, player) => {
            return (!leader || player.state.bones > leader.state.bones) ? player : leader;
        }, players[0]);

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

            // Check if this is the leader and evaluate for attack
            if (player === currentLeader && distance < this.LEADER_ATTACK_DISTANCE) {
                // Calculate if we're behind the leader
                const leaderForward = new THREE.Vector3(
                    Math.sin(player.state.rotation),
                    0,
                    Math.cos(player.state.rotation)
                );
                const toUs = new THREE.Vector3(
                    this.character.state.position.x - player.state.position.x,
                    0,
                    this.character.state.position.z - player.state.position.z
                ).normalize();
                const isBehind = leaderForward.dot(toUs) < -0.5;

                // Check if other dogs are also attacking the leader
                const packAttacking = players.some(otherDog => {
                    if (otherDog === this.character || otherDog === player) return false;
                    const dogToLeader = new THREE.Vector3(
                        player.state.position.x - otherDog.state.position.x,
                        0,
                        player.state.position.z - otherDog.state.position.z
                    ).length();
                    return dogToLeader < this.PACK_ATTACK_RANGE && otherDog.state.isBiting;
                });

                // Calculate attack probability bonus based on position
                const attackBonus = isBehind ? this.BEHIND_ATTACK_BONUS : 0;

                leaderTarget = {
                    character: player,
                    distance: distance * (1 - attackBonus), // Effectively reduces the perceived distance when behind
                    isVulnerable: isBehind || packAttacking || player.state.isJumping
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

        // Get player rankings
        const sortedPlayers = [...players, this.character].sort((a, b) => b.state.bones - a.state.bones);
        const ourRank = sortedPlayers.indexOf(this.character);
        const isBottomFive = ourRank >= sortedPlayers.length - 5;

        // Decision making based on state and rank
        let targetPosition: THREE.Vector3 | null = null;
        let shouldBite = false;
        let isPursuing = false;
        let isHuntingBones = false;
        let isSneaking = false;

        // Enhanced decision tree for behavior
        if (revengeTarget && this.character.state.bones >= this.MINIMUM_SAFE_BONES) {
            targetPosition = new THREE.Vector3(
                revengeTarget.character.state.position.x,
                revengeTarget.character.state.position.y,
                revengeTarget.character.state.position.z
            );
            shouldBite = revengeTarget.distance < 4;
            isPursuing = true;
        }
        // Leader targeting logic - maintained for all AIs
        else if (leaderTarget && 
                 ((this.character.state.bones >= this.MINIMUM_SAFE_BONES && leaderTarget.isVulnerable) || 
                  leaderTarget.character.state.bones > this.character.state.bones * 2)) {
            targetPosition = new THREE.Vector3(
                leaderTarget.character.state.position.x,
                leaderTarget.character.state.position.y,
                leaderTarget.character.state.position.z
            );
            const effectiveDistance = leaderTarget.distance;
            shouldBite = effectiveDistance < (leaderTarget.isVulnerable ? 4 : 3);
            isPursuing = true;
            isSneaking = !leaderTarget.isVulnerable;
        }
        // Modified behavior for bottom 5 AIs - more defensive and focused on bone collection
        else if (isBottomFive) {
            if (nearestPlayer && 
                nearestPlayer.distance < this.FLEE_DISTANCE * 1.2 && // Increased flee distance for bottom 5
                nearestPlayer.character.state.bones > this.character.state.bones * 0.9) {
                const awayVector = new THREE.Vector3(
                    this.character.state.position.x - nearestPlayer.character.state.position.x,
                    0,
                    this.character.state.position.z - nearestPlayer.character.state.position.z
                ).normalize();

                // Enhanced fleeing behavior - prioritize bones in escape path
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
                    const score = alignmentScore * distanceScore * 2; // Increased score multiplier for bottom 5
                    
                    if (score > bestFleeScore) {
                        bestFleeScore = score;
                        bestFleeTarget = bone.position;
                    }
                }

                if (bestFleeTarget && bestFleeScore > 0.3) { // Lower threshold for bottom 5 to pick up more bones while fleeing
                    targetPosition = bestFleeTarget;
                    isHuntingBones = true;
                } else {
                    targetPosition = new THREE.Vector3(
                        this.character.state.position.x + awayVector.x * 25, // Increased flee distance
                        this.character.state.position.y,
                        this.character.state.position.z + awayVector.z * 25
                    );
                }
            }
            // Prioritize bone collection for bottom 5
            else if (nearestBone) {
                const isSafeToCollect = !nearestPlayer || 
                                      nearestPlayer.distance > this.CHASE_DISTANCE * 1.2 || 
                                      this.character.state.bones >= nearestPlayer.character.state.bones * 0.7; // More lenient safety check
                
                if (isSafeToCollect) {
                    targetPosition = nearestBone.position;
                    isHuntingBones = true;
                }
            }
            // Attack only if we have a clear advantage
            else if (weakestPlayer && 
                     this.character.state.bones >= weakestPlayer.character.state.bones * 1.4 && // Require bigger advantage
                     weakestPlayer.distance < this.CHASE_DISTANCE * 0.8) { // Shorter chase distance
                targetPosition = new THREE.Vector3(
                    weakestPlayer.character.state.position.x,
                    weakestPlayer.character.state.position.y,
                    weakestPlayer.character.state.position.z
                );
                shouldBite = weakestPlayer.distance < 3;
                isPursuing = true;
            }
        }
        // Original behavior for top players
        else {
            // Prioritize bone collection first for top players
            if (nearestBone) {
                const isSafeToCollect = !nearestPlayer || 
                                      nearestPlayer.distance > this.CHASE_DISTANCE * 0.8 || // Reduced safety distance for top players
                                      this.character.state.bones >= nearestPlayer.character.state.bones * 0.7; // More aggressive bone collection
                
                if (isSafeToCollect) {
                    targetPosition = nearestBone.position;
                    isHuntingBones = true;
                }
            }
            // Then consider fleeing from threats
            else if (nearestPlayer && 
                nearestPlayer.distance < this.FLEE_DISTANCE && 
                (this.character.state.bones < (nearestPlayer.character.state.bones * 0.8) || 
                 (this.character.state.bones > 20 && nearestPlayer.character.state.bones > this.character.state.bones * 0.9))) {
                const awayVector = new THREE.Vector3(
                    this.character.state.position.x - nearestPlayer.character.state.position.x,
                    0,
                    this.character.state.position.z - nearestPlayer.character.state.position.z
                ).normalize();

                // Enhanced fleeing behavior - prioritize bones in escape path
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
                    const score = alignmentScore * distanceScore * 1.8; // Increased score multiplier for top players
                    
                    if (score > bestFleeScore) {
                        bestFleeScore = score;
                        bestFleeTarget = bone.position;
                    }
                }

                if (bestFleeTarget && bestFleeScore > 0.3) { // Lower threshold to pick up more bones while fleeing
                    targetPosition = bestFleeTarget;
                    isHuntingBones = true;
                } else {
                    targetPosition = new THREE.Vector3(
                        this.character.state.position.x + awayVector.x * 20,
                        this.character.state.position.y,
                        this.character.state.position.z + awayVector.z * 20
                    );
                }
            }
            // Finally consider attacking weaker players
            else if (weakestPlayer && 
                     (this.character.state.bones >= weakestPlayer.character.state.bones * 1.2 || 
                      (this.character.state.bones >= 15 && weakestPlayer.character.state.bones < this.character.state.bones * 0.9))) {
                targetPosition = new THREE.Vector3(
                    weakestPlayer.character.state.position.x,
                    weakestPlayer.character.state.position.y,
                    weakestPlayer.character.state.position.z
                );
                shouldBite = weakestPlayer.distance < 3.5;
                isPursuing = true;
            }
        }

        this.moveTowardsTarget(targetPosition, isPursuing, isHuntingBones, shouldBite, deltaTime, collidables, collidableBoxes, isSneaking);

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
                this.character.state.isBarking = true;
                this.character.state.barkAnimationTime = 0;
            }
        }
    }

    private detectPlatforms(collidables?: THREE.Object3D[]): { platform: THREE.Object3D, height: number }[] {
        if (!collidables) return [];
        
        const platforms: { platform: THREE.Object3D, height: number }[] = [];
        const currentHeight = this.character.state.position.y;
        
        // Cast rays in a circle around the character to detect platforms
        const rayCount = 8;
        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * Math.PI * 2;
            const direction = new THREE.Vector3(
                Math.cos(angle),
                0.5, // Slightly upward to detect platforms
                Math.sin(angle)
            ).normalize();

            const raycaster = new THREE.Raycaster(
                new THREE.Vector3(
                    this.character.state.position.x,
                    this.character.state.position.y,
                    this.character.state.position.z
                ),
                direction,
                0,
                this.PLATFORM_DETECTION_RANGE
            );

            const intersects = raycaster.intersectObjects(collidables);
            for (const intersect of intersects) {
                const heightDiff = intersect.point.y - currentHeight;
                if (heightDiff > 0 && heightDiff < this.PLATFORM_HEIGHT_THRESHOLD) {
                    platforms.push({
                        platform: intersect.object,
                        height: heightDiff
                    });
                    break;
                }
            }
        }

        return platforms;
    }

    private shouldJumpToPlatform(
        targetPosition: THREE.Vector3,
        platforms: { platform: THREE.Object3D, height: number }[],
        isPursuing: boolean,
        isHuntingBones: boolean
    ): boolean {
        if (this.platformJumpCooldown > 0) return false;
        if (this.character.state.isJumping) return false;
        if (platforms.length === 0) return false;

        // Check if we're too close to our last jump position
        if (this.lastPlatformJumpPosition) {
            const distanceFromLastJump = new THREE.Vector3(
                this.character.state.position.x,
                this.character.state.position.y,
                this.character.state.position.z
            ).distanceTo(this.lastPlatformJumpPosition);

            // Avoid jumping if we're too close to our last jump position
            if (distanceFromLastJump < this.MIN_PLATFORM_JUMP_DISTANCE) {
                return false;
            }

            // If we're still near where we last jumped and not much higher, try to move away
            if (distanceFromLastJump < this.SAME_SPOT_THRESHOLD && 
                Math.abs(this.character.state.position.y - this.lastPlatformJumpPosition.y) < 1) {
                return false;
            }
        }

        const targetHeight = targetPosition.y;
        const currentHeight = this.character.state.position.y;
        const heightDiff = targetHeight - currentHeight;

        // If target is significantly higher, try to find a platform to jump to
        if (heightDiff > this.VERTICAL_ADVANTAGE_THRESHOLD) {
            const suitablePlatform = platforms.find(p => {
                // Check if this platform would actually help us reach the target
                const platformHeightGain = p.height;
                return platformHeightGain > 0 && 
                       platformHeightGain < this.PLATFORM_HEIGHT_THRESHOLD &&
                       platformHeightGain > heightDiff * 0.4; // Platform should help us gain at least 40% of needed height
            });
            if (suitablePlatform) return true;
        }

        // If being chased and lower than pursuer, look for higher ground
        if (!isPursuing && heightDiff < -this.VERTICAL_ADVANTAGE_THRESHOLD) {
            const escapePlatform = platforms.find(p => {
                // Look for platforms that give us significant height advantage
                const platformHeightGain = p.height;
                return platformHeightGain > Math.abs(heightDiff) * 0.7 && 
                       platformHeightGain < this.PLATFORM_HEIGHT_THRESHOLD &&
                       (!this.lastPlatformJumpPosition || 
                        platformHeightGain > this.lastPlatformJumpPosition.y - currentHeight); // Ensure we're gaining height
            });
            if (escapePlatform) return true;
        }

        // More strategic platform usage when hunting bones
        if (isHuntingBones) {
            // Find the highest reachable platform that we haven't jumped to recently
            const bestPlatform = platforms.reduce((best, current) => {
                if (current.height >= this.PLATFORM_HEIGHT_THRESHOLD) return best;
                if (!best) return current;
                return current.height > best.height ? current : best;
            }, null as { platform: THREE.Object3D, height: number } | null);

            if (bestPlatform && 
                (!this.lastPlatformJumpPosition || 
                 bestPlatform.height > this.lastPlatformJumpPosition.y - currentHeight + 0.5)) {
                return Math.random() < 0.15; // Reduced random chance but better tactical choices
            }
        }

        return false;
    }

    private moveTowardsTarget(
        targetPosition: THREE.Vector3 | null,
        isPursuing: boolean,
        isHuntingBones: boolean,
        shouldBite: boolean,
        deltaTime: number,
        collidables?: THREE.Object3D[],
        collidableBoxes?: THREE.Box3[],
        isSneaking: boolean = false
    ) {
        // Update cooldowns
        if (this.platformJumpCooldown > 0) {
            this.platformJumpCooldown--;
        }
        if (this.lastJumpTime > 0) {
            this.lastJumpTime = Math.max(0, this.lastJumpTime - 1);
        }

        // Check for ground support and apply gravity
        const currentPos = new THREE.Vector3(
            this.character.state.position.x,
            this.character.state.position.y,
            this.character.state.position.z
        );
        const { collision: hasSupport } = this.character.checkGroundAndPlatformCollision(currentPos, collidables);

        // If no support and not already jumping, start falling
        if (!hasSupport && !this.character.state.isJumping && this.character.state.position.y > this.character.GROUND_LEVEL) {
            this.character.state.isJumping = true;
            this.character.state.jumpVelocity = 0;
        }

        // Apply gravity and update vertical position if jumping or falling
        if (this.character.state.isJumping) {
            this.character.state.jumpVelocity -= this.character.GRAVITY * deltaTime * 60;
            const newPosition = new THREE.Vector3(
                this.character.state.position.x,
                this.character.state.position.y + this.character.state.jumpVelocity,
                this.character.state.position.z
            );

            const { collision, groundHeight } = this.character.checkGroundAndPlatformCollision(newPosition, collidables);

            if (this.character.state.jumpVelocity < 0 && (collision || newPosition.y <= groundHeight)) {
                this.character.state.position.y = groundHeight;
                this.character.state.isJumping = false;
                this.character.state.jumpVelocity = 0;
            } else {
                this.character.state.position.y = newPosition.y;
            }
        }

        // Function to check if we can attempt a jump
        const canAttemptJump = () => {
            return !this.character.state.isJumping && 
                   !this.character.state.isBiting && 
                   this.lastJumpTime <= 0 &&
                   this.character.state.knockbackTime <= 0;
        };

        if (targetPosition) {
            const direction = new THREE.Vector3(
                targetPosition.x - this.character.state.position.x,
                0,
                targetPosition.z - this.character.state.position.z
            ).normalize();

            const isCurrentlyStuck = this.isStuck();
            const nearbyPlatforms = this.detectPlatforms(collidables);
            
            // Platform jumping logic
            if (this.shouldJumpToPlatform(targetPosition, nearbyPlatforms, isPursuing, isHuntingBones)) {
                this.character.state.isJumping = true;
                this.character.state.jumpVelocity = this.character.JUMP_FORCE * 1.2;
                this.platformJumpCooldown = this.PLATFORM_JUMP_COOLDOWN;
                this.lastPlatformJumpPosition = new THREE.Vector3(
                    this.character.state.position.x,
                    this.character.state.position.y,
                    this.character.state.position.z
                );
            }

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
                    
                    // More conservative jumping when stuck
                    if (canAttemptJump() && Math.random() < this.STUCK_JUMP_CHANCE) {
                        this.character.state.isJumping = true;
                        this.character.state.jumpVelocity = this.character.JUMP_FORCE * 
                            (isCurrentlyStuck ? 1.4 : 1.2);
                        this.lastJumpTime = this.MINIMUM_JUMP_INTERVAL;
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
                moveSpeed *= isSneaking ? this.SNEAK_SPEED_MULTIPLIER : 1.3;
            }

            const newPosition = new THREE.Vector3(
                this.character.state.position.x + direction.x * moveSpeed,
                this.character.state.position.y,
                this.character.state.position.z + direction.z * moveSpeed
            );

            // Random jumping behavior with stricter conditions
            if (canAttemptJump()) {
                // Base random jumping - only when actively hunting bones
                if (isHuntingBones && !isPursuing && 
                    Math.random() < this.RANDOM_JUMP_CHANCE * deltaTime * 60) {
                    this.character.state.isJumping = true;
                    this.character.state.jumpVelocity = this.character.JUMP_FORCE * 0.8;
                    this.lastJumpTime = this.MINIMUM_JUMP_INTERVAL;
                    if (Math.random() < 0.2) { // Further reduced bark chance
                        AudioManager.getInstance().playBarkSound();
                    }
                }

                // Defensive jumping only when being chased and at a disadvantage
                if (!isPursuing && obstacles.length > 0 && 
                    obstacles[0].distance < this.DEFENSIVE_JUMP_DISTANCE && 
                    this.character.state.bones < 5 && // Only jump away if we have few bones
                    Math.random() < this.DEFENSIVE_JUMP_CHANCE) {
                    this.character.state.isJumping = true;
                    this.character.state.jumpVelocity = this.character.JUMP_FORCE * 1.3;
                    this.lastJumpTime = this.MINIMUM_JUMP_INTERVAL;
                    
                    // Add some horizontal velocity away from the obstacle
                    const awayDirection = new THREE.Vector3(
                        this.character.state.position.x - obstacles[0].point.x,
                        0,
                        this.character.state.position.z - obstacles[0].point.z
                    ).normalize();
                    
                    // Apply the evasive movement
                    this.character.state.position.x += awayDirection.x * 2;
                    this.character.state.position.z += awayDirection.z * 2;
                }
            }

            if (!this.character.checkCollision(newPosition, collidables, collidableBoxes)) {
                this.character.state.position.x = newPosition.x;
                this.character.state.position.z = newPosition.z;
                this.character.state.isMoving = true;
            }
        } else {
            // Drastically reduced idle jumping
            if (Math.random() < 0.01 * deltaTime * 60) { // Reduced from 0.02 to 0.01
                this.character.state.rotation += (Math.random() - 0.5) * Math.PI * deltaTime;
                if (canAttemptJump() && Math.random() < 0.02) { // Reduced from 0.05 to 0.02
                    this.character.state.isJumping = true;
                    this.character.state.jumpVelocity = this.character.JUMP_FORCE * 0.8; // Reduced jump force
                    this.lastJumpTime = this.MINIMUM_JUMP_INTERVAL;
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