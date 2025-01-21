import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Character } from '../Game/Character';
import AudioManager from '../../utils/AudioManager';
import { FaVolumeUp, FaVolumeMute } from 'react-icons/fa';

interface MainMenuProps {
  onStartGame: (playerName: string, colorIndex: number) => void;
}

const MainMenu: React.FC<MainMenuProps> = ({ onStartGame }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [playerName, setPlayerName] = useState('');
  const [selectedColor, setSelectedColor] = useState(0);
  const [isMuted, setIsMuted] = useState(AudioManager.getInstance().isSoundMuted());
  
  useEffect(() => {
    // Initialize and play title music
    const audioManager = AudioManager.getInstance();
    console.log('Starting title music from MainMenu');
    audioManager.playTitleMusic();
  }, []); // No dependencies, runs only once

  useEffect(() => {
    if (!previewRef.current) return;

    // Setup preview scene
    const previewScene = new THREE.Scene();
    const previewCamera = new THREE.PerspectiveCamera(
      50,
      1, // Square aspect ratio
      0.1,
      1000
    );
    previewCamera.position.set(0, 2, 5);
    previewCamera.lookAt(0, 1, 0);

    const previewRenderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    previewRenderer.setSize(300, 300);
    previewRenderer.setClearColor(0x90EE90, 0.5); // Light green background
    previewRef.current.appendChild(previewRenderer.domElement);

    // Add rounded corners to the canvas
    const canvas = previewRenderer.domElement;
    canvas.style.borderRadius = '0.5rem';

    previewScene.background = null; // Transparent background to show the clear color

    // Add lighting to preview scene
    const previewAmbient = new THREE.AmbientLight(0xffffff, 0.6);
    previewScene.add(previewAmbient);

    const previewDirect = new THREE.DirectionalLight(0xffffff, 0.8);
    previewDirect.position.set(5, 5, 5);
    previewScene.add(previewDirect);

    // Create preview dog
    const previewDog = new Character(false, selectedColor, "Preview Dog");
    previewDog.state.position = {
      x: 0,
      y: 1,
      z: 0
    };
    previewScene.add(previewDog.dog);

    let animationFrameId: number;
    // Preview animation loop
    const animatePreview = () => {
      previewDog.state.rotation += 0.01;
      previewDog.update({}, 0.016);
      previewRenderer.render(previewScene, previewCamera);
      animationFrameId = requestAnimationFrame(animatePreview);
    };
    animatePreview();

    return () => {
      // Cancel animation frame
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      // Dispose of geometries and materials
      previewScene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          if (object.geometry) {
            object.geometry.dispose();
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(material => material.dispose());
            } else {
              object.material.dispose();
            }
          }
        }
      });

      // Dispose of renderer
      previewRenderer.dispose();
      
      // Remove canvas from DOM
      if (previewRef.current && previewRenderer.domElement) {
        previewRef.current.removeChild(previewRenderer.domElement);
      }
    };
  }, [selectedColor]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Setup background scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 15, 30);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Create ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x90EE90,
      side: THREE.DoubleSide 
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Create background dogs
    const backgroundDogs: Character[] = [];
    for (let i = 0; i < 5; i++) {
      const dog = new Character(true, Math.floor(Math.random() * 10));
      dog.state.position = {
        x: (Math.random() - 0.5) * 50,
        y: 0.5,
        z: (Math.random() - 0.5) * 50 - 10
      };
      scene.add(dog.dog);
      backgroundDogs.push(dog);
    }

    // Add some trees and rocks for atmosphere
    const addTree = (x: number, z: number, scale: number = 1) => {
      const treeGroup = new THREE.Group();
      
      const trunkGeometry = new THREE.CylinderGeometry(0.4 * scale, 0.6 * scale, 3 * scale, 8);
      const trunkMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = 1.5 * scale;
      trunk.castShadow = true;
      treeGroup.add(trunk);

      const leafMaterial = new THREE.MeshPhongMaterial({ color: 0x228B22 });
      [3, 4, 5].forEach(y => {
        const leafGeometry = new THREE.OctahedronGeometry((6 - y) * 0.4 * scale);
        const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
        leaf.position.y = y * scale;
        leaf.castShadow = true;
        treeGroup.add(leaf);
      });

      treeGroup.position.set(x, 0, z);
      scene.add(treeGroup);
    };

    // Add trees
    for (let i = 0; i < 10; i++) {
      addTree(
        (Math.random() - 0.5) * 80,
        (Math.random() - 0.5) * 80 - 10,
        1 + Math.random()
      );
    }

    // Animation loop
    let lastTime = performance.now();
    const animate = () => {
      const currentTime = performance.now();
      const deltaTime = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      // Rotate camera around the scene
      const cameraAngle = currentTime * 0.0001;
      camera.position.x = Math.sin(cameraAngle) * 30;
      camera.position.z = Math.cos(cameraAngle) * 30;
      camera.lookAt(0, 0, 0);

      // Animate background dogs
      backgroundDogs.forEach(dog => {
        dog.state.isMoving = true;
        dog.update({}, deltaTime);
      });

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleMuteToggle = () => {
    console.log('Mute button clicked');
    const audioManager = AudioManager.getInstance();
    const newMutedState = audioManager.toggleMute();
    setIsMuted(newMutedState);
  };

  const handleStartGame = () => {
    if (playerName.trim()) {
      onStartGame(playerName, selectedColor);
    }
  };

  return (
    <div className="relative w-full h-screen">
      <div ref={containerRef} className="absolute inset-0" />
      
      {/* Mute Button */}
      <button
        onClick={handleMuteToggle}
        className="absolute top-4 right-4 p-4 bg-black bg-opacity-50 rounded-full hover:bg-opacity-75 transition-colors z-[100] text-white"
        style={{ pointerEvents: 'auto' }}
      >
        {isMuted ? (
          <FaVolumeMute size={24} />
        ) : (
          <FaVolumeUp size={24} />
        )}
      </button>
      
      {/* UI Overlay */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="flex gap-8">
          {/* Main Menu */}
          <div className="bg-black bg-opacity-50 p-8 rounded-lg text-white w-full max-w-lg backdrop-blur-sm">
            {/* Game Title with Glow Effect */}
            <div className="text-center mb-12">
              <h1 className="text-8xl font-bold tracking-wider animate-pulse">
                <span className="text-yellow-400">DOG</span>
                <span className="text-white">.io</span>
              </h1>
              <p className="text-xl text-gray-300 mt-2">Become the Top Dog!</p>
            </div>
            
            {/* Player Input */}
            <div className="space-y-6">
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter your name"
                className="w-full p-4 rounded-lg bg-white bg-opacity-20 text-white placeholder-gray-300 border-2 border-white border-opacity-20 focus:border-opacity-50 focus:border-yellow-400 outline-none text-lg transition-all"
                maxLength={15}
              />
              
              {/* Color Selection */}
              <div className="bg-black bg-opacity-50 p-4 rounded-lg">
                <h2 className="text-xl font-bold mb-4 text-yellow-400">Choose Your Dog Color</h2>
                <div className="grid grid-cols-6 gap-3">
                  {Array.from({ length: Character.DOG_COLORS.length }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedColor(i)}
                      className={`w-full aspect-square rounded-lg transition-all transform hover:scale-110 ${
                        selectedColor === i ? 'ring-4 ring-yellow-400 scale-110' : ''
                      }`}
                      style={{ 
                        backgroundColor: '#' + Character.DOG_COLORS[i].getHexString(),
                        boxShadow: selectedColor === i ? '0 0 20px rgba(255,255,255,0.5)' : 'none'
                      }}
                    />
                  ))}
                </div>
              </div>

              <button
                onClick={handleStartGame}
                disabled={!playerName.trim()}
                className="w-full py-4 bg-yellow-500 rounded-lg font-bold text-xl text-black disabled:opacity-50 transition-all transform hover:scale-105 hover:bg-yellow-400 disabled:hover:scale-100 shadow-lg"
              >
                PLAY NOW!
              </button>
            </div>
          </div>

          {/* Preview Box */}
          <div className="bg-black bg-opacity-50 p-8 rounded-lg backdrop-blur-sm flex flex-col items-center">
            <h2 className="text-xl font-bold mb-4 text-white">Your Dog</h2>
            <div ref={previewRef} className="w-[300px] h-[300px] rounded-lg overflow-hidden" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainMenu; 