import * as THREE from 'three';

export type Position = { x: number; y: number; z: number };

// Helper functions for converting between Position and THREE.Vector3
export const toVector3 = (pos: Position): THREE.Vector3 => {
  return new THREE.Vector3(pos.x, pos.y, pos.z);
};

export const toPosition = (vec: THREE.Vector3): Position => {
  return { x: vec.x, y: vec.y, z: vec.z };
}; 