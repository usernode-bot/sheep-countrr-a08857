import * as THREE from 'three';

export const BIRD_ELEVATION = Math.PI / 3;
export function meadowRegion(n, portrait) {
  const area = Math.max(n, 3) * 4.5;
  const ratio = portrait ? .68 : 1.8;
  return { width: Math.sqrt(area * ratio), depth: Math.sqrt(area / ratio) };
}

// Fit the entire roaming rectangle, not the flock's momentary positions.
// This keeps the camera still and guarantees room for sheep near the edges.
export function fitBirdCamera(camera, { width, height, region, overlay = { bottom: 0, right: 0 } }) {
  const sidePlate = width > height && height <= 520;
  const bounds = {
    left: sidePlate ? Math.min(.2, -1 + 2 * overlay.right / width + .06) : -.94,
    right: .94,
    top: sidePlate ? .92 : Math.max(.15, 1 - 2 * overlay.bottom / height - .06),
    bottom: -.84,
  };
  camera.aspect = width / height;
  camera.fov = 40;
  camera.setViewOffset(width, height, -(bounds.left + bounds.right) * width / 4,
    (bounds.top + bounds.bottom) * height / 4, width, height);
  camera.updateProjectionMatrix();
  const target = new THREE.Vector3(0, .6, 0);
  const direction = new THREE.Vector3(0, Math.sin(BIRD_ELEVATION), Math.cos(BIRD_ELEVATION));
  const corners = [];
  for (const x of [-region.width / 2 - 1, region.width / 2 + 1])
    for (const z of [-region.depth / 2 - 1, region.depth / 2 + 1])
      for (const y of [-.05, 1.95]) corners.push(new THREE.Vector3(x, y, z));
  const fits = (distance) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target); camera.updateMatrixWorld();
    return corners.every(corner => {
      const p = corner.clone().project(camera);
      return p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.bottom && p.y <= bounds.top;
    });
  };
  let low = 2, high = 90;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid; else low = mid;
  }
  fits(high);
  return { bounds, corners };
}
