import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Character } from './Character';
import { Stage } from './Stage';
import { Hydrant } from './Hydrant';
import PowerCooldown from '../UI/PowerCooldown';
import AudioManager from '../../utils/AudioManager';
import { FaVolumeUp, FaVolumeMute } from 'react-icons/fa';

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
}

const Game: React.FC<GameProps> = ({ playerName, colorIndex }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const [scores, setScores] = useState<{bones: number, size: number}>({ bones: 0, size: 1 });
  const [players, setPlayers] = useState<Character[]>([]);
  const [isMuted, setIsMuted] = useState(AudioManager.getInstance().isSoundMuted());
  const [hydrantCooldown, setHydrantCooldown] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

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
    const player = stage.createPlayer(playerName, colorIndex);
    stage.createAIDogs();

    // Initialize game state
    gameStateRef.current = {
      scene,
      camera,
      renderer,
      stage,
      player,
      lastTime: performance.now(),
      keys: {},
      hydrants: [],
    };

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
      if (!gameStateRef.current) return;
      
      // Prevent default browser behavior for game controls
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      
      gameStateRef.current.keys[e.key.toLowerCase()] = true;

      // Handle hydrant spawn on 'h' key press
      if (e.key.toLowerCase() === 'h') {
        if (Hydrant.canSpawn()) {
          const playerPos = gameStateRef.current.player.state.position;
          const hydrant = new Hydrant(
            new THREE.Vector3(playerPos.x, 0, playerPos.z),
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

      // Update hydrant cooldown
      const timeSinceLastHydrant = Date.now() - Hydrant.lastSpawnTime;
      const cooldownProgress = Math.min(timeSinceLastHydrant / Hydrant.COOLDOWN, 1);
      setHydrantCooldown(cooldownProgress);

      // Update hydrants and remove inactive ones
      gameStateRef.current.hydrants = gameStateRef.current.hydrants.filter(hydrant => {
        hydrant.update([player, ...stage.players]);
        if (hydrant.shouldRemove()) {
          scene.remove(hydrant.mesh);
          return false;
        }
        return true;
      });

      // Update game state
      stage.update(deltaTime, keys, camera);

      // Update UI state
      setScores({
        bones: player.state.bones,
        size: player.state.size
      });
      setPlayers([...stage.players]);

      // Update camera position to follow player
      const cameraHeight = 15;
      const cameraDistance = 20;
      const lookAtHeight = 2;

      // Calculate target camera position
      const targetCameraPos = new THREE.Vector3(
        player.state.position.x,
        cameraHeight,
        player.state.position.z + cameraDistance
      );

      // Smoothly interpolate camera position
      camera.position.lerp(targetCameraPos, 0.1);

      // Calculate target look-at position
      const targetLookAt = new THREE.Vector3(
        player.state.position.x,
        lookAtHeight,
        player.state.position.z
      );

      // Smoothly interpolate look-at position
      const currentLookAt = new THREE.Vector3();
      camera.getWorldDirection(currentLookAt);
      const targetDirection = targetLookAt.clone().sub(camera.position).normalize();
      const newDirection = currentLookAt.lerp(targetDirection, 0.1);
      camera.lookAt(camera.position.clone().add(newDirection));

      // Render scene
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
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
    };
  }, [playerName, colorIndex]);

  const handleMuteToggle = () => {
    const audioManager = AudioManager.getInstance();
    const newMutedState = audioManager.toggleMute();
    setIsMuted(newMutedState);
  };

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
              .sort((a, b) => b.state.bones - a.state.bones)
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
                        backgroundColor: '#' + Character.DOG_COLORS[player.state.colorIndex || 0].getHexString()
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
            isOnCooldown={hydrantCooldown < 1}
            cooldownProgress={hydrantCooldown}
          />
          <div className="text-white text-center text-sm mt-1">H</div>
        </div>
      </div>
    </div>
  );
};

export default Game; 