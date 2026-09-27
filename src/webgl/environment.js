/**
 * Intentional lighting: a hand-built photo studio, rendered once into a
 * pre-filtered (PMREM) environment map. Each softbox is placed with purpose —
 * a warm key that matches the baked shadow direction, a cool rim to separate
 * silhouettes from the dark, a faint teal kicker that echoes the water.
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Vector3,
} from 'three';
import { KEY_DIR } from './network.js';

function softbox(scene, { w, h, color, intensity, position, lookAt = new Vector3() }) {
  const mat = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: 2 });
  const mesh = new Mesh(new PlaneGeometry(w, h), mat);
  mesh.position.copy(position);
  mesh.lookAt(lookAt);
  scene.add(mesh);
}

export function createStudioEnvironment(renderer) {
  const env = new Scene();
  const room = new Mesh(new BoxGeometry(40, 20, 40), new MeshBasicMaterial({ color: new Color(0.012, 0.012, 0.014), side: BackSide }));
  room.position.y = 6;
  env.add(room);

  softbox(env, { w: 10, h: 5, color: '#ffd9b8', intensity: 4.5, position: KEY_DIR.clone().multiplyScalar(12) });
  softbox(env, { w: 22, h: 1.2, color: '#b9d2ff', intensity: 6, position: new Vector3(4, 5, -14) });
  softbox(env, { w: 14, h: 14, color: '#ffffff', intensity: 0.9, position: new Vector3(0, 15, 0) });
  softbox(env, { w: 1.4, h: 8, color: '#5ff5da', intensity: 3, position: new Vector3(13, 1, 6) });
  softbox(env, { w: 30, h: 30, color: '#3a2a20', intensity: 0.5, position: new Vector3(0, -4, 0), lookAt: new Vector3(0, 10, 0) });

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  env.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return target.texture;
}
