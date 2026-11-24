import { useEffect, useRef, useState, FC } from 'react';
import * as THREE from 'three';
import Character, { DogPattern } from './Character';
import { Stage } from './Stage';
import { Hydrant } from './Hydrant';
import PowerCooldown from '../UI/PowerCooldown';
import AudioManager from '../../utils/AudioManager';
import { FaVolumeUp, FaVolumeMute } from 'react-icons/fa';
import WinModal from '../UI/WinModal';
import { NetworkManager, NetworkGameState } from '../../network/NetworkManager';
import { toVector3 } from '../../types/Position';

interface GameState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  stage: Stage;
  player: Character;
  lastTime: number;
  keys: { [key: string]: boolean };
  hydrants: Hydrant[];
}

interface GameProps {
  playerName: string;
  colorIndex: number;
  onReturnToMenu: () => void;
  roomCode?: string;
}

const getColorHexString = (colorOption: THREE.Color | DogPattern): string => {
  if (colorOption instanceof THREE.Color) {
    return colorOption.getHexString();
  }
  return colorOption.base.getHexString();
};

const Game: FC<GameProps> = ({ playerName, colorIndex, onReturnToMenu, roomCode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const [scores, setScores] = useState<{bones: number, size: number}>({ bones: 0, size: 1 });
  const [players, setPlayers] = useState<Character[]>([]);
  const [isMuted, setIsMuted] = useState(AudioManager.getInstance().isSoundMuted());
  const [showWinModal, setShowWinModal] = useState(false);
  const [winner, setWinner] = useState<Character | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const networkManager = NetworkManager.getInstance();

  // Add debounced state updates


  useEffect(() => {
    const networkManager = NetworkManager.getInstance();
    
    // Connect to the room if not already connected
    if (roomCode && !networkManager.isConnected()) {
      networkManager.joinRoom(roomCode, playerName);
    }

    // Setup connection status listener
    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => {
      setIsConnected(false);
      if (gameStateRef.current) {
        // Clean up game state on disconnect
        gameStateRef.current = null;
      }
    };

    // Handle game start event
    const handleGameStart = () => {
      console.log('Game started, initializing game state...');
      if (!gameStateRef.current) {
        // Initialize game state if not already initialized
        setIsConnected(true);
      }
    };

    networkManager.on('connect', handleConnect);
    networkManager.on('disconnect', handleDisconnect);
    networkManager.onGameStart(handleGameStart);
    
    // Set initial connection status
    setIsConnected(networkManager.isConnected());

    return () => {
      networkManager.off('connect', handleConnect);
      networkManager.off('disconnect', handleDisconnect);
      networkManager.off('gameStart', handleGameStart);
    };
  }, [roomCode, playerName]);

  useEffect(() => {
    // Only initialize game when connected and socket ID is available
    if (!isConnected || !containerRef.current || !networkManager.isConnected()) return;

    let socketId;
    try {
      socketId = networkManager.getSocketId();
    } catch (error) {
      console.error('Socket ID not available yet');
      return;
    }
    
    // Start game music
    const audioManager = AudioManager.getInstance();
    audioManager.playGameMusic();

    // Initialize Three.js scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue background

    // Initialize camera
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);

    // Initialize renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true; // Enable clipping planes
    containerRef.current.appendChild(renderer.domElement);

    // Create HTML container for name tags
    const nameTagsContainer = document.createElement('div');
    nameTagsContainer.classList.add('nametags-container');
    nameTagsContainer.style.position = 'absolute';
    nameTagsContainer.style.left = '0';
    nameTagsContainer.style.top = '0';
    nameTagsContainer.style.width = '100%';
    nameTagsContainer.style.height = '100%';
    nameTagsContainer.style.pointerEvents = 'none';
    containerRef.current.appendChild(nameTagsContainer);

    // Initialize lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 0);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);

    // Initialize stage and player
    const stage = new Stage(scene);
    const localPlayer = new Character(false, colorIndex, playerName);
    localPlayer.state.id = socketId;
    localPlayer.dog.name = `Dog_${socketId}`; // Unique name for local player's dog
    localPlayer.state.name = `${playerName}_${socketId.slice(0, 4)}`; // Make player name unique

    // Initialize game state
    gameStateRef.current = {
      scene,
      camera,
      renderer,
      stage,
      player: localPlayer,
      lastTime: performance.now(),
      keys: {},
      hydrants: [],
    };

    // Set up game state listener to handle server layout
    networkManager.onGameState((state: NetworkGameState) => {
      if (!gameStateRef.current) return;

      // Initialize stage layout from server if available
      if (state.stageLayout && !gameStateRef.current.stage.isLayoutInitialized) {
        console.log('Initializing stage layout from server');
        gameStateRef.current.stage.initializeFromServerLayout(state.stageLayout);
      }

      // Rest of the game state handling...
    });

    // Get spawn position from server state or generate new one
    const spawnPosition = stage.findSafeRespawnLocation();
    localPlayer.state.position = spawnPosition;
    localPlayer.updateDogPosition();

    // Add local player to stage and send initial state
    gameStateRef.current.stage.players = [localPlayer];
    gameStateRef.current.scene.add(localPlayer.dog);
    
    // Create nametag with unique ID
    stage.createNameTag(localPlayer, `nametag_${socketId}`);
    
    // Send initial player state to server
    networkManager.updatePlayerState({
      id: socketId,
      name: localPlayer.state.name,
      colorIndex: localPlayer.state.colorIndex,
      position: localPlayer.state.position,
      rotation: localPlayer.state.rotation,
      size: localPlayer.state.size,
      bones: localPlayer.state.bones,
      isAI: false,
      actions: {
        isMoving: localPlayer.state.isMoving,
        isBiting: localPlayer.state.isBiting,
        isMarking: localPlayer.state.isMarking,
        hasZoomies: localPlayer.state.hasZoomies
      }
    });

    // Network state handling
    networkManager.onGameState((state: NetworkGameState) => {
      if (!gameStateRef.current) return;

      // IMPORTANT: Process the complete state every time
      console.log(`Received state update: seq=${state.sequenceNumber}, timestamp=${state.timestamp}, ${state.aiDogs?.length || 0} AI dogs`);

      // Create stage layout from server data if provided
      if (state.stageLayout && !gameStateRef.current.stage.isLayoutInitialized) {
        console.log(`Initializing stage layout with server data, seed: ${state.stageLayout.seed}`);
        gameStateRef.current.stage.initializeFromServerLayout(state.stageLayout);
      }

      // Update bones only if they've changed
      if (state.stageState?.bones) {
        // First, build a map of existing bones for quick lookup
        const existingBonesMap = new Map();
        gameStateRef.current.stage.bones.forEach(bone => {
          existingBonesMap.set(bone.id, bone);
        });
        
        // Track which bones are still in the current state
        const currentBoneIds = new Set(state.stageState.bones.map(b => b.id));
        
        // Remove collected bones or ones no longer in state
        gameStateRef.current.stage.bones = gameStateRef.current.stage.bones.filter(bone => {
          if (!currentBoneIds.has(bone.id)) {
            console.log(`Removing bone: ${bone.id}`);
            gameStateRef.current?.scene.remove(bone.mesh);
            return false;
          }
          
          // Check if the bone is collected according to server
          const networkBone = state.stageState?.bones.find(b => b.id === bone.id);
          if (networkBone?.isCollected) {
            console.log(`Bone collected: ${bone.id}`);
            gameStateRef.current?.scene.remove(bone.mesh);
            return false;
          }
          
          return true;
        });

        // Add new bones
        state.stageState.bones.forEach(networkBone => {
          if (!networkBone.isCollected && !existingBonesMap.has(networkBone.id)) {
            console.log(`Adding new bone: ${networkBone.id}`);
            const bone = gameStateRef.current?.stage.createBone(toVector3(networkBone.position));
            if (bone) {
              bone.id = networkBone.id;
              gameStateRef.current?.stage.bones.push(bone);
            }
          }
        });
      }

      // Update all remote players (save server state as target positions)
      const allPlayers = Object.values(state.players || {});
      const localPlayerId = networkManager.getSocketId();
      
      allPlayers.forEach((networkPlayer) => {
        const isLocalPlayer = networkPlayer.id === localPlayerId;
        let character = gameStateRef.current?.stage.players.find(p => p.state.id === networkPlayer.id);

        if (!character && !isLocalPlayer && gameStateRef.current) {
          // Create new character for remote player
          character = new Character(false, networkPlayer.colorIndex, networkPlayer.name);
          character.state.id = networkPlayer.id;
          character.dog.name = `Dog_${networkPlayer.id}`;
          character.state.position = toVector3(networkPlayer.position);
          character.updateDogPosition();
          
          // Initialize target position for interpolation
          character.state.targetPosition = toVector3(networkPlayer.position); 
          character.state.targetRotation = networkPlayer.rotation;
          
          gameStateRef.current.stage.players.push(character);
          gameStateRef.current.scene.add(character.dog);
          if (character.state.id) {
            gameStateRef.current.stage.createNameTag(character, `nametag_${character.state.id}`);
          }
        }

        if (character && !isLocalPlayer) {
          // For remote players, set target positions for interpolation
          character.state.targetPosition = toVector3(networkPlayer.position);
          character.state.targetRotation = networkPlayer.rotation;
          
          // Update properties immediately
          character.state.size = networkPlayer.size;
          character.state.bones = networkPlayer.bones;
          character.state.isMoving = networkPlayer.actions.isMoving;
          character.state.isBiting = networkPlayer.actions.isBiting;
          character.state.isMarking = networkPlayer.actions.isMarking;
          character.state.hasZoomies = networkPlayer.actions.hasZoomies;
          
          // Force update dog scale
          character.dog.scale.setScalar(networkPlayer.size);
        } else if (character && isLocalPlayer) {
          // For local player, reconcile with server state
          reconcilePlayerState(networkPlayer);
        }
      });

      // Update AI dogs with more robust handling
      if (state.aiDogs) {
        // IMPORTANT: Create unique map keys using both ID and name to ensure stability
        // Map AI dogs by both ID AND name for more robust tracking
        console.log(`Processing ${state.aiDogs.length} AI dogs from server`);
        
        // Create a map of existing AI dogs for efficient lookup (by ID first, then by name)
        const existingAIDogsByID = new Map<string, Character>();
        const existingAIDogsByName = new Map<string, Character>();
        
        gameStateRef.current.stage.players
          .filter(p => p.isAI)
          .forEach(aiDog => {
            // Store by ID if available
            if (aiDog.state.id) {
              existingAIDogsByID.set(aiDog.state.id, aiDog);
            }
            // Also store by name for fallback
            existingAIDogsByName.set(aiDog.state.name, aiDog);
          });
          
        // Track which server AI dogs we've processed
        const processedServerDogs = new Set<string>();
        
        // Process each AI dog from server
        state.aiDogs.forEach(aiDog => {
          // Track this server dog
          processedServerDogs.add(aiDog.id);
          
          // First try to find by ID (most reliable)
          let character = existingAIDogsByID.get(aiDog.id);
          
          // If not found by ID, try by name
          if (!character) {
            character = existingAIDogsByName.get(aiDog.name);
            
            // If found by name but not by ID, update the ID
            if (character && character.state.id !== aiDog.id) {
              console.log(`Updating AI dog ID from ${character.state.id} to ${aiDog.id} for ${aiDog.name}`);
              character.state.id = aiDog.id;
              
              // Update the ID in our tracking map
              existingAIDogsByID.set(aiDog.id, character);
            }
          }
          
          const serverPosition = toVector3(aiDog.position);
          
          if (character) {
            // Update existing AI dog with new position and state
            const positionChanged = Math.abs(character.state.position.x - aiDog.position.x) > 0.1 ||
                                    Math.abs(character.state.position.z - aiDog.position.z) > 0.1;
                                    
            if (aiDog.isMoving || positionChanged) {
              console.log(`Updating AI dog: ${aiDog.name} at (${aiDog.position.x.toFixed(2)}, ${aiDog.position.z.toFixed(2)}), moving: ${aiDog.isMoving}`);
            }
            
            // Always update position and rotation from server
            character.state.position = serverPosition;
            character.state.rotation = aiDog.rotation;
            character.state.size = aiDog.size;
            character.state.isMoving = aiDog.isMoving;
            character.state.id = aiDog.id; // Ensure ID is set
            character.updateDogPosition();
            
            // Force update dog scale
            character.dog.scale.setScalar(aiDog.size);
            
            // Ensure this dog has a proper name tag
            if (!gameStateRef.current?.stage.nameTags[aiDog.name]) {
              console.log(`Creating missing name tag for AI dog: ${aiDog.name}`);
              gameStateRef.current?.stage.createNameTag(character, `nametag_${aiDog.id}`);
            }
          } else if (gameStateRef.current) {
            // Create new AI dog if not found
            console.log(`Creating new AI dog: ${aiDog.name} (${aiDog.id})`);
            character = new Character(true, aiDog.colorIndex, aiDog.name);
            character.state.id = aiDog.id;
            character.dog.name = `Dog_${aiDog.id}`;
            character.state.position = serverPosition;
            character.state.rotation = aiDog.rotation;
            character.state.size = aiDog.size;
            character.state.isMoving = aiDog.isMoving;
            character.updateDogPosition();
            
            // Add to scene
            gameStateRef.current.stage.players.push(character);
            gameStateRef.current.scene.add(character.dog);
            
            // Create nametag for AI dog
            gameStateRef.current.stage.createNameTag(character, `nametag_${aiDog.id}`);
            
            // Add to tracking maps
            existingAIDogsByID.set(aiDog.id, character);
            existingAIDogsByName.set(aiDog.name, character);
          }
        });

        // Remove any AI dogs not in the current server state
        if (gameStateRef.current && state.aiDogs.length > 0) { 
          // Collect dogs to remove (any AI dog not in the processed server dogs set)
          const staleAIDogs: Character[] = [];
          
          gameStateRef.current.stage.players = gameStateRef.current.stage.players.filter(p => {
            // Keep all non-AI players
            if (!p.isAI) return true;
            
            // Keep AI dogs that are in the current server state
            if (p.state.id && processedServerDogs.has(p.state.id)) {
              return true;
            }
            
            // Remove stale dogs
            staleAIDogs.push(p);
            return false;
          });
          
          // Clean up removed dogs
          staleAIDogs.forEach(p => {
            console.log(`Removing stale AI dog: ${p.state.name} (${p.state.id})`);
            
            // Remove from scene
            gameStateRef.current?.scene.remove(p.dog);
            
            // Remove nametag if it exists
            const nameTag = gameStateRef.current?.stage.nameTags[p.state.name];
            if (nameTag && nameTag.parentElement && gameStateRef.current) {
              nameTag.parentElement.removeChild(nameTag);
              delete gameStateRef.current.stage.nameTags[p.state.name];
            }
          });
        }
      }

      // Update scores and leaderboard
      if (gameStateRef.current) {
        // Update local player stats from network state
        const networkLocalPlayer = Object.values(state.players || {}).find(p => p.id === networkManager.getSocketId());
        if (networkLocalPlayer && gameStateRef.current.player) {
          // Apply server's authoritative state to local player
          gameStateRef.current.player.state.bones = networkLocalPlayer.bones;
          gameStateRef.current.player.state.size = networkLocalPlayer.size;
          
          // Force update dog scale to match new size
          gameStateRef.current.player.dog.scale.setScalar(networkLocalPlayer.size);
          
          // Update scores display immediately, without debouncing
          setScores({
            bones: networkLocalPlayer.bones,
            size: networkLocalPlayer.size
          });
        }
        
        // Update leaderboard with all players including AI - deduped with Map
        const playersMap = new Map();
        
        // First add human players from state
        Object.values(state.players || {}).forEach(p => {
          const player = gameStateRef.current?.stage.players.find(sp => sp.state.id === p.id) || 
                        (p.id === localPlayerId ? gameStateRef.current?.player : null);
          if (player) {
            // Apply server's authoritative state
            player.state.bones = p.bones;
            player.state.size = p.size;
            
            // Force update dog scale to match
            player.dog.scale.setScalar(p.size);
            
            // Use name as key to avoid duplicates
            playersMap.set(player.state.name, player);
          }
        });
        
        // Then add AI dogs, overriding any duplicates by name
        (state.aiDogs || []).forEach(ai => {
          const aiDog = gameStateRef.current?.stage.players.find(p => p.isAI && p.state.id === ai.id);
          if (aiDog) {
            aiDog.state.bones = 0;
            aiDog.state.size = ai.size;
            
            // Force update dog scale to match
            aiDog.dog.scale.setScalar(ai.size);
            
            // Use name as key to avoid duplicates
            playersMap.set(aiDog.state.name, aiDog);
          }
        });

        // Convert the map back to an array
        setPlayers(Array.from(playersMap.values()) as Character[]);
      }
    });

    // Handle window resize
    const handleResize = () => {
      if (!gameStateRef.current) return;
      const { camera, renderer } = gameStateRef.current;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Handle keyboard input
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameStateRef.current || !e.key) return;
      
      const controlKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
      // Prevent default browser behavior for game controls
      if (controlKeys.includes(e.key)) {
        e.preventDefault();
      }
      
      gameStateRef.current.keys[e.key.toLowerCase()] = true;

      // Handle hydrant spawn on 'h' key press
      if (e.key.toLowerCase() === 'h') {
        if (Hydrant.canSpawn()) {
          const playerPos = gameStateRef.current.player.state.position;
          const hydrant = new Hydrant(
            toVector3(playerPos),
            gameStateRef.current.player
          );
          gameStateRef.current.hydrants.push(hydrant);
          gameStateRef.current.scene.add(hydrant.mesh);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!gameStateRef.current) return;
      
      // Prevent default browser behavior for game controls
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      
      gameStateRef.current.keys[e.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Animation loop
    const animate = () => {
      if (!gameStateRef.current) return;
      const {
        scene,
        camera,
        renderer,
        stage,
        player,
        keys,
      } = gameStateRef.current;

      const currentTime = performance.now();
      const deltaTime = (currentTime - gameStateRef.current.lastTime) / 1000;
      gameStateRef.current.lastTime = currentTime;

      // Check for win condition
      if (player.state.bones >= 100 && !showWinModal) {
        setShowWinModal(true);
        setWinner(player);
        // Stop all character movement
        stage.players.forEach(p => {
          p.state.isMoving = false;
          p.state.isBiting = false;
        });
        return;
      }

      // Only update local player's movement and actions if game is not won
      if (player && !showWinModal) {
        // STRICT LOCAL PLAYER HANDLING
        
        // Handle keyboard input for player character
        const moveDirection = new THREE.Vector3();

        if (keys['w'] || keys['ArrowUp']) moveDirection.z -= 1;
        if (keys['s'] || keys['ArrowDown']) moveDirection.z += 1;
        if (keys['a'] || keys['ArrowLeft']) moveDirection.x -= 1;
        if (keys['d'] || keys['ArrowRight']) moveDirection.x += 1;
        
        // Handle jumping
        if (keys[' '] && !player.state.isJumping) {
          player.state.isJumping = true;
          player.state.jumpVelocity = player.JUMP_FORCE;
        }

        // Handle biting
        if (keys['b'] && !player.state.isBiting && player.state.knockbackTime <= 0) {
          player.state.isBiting = true;
          player.state.biteTimer = player.BITE_DURATION;
        }

        // Handle zoomies
        if (keys['z'] && player.state.zoomiesCooldown === 0 && !player.state.isZooming) {
          player.state.isZooming = true;
          player.state.zoomiesCooldown = player.ZOOMIES_COOLDOWN;
          setTimeout(() => {
            player.state.isZooming = false;
          }, player.ZOOMIES_DURATION * 1000);
        }

        // Handle marking territory
        if (keys['m'] && player.state.markingCooldown === 0 && !player.state.isMarking) {
          player.state.isMarking = true;
          player.state.markingCooldown = player.MARKING_COOLDOWN;
          player.state.markingAnimationTime = 0;
          setTimeout(() => {
            player.state.isMarking = false;
          }, player.MARKING_DURATION * 1000);
        }

        // Calculate movement speed with power-ups
        const moveSpeed = player.MOVE_SPEED * 
          (player.state.isZooming ? player.ZOOMIES_SPEED_MULTIPLIER : 1);

        // Save previous position for reconciliation
        const previousPosition = toVector3(player.state.position);
        
        if (moveDirection.length() > 0) {
          player.state.isMoving = true;
          player.state.rotation = Math.atan2(moveDirection.x, moveDirection.z) + Math.PI;
          
          const newPosition = new THREE.Vector3(
            player.state.position.x + moveDirection.x * moveSpeed,
            player.state.position.y,
            player.state.position.z + moveDirection.z * moveSpeed
          );

          // Client-side prediction - immediately move the player
          if (!player.checkCollision(newPosition, stage.collidableObjects)) {
            player.state.position = newPosition;
            player.updateDogPosition();
          }
        } else {
          player.state.isMoving = false;
        }

        // Only update physics for local player - no AI, no other players
        if (gameStateRef.current) {
          // For local player only - update with actual keys
          player.update(keys, deltaTime, stage.collidableObjects, undefined, []);
          
          // Send state update to server for validation
          networkManager.updatePlayerState({
            id: player.state.id,
            position: player.state.position,
            rotation: player.state.rotation,
            size: player.state.size,
            bones: player.state.bones,
            actions: {
              isMoving: player.state.isMoving,
              isBiting: player.state.isBiting,
              isMarking: player.state.isMarking,
              hasZoomies: player.state.hasZoomies
            }
          });
          
          // Store the prediction for possible reconciliation
          player.state.predictedPosition = toVector3(player.state.position);
          player.state.previousPosition = previousPosition;
        }

        // Update camera position
        const targetPosition = new THREE.Vector3(
          player.state.position.x,
          15,
          player.state.position.z + 20
        );
        camera.position.lerp(targetPosition, 0.1);
        camera.lookAt(
          player.state.position.x,
          2,
          player.state.position.z
        );
      }
      
      // Interpolate movement of remote players and AI dogs for smoother visuals
      interpolateRemoteEntities(deltaTime);

      // Pass empty keys to stage update to prevent influencing AI or other player characters
      // Let the stage handle collision detection only
      stage.update(deltaTime, {}, camera);

      // Update hydrants
      gameStateRef.current.hydrants = gameStateRef.current.hydrants.filter(hydrant => {
        hydrant.update([player, ...stage.players]);
        if (hydrant.shouldRemove()) {
          scene.remove(hydrant.mesh);
          return false;
        }
        return true;
      });

      // Render the scene
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    
    // Interpolate movement of remote players and AI dogs for smoother visuals
    const interpolateRemoteEntities = (deltaTime: number) => {
      if (!gameStateRef.current) return;
      
      // Get estimated server time and latency
      const estimatedServerTime = networkManager.getServerTime();
      
      // Interpolate all non-local players
      gameStateRef.current.stage.players.forEach(character => {
        // Skip local player
        if (character === gameStateRef.current?.player) return;
        
        // Skip if no target position set
        if (!character.state.targetPosition) return;
        
        // Calculate interpolation factor based on latency and delta time
        const interpolationSpeed = 10 * deltaTime; // Adjust this value to control smoothness
        
        // Interpolate position
        character.position.lerp(character.state.targetPosition, interpolationSpeed);
        
        // Interpolate rotation
        if (character.state.targetRotation !== undefined) {
          // Normalize angle difference to [-π, π]
          const currentRotation = character.rotation.y;
          const targetRotation = character.state.targetRotation;
          const angleDiff = Math.atan2(Math.sin(targetRotation - currentRotation), Math.cos(targetRotation - currentRotation));
          
          // Smoothly interpolate rotation
          character.rotation.y += angleDiff * interpolationSpeed;
        }
        
        // Update character state based on server time
        if (character.state.lastUpdateTime) {
          const timeSinceLastUpdate = (estimatedServerTime - character.state.lastUpdateTime) / 1000;
          if (timeSinceLastUpdate > 0.1) { // Only update if significant time has passed
            character.state.isMoving = character.state.targetIsMoving || false;
          }
        }
        
        // Update the 3D model position
        character.updateDogPosition();
      });
      
      // Interpolate AI dogs
      gameStateRef.current.stage.aiDogs.forEach(dog => {
        if (!dog.state.targetPosition) return;
        
        // Calculate interpolation factor based on latency and delta time
        const interpolationSpeed = 10 * deltaTime; // Adjust this value to control smoothness
        
        // Interpolate position
        dog.position.lerp(dog.state.targetPosition, interpolationSpeed);
        
        // Interpolate rotation
        if (dog.state.targetRotation !== undefined) {
          // Normalize angle difference to [-π, π]
          const currentRotation = dog.rotation.y;
          const targetRotation = dog.state.targetRotation;
          const angleDiff = Math.atan2(Math.sin(targetRotation - currentRotation), Math.cos(targetRotation - currentRotation));
          
          // Smoothly interpolate rotation
          dog.rotation.y += angleDiff * interpolationSpeed;
        }
        
        // Update the 3D model position
        dog.updateDogPosition();
      });
    };
    
    // State reconciliation - apply server corrections to local player
    const reconcilePlayerState = (serverState: any) => {
      if (!gameStateRef.current?.player || !serverState) return;
      const player = gameStateRef.current.player;
      
      // Check for significant position discrepancy
      const serverPosition = toVector3(serverState.position);
      const currentPosition = toVector3(player.state.position);
      const positionError = currentPosition.distanceTo(serverPosition);
      
      if (positionError > 1.0) { // If error is over 1 unit
        // Teleport player to server position (large correction)
        console.log(`Large position error detected (${positionError.toFixed(2)}), teleporting to server position`);
        player.state.position = { x: serverPosition.x, y: serverPosition.y, z: serverPosition.z };
        player.updateDogPosition();
      } else if (positionError > 0.1) { // Small error, interpolate smoothly
        // Set server position as target and let interpolation handle it
        player.state.targetPosition = serverPosition;
      }
      
      // Always accept authoritative values from server
      player.state.bones = serverState.bones;
      player.state.size = serverState.size;
      
      // Update the visuals
      player.dog.scale.setScalar(serverState.size);
    };
    
    animate();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
        containerRef.current.removeChild(nameTagsContainer);
      }
      audioManager.stopGameMusic();
      if (gameStateRef.current) {
        gameStateRef.current.hydrants.forEach(hydrant => {
          scene.remove(hydrant.mesh);
        });
      }
      networkManager.disconnect();
    };
  }, [isConnected]);

  const handleMuteToggle = () => {
    const audioManager = AudioManager.getInstance();
    const newMutedState = audioManager.toggleMute();
    setIsMuted(newMutedState);
  };

  const handlePlayAgain = () => {
    if (gameStateRef.current?.stage) {
      gameStateRef.current.stage.reset();
      setShowWinModal(false);
    }
  };

  // Show loading state while connecting
  if (!isConnected) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
        <div className="bg-white rounded-lg p-6 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-lg">Connecting to game server...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen">
      <div ref={containerRef} className="w-full h-full" />
      
      {/* Game UI Overlay */}
      <div className="absolute top-4 right-4 flex flex-col gap-4">
        {/* Mute Button */}
        <button
          onClick={handleMuteToggle}
          className="self-end p-3 bg-black bg-opacity-50 rounded-full hover:bg-opacity-75 transition-colors backdrop-blur-sm"
        >
          {isMuted ? <FaVolumeMute size={24} className="text-white" /> : <FaVolumeUp size={24} className="text-white" />}
        </button>

        {/* Player Stats */}
        <div className="bg-black bg-opacity-50 p-4 rounded-lg text-white backdrop-blur-sm">
          <div className="font-bold mb-2">{playerName}</div>
          <div>Bones: {scores.bones}</div>
          <div>Size: {scores.size.toFixed(2)}</div>
        </div>

        {/* Leaderboard */}
        <div className="bg-black bg-opacity-50 p-4 rounded-lg text-white backdrop-blur-sm w-64">
          <h2 className="text-lg font-bold mb-3 text-yellow-400">Top Dogs</h2>
          <div className="space-y-2">
            {players
              .slice()
              // Filter out duplicate names by creating a map with name as key
              .filter((player, index, self) => 
                index === self.findIndex(p => p.state.name === player.state.name)
              )
              .sort((a, b) => b.state.bones - a.state.bones)
              .slice(0, 10) // Only show top 10 players
              .map((player, index) => (
                <div 
                  key={player.state.name}
                  className={`flex items-center justify-between ${
                    player === gameStateRef.current?.player ? 'text-yellow-400 font-bold' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6">{index + 1}.</span>
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor: '#' + getColorHexString(Character.DOG_COLORS[player.state.colorIndex || 0])
                      }}
                    />
                    <span className="truncate">{player.state.name}</span>
                  </div>
                  <span>{player.state.bones}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Powers UI */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-4">
        <div className="bg-black bg-opacity-50 p-2 rounded-lg backdrop-blur-sm">
          <PowerCooldown
            isOnCooldown={!Hydrant.canSpawn()}
            cooldownProgress={(Date.now() - Hydrant.lastSpawnTime) / Hydrant.COOLDOWN}
          >
            <svg
              className={`w-8 h-8 ${!Hydrant.canSpawn() ? 'opacity-50' : 'opacity-100'} transition-opacity duration-200`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              {/* Main body */}
              <path
                className="text-red-500"
                fill="currentColor"
                d="M8 6h8v12H8z"
              />
              {/* Top cap */}
              <path
                className="text-red-500"
                fill="currentColor"
                d="M7 4h10v2H7z"
              />
              {/* Bottom base */}
              <path
                className="text-red-500"
                fill="currentColor"
                d="M6 18h12v2H6z"
              />
              {/* Side nozzles */}
              <path
                className="text-red-500"
                fill="currentColor"
                d="M4 10h4v1H4zM16 10h4v1h-4z"
              />
              {/* Center bolt/cap details */}
              <circle
                className="text-red-700"
                fill="currentColor"
                cx="12"
                cy="12"
                r="1.5"
              />
            </svg>
          </PowerCooldown>
          <div className="text-white text-center text-sm mt-1">H</div>
        </div>
        <div className="bg-black bg-opacity-50 p-2 rounded-lg backdrop-blur-sm">
          <PowerCooldown
            isOnCooldown={Boolean(gameStateRef.current?.player?.state.zoomiesCooldown)}
            cooldownProgress={gameStateRef.current?.player ? 
              1 - ((gameStateRef.current.player.state.zoomiesCooldown || 0) / gameStateRef.current.player.ZOOMIES_COOLDOWN) 
              : 1
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" 
              className={`w-8 h-8 ${gameStateRef.current?.player?.state.zoomiesCooldown ? 'opacity-50' : 'opacity-100'} transition-opacity duration-200`} 
              viewBox="0 0 24 24" 
              fill="currentColor"
            >
              <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </PowerCooldown>
          <div className="text-white text-center text-sm mt-1">Z</div>
        </div>
        <div className="bg-black bg-opacity-50 p-2 rounded-lg backdrop-blur-sm">
          <PowerCooldown
            isOnCooldown={Boolean(gameStateRef.current?.player?.state.markingCooldown)}
            cooldownProgress={gameStateRef.current?.player ? 
              1 - ((gameStateRef.current.player.state.markingCooldown || 0) / gameStateRef.current.player.MARKING_COOLDOWN) 
              : 1
            }
          >
            <svg
              className={`w-8 h-8 ${gameStateRef.current?.player?.state.markingCooldown ? 'opacity-50' : 'opacity-100'} transition-opacity duration-200`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              {/* Water drop */}
              <path
                className="text-yellow-400"
                fill="currentColor"
                d="M12 4L17 12C19 15 17 19 12 19C7 19 5 15 7 12L12 4Z"
              />
              {/* Highlight */}
              <path
                className="text-yellow-100"
                fill="currentColor"
                fillOpacity="0.6"
                d="M10 14C11 14 12 15 12 16C12 17 11 17 10 16C9 15 9 14 10 14Z"
              />
            </svg>
          </PowerCooldown>
          <div className="text-white text-center text-sm mt-1">M</div>
        </div>
      </div>

      {/* Win Modal */}
      {showWinModal && winner && (
        <WinModal
          playerName={winner.state.name}
          onPlayAgain={handlePlayAgain}
          onReturnToMenu={onReturnToMenu}
        />
      )}
    </div>
  );
};

export default Game; 