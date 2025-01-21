import * as THREE from 'three';
import { Character } from './Character';

export class Hydrant {
    mesh: THREE.Group;
    position: THREE.Vector3;
    private readonly PULL_RADIUS = 8;
    private readonly PULL_FORCE = 1.8; // Reduced from 2.0 for slower movement
    private readonly DRAG_FACTOR = 0.85; // Slightly reduced drag for smoother movement
    private readonly POSITION_CHANGE_FACTOR = 0.03; // Reduced from 0.1 for slower direct position change
    private readonly DURATION = 5000;
    private readonly MAX_SPEED = 0.3; // Reduced max speed for slower movement
    private readonly STAGE_SIZE = 100; // Match the stage size from Stage.tsx
    private spawnTime: number;
    private isActive: boolean = true;
    static readonly COOLDOWN = 15000; // 15 seconds cooldown
    static lastSpawnTime = 0;
    private owner: Character;
    private radiusIndicator: THREE.Mesh;
    private pulseRings: THREE.Mesh[] = [];
    private readonly NUM_PULSE_RINGS = 3;
    private readonly PULSE_SPEED = 2;
    private clippingPlanes: THREE.Plane[];

    constructor(position: THREE.Vector3, owner: Character) {
        this.position = position;
        this.owner = owner;
        this.spawnTime = Date.now();
        Hydrant.lastSpawnTime = Date.now();
        
        // Create clipping planes for the stage boundaries
        const halfSize = this.STAGE_SIZE / 2;
        this.clippingPlanes = [
            new THREE.Plane(new THREE.Vector3(1, 0, 0), halfSize),   // Right wall
            new THREE.Plane(new THREE.Vector3(-1, 0, 0), halfSize),  // Left wall
            new THREE.Plane(new THREE.Vector3(0, 0, 1), halfSize),   // Front wall
            new THREE.Plane(new THREE.Vector3(0, 0, -1), halfSize)   // Back wall
        ];
        
        this.mesh = this.createHydrant();
        this.radiusIndicator = this.createRadiusIndicator();
        this.createPulseRings();
        this.mesh.add(this.radiusIndicator);
        this.pulseRings.forEach(ring => this.mesh.add(ring));
        this.mesh.position.copy(position);
    }

    private createPulseRings(): void {
        for (let i = 0; i < this.NUM_PULSE_RINGS; i++) {
            const geometry = new THREE.RingGeometry(0.5, 0.7, 32);
            const material = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide,
                clippingPlanes: this.clippingPlanes
            });
            const ring = new THREE.Mesh(geometry, material);
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.02;
            this.pulseRings.push(ring);
        }
    }

    private updatePulseRings(): void {
        const baseSpeed = this.PULSE_SPEED;
        this.pulseRings.forEach((ring, index) => {
            // Calculate the phase offset for each ring
            const phaseOffset = (index / this.NUM_PULSE_RINGS) * Math.PI * 2;
            const time = (Date.now() - this.spawnTime) / 1000;
            
            // Calculate the current scale and opacity based on time
            const progress = ((time * baseSpeed + phaseOffset) % (Math.PI * 2)) / (Math.PI * 2);
            const scale = this.PULL_RADIUS * (1 - progress);
            
            // Scale the ring and update its opacity
            ring.scale.set(scale, scale, 1);
            (ring.material as THREE.MeshBasicMaterial).opacity = 
                0.3 * (1 - progress) * (this.DURATION - (Date.now() - this.spawnTime)) / this.DURATION;
        });
    }

    static canSpawn(): boolean {
        return Date.now() - Hydrant.lastSpawnTime >= Hydrant.COOLDOWN;
    }

    private createRadiusIndicator(): THREE.Mesh {
        // Create a transparent circle to show the pull radius
        const geometry = new THREE.CircleGeometry(this.PULL_RADIUS, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide,
            clippingPlanes: this.clippingPlanes
        });
        const circle = new THREE.Mesh(geometry, material);
        
        // Rotate to lay flat on the ground and position slightly above to prevent z-fighting
        circle.rotation.x = -Math.PI / 2;
        circle.position.y = 0.01;

        return circle;
    }

    private createHydrant(): THREE.Group {
        const hydrantGroup = new THREE.Group();

        // Create the main body (red cylinder)
        const bodyGeometry = new THREE.CylinderGeometry(0.3, 0.4, 2, 8);
        const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);

        // Create the top cap
        const capGeometry = new THREE.CylinderGeometry(0.2, 0.3, 0.3, 8);
        const cap = new THREE.Mesh(capGeometry, bodyMaterial);
        cap.position.y = 1.15;

        // Create the side nozzles
        const nozzleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8);
        const nozzle1 = new THREE.Mesh(nozzleGeometry, bodyMaterial);
        nozzle1.rotation.z = Math.PI / 2;
        nozzle1.position.set(0.3, 0.8, 0);

        const nozzle2 = nozzle1.clone();
        nozzle2.position.set(-0.3, 0.8, 0);

        hydrantGroup.add(body);
        hydrantGroup.add(cap);
        hydrantGroup.add(nozzle1);
        hydrantGroup.add(nozzle2);

        // Position the hydrant so its base is on the ground
        hydrantGroup.position.y = 1;

        return hydrantGroup;
    }

    update(characters: Character[]) {
        if (!this.isActive) return;

        if (Date.now() - this.spawnTime >= this.DURATION) {
            this.isActive = false;
            return;
        }

        // Update radius indicator opacity based on remaining time
        const remainingTime = this.DURATION - (Date.now() - this.spawnTime);
        const opacity = (remainingTime / this.DURATION) * 0.2;
        (this.radiusIndicator.material as THREE.MeshBasicMaterial).opacity = opacity;

        // Update pulse rings
        this.updatePulseRings();

        // Pull in nearby characters
        characters.forEach(character => {
            if (character === this.owner) return;

            const characterPos = new THREE.Vector3(
                character.state.position.x,
                character.state.position.y,
                character.state.position.z
            );

            const toHydrant = new THREE.Vector3()
                .copy(this.position)
                .sub(characterPos);

            const distanceLength = toHydrant.length();

            if (distanceLength < this.PULL_RADIUS) {
                // Create the pull vector towards the hydrant with distance-based scaling
                const distanceRatio = distanceLength / this.PULL_RADIUS;
                const pullStrength = this.PULL_FORCE * (1 - 0.5 * distanceRatio); // Stronger when closer
                const pullVector = toHydrant.normalize().multiplyScalar(pullStrength);
                
                // Directly modify position slightly for immediate effect
                character.state.position.x += pullVector.x * this.POSITION_CHANGE_FACTOR;
                character.state.position.z += pullVector.z * this.POSITION_CHANGE_FACTOR;
                
                // Add the pull force to the current velocity
                character.state.velocity.add(pullVector);

                // Apply increased drag to make the pull more effective
                character.state.velocity.multiplyScalar(this.DRAG_FACTOR);

                // Ensure velocity doesn't exceed maximum speed
                if (character.state.velocity.length() > this.MAX_SPEED) {
                    character.state.velocity.normalize().multiplyScalar(this.MAX_SPEED);
                }

                // Override any AI movement temporarily
                if (character.state.isMoving) {
                    character.state.isMoving = false;
                }
            }
        });
    }

    shouldRemove(): boolean {
        return !this.isActive;
    }
} 