/**
 * The WebGL layer. Loaded lazily (dynamic import) after the HTML content has
 * painted, so text, SEO and accessibility never wait on 3D.
 */
import {
  Color,
  DataTexture,
  DirectionalLight,
  FogExp2,
  Group,
  HalfFloatType,
  InstancedMesh,
  LinearFilter,
  Mesh,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Ray,
  RGBAFormat,
  Scene,
  Sphere,
  SphereGeometry,
  Timer,
  Uint8BufferAttribute,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { buildNetwork, FLOOR, FLOOR_Y, KEY_DIR } from './network.js';
import { createFloorMaterial, createMaterials } from './materials.js';
import { createStudioEnvironment } from './environment.js';
import { near, sampleShot, SHOT_INDEX } from './timeline.js';

const BG = new Color('#0a0b0d');
let damp = (dt, lambda) => 1 - Math.exp(-lambda * dt);

async function loadBake() {
  try {
    const base = import.meta.env.BASE_URL;
    const [manifest, bin] = await Promise.all([
      fetch(`${base}bake/lighting.json`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch(`${base}bake/lighting.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))),
    ]);
    return { manifest, bytes: new Uint8Array(bin) };
  } catch (err) {
    console.warn('[pipeworks] baked lighting unavailable, using unbaked fallback', err);
    return null;
  }
}

function floorLightmap(bake) {
  if (!bake) return null;
  const { width: W, height: H, offset } = bake.manifest.floor;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Fade the slab's edges into the fog so the floor has no visible border.
      const ex = Math.min(x, W - 1 - x) / (W * 0.18);
      const ey = Math.min(y, H - 1 - y) / (H * 0.22);
      const edge = Math.min(1, ex) * Math.min(1, ey);
      const v = bake.bytes[offset + y * W + x] * edge * edge * (3 - 2 * edge);
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, W, H, RGBAFormat);
  tex.magFilter = tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export async function createExperience({ canvas, tier, reducedMotion, snap = false }) {
  const high = tier === 'high';
  // ?snap — disable inertia (deterministic screenshots / visual regression tests).
  if (snap) damp = () => 1;
  const bakePromise = loadBake();

  /* ---------------- renderer ---------------- */
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false, // MSAA happens on the composer's render target instead
    stencil: false,
    depth: false,
    powerPreference: 'high-performance',
  });
  renderer.toneMapping = NoToneMapping; // tone mapping runs in the post chain
  renderer.shadowMap.enabled = false; // shadows are baked — zero per-frame cost
  const maxDpr = Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25);
  let dpr = maxDpr;
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  scene.background = BG;
  scene.fog = new FogExp2(BG, 0.03);
  scene.environment = createStudioEnvironment(renderer);
  scene.environmentIntensity = 0.95;

  const camera = new PerspectiveCamera(34, 1, 0.1, 120);

  // Real-time key only adds the moving specular glint; its shadow is baked.
  const key = new DirectionalLight('#ffe2c6', 1.4);
  key.position.copy(KEY_DIR).multiplyScalar(20);
  scene.add(key);
  const waterGlow = new PointLight('#5ff5da', 0, 5, 1.6);
  waterGlow.position.set(-1, 0.2, 0.9);
  scene.add(waterGlow);

  /* ---------------- geometry + baked light ---------------- */
  const materials = createMaterials({ tier });
  const { parts, groups: groupSpec } = buildNetwork();
  const bake = await bakePromise;

  const groups = {};
  for (const [name, spec] of Object.entries(groupSpec)) {
    const g = new Group();
    g.name = name;
    groups[name] = g;
  }
  for (const [name, spec] of Object.entries(groupSpec)) {
    const parent = spec.parent ? groups[spec.parent] : scene;
    const offset = spec.parent ? groupSpec[spec.parent].pivot : new Vector3();
    groups[name].position.copy(spec.pivot).sub(offset);
    groups[name].userData.rest = groups[name].position.clone();
    parent.add(groups[name]);
  }

  const staticByMaterial = {};
  for (const part of parts) {
    const { geometry } = part;
    if (part.bake) {
      const count = geometry.getAttribute('position').count;
      const rgb = new Uint8Array(count * 3).fill(255);
      const entry = bake?.manifest.parts[part.name];
      if (entry && entry.count === count) {
        for (let i = 0; i < count; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = bake.bytes[entry.offset + i];
      }
      geometry.setAttribute('color', new Uint8BufferAttribute(rgb, 3, true));
    }

    if (part.group) {
      const mesh = new Mesh(geometry, materials[part.material]);
      mesh.position.copy(groupSpec[part.group].pivot).negate();
      groups[part.group].add(mesh);
    } else if (part.bake) {
      (staticByMaterial[part.material] ||= []).push(geometry);
    } else {
      const mesh = new Mesh(geometry, materials[part.material]);
      mesh.name = part.name;
      scene.add(mesh);
    }
  }
  // One draw call per material for everything that never moves.
  for (const [mat, geos] of Object.entries(staticByMaterial)) {
    scene.add(new Mesh(mergeGeometries(geos), materials[mat]));
    geos.forEach((g) => g.dispose());
  }

  const floor = new Mesh(
    new PlaneGeometry(FLOOR.width, FLOOR.depth).rotateX(-Math.PI / 2).translate(FLOOR.cx, FLOOR_Y, FLOOR.cz),
    createFloorMaterial(floorLightmap(bake)),
  );
  scene.add(floor);

  /* Bubbles riding the flow inside the sight glass */
  const BUBBLES = high ? 70 : 32;
  const bubbles = new InstancedMesh(new SphereGeometry(1, 10, 8), materials.bubble, BUBBLES);
  const bubbleSeeds = Array.from({ length: BUBBLES }, (_, i) => {
    const r = (n) => {
      const x = Math.sin((i + 1) * n * 91.7) * 43758.5453;
      return x - Math.floor(x);
    };
    return { x: r(1), a: r(2) * Math.PI * 2, rad: 0.05 + r(3) * 0.17, size: 0.008 + r(4) * 0.022, speed: 0.6 + r(5) * 0.8 };
  });
  scene.add(bubbles);

  /* ---------------- post-processing ---------------- */
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: high ? 4 : 0 });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.05, luminanceSmoothing: 0.25, intensity: 0.9, radius: 0.7 });
  const dof = high ? new DepthOfFieldEffect(camera, { focusDistance: 8, focusRange: 3.5, bokehScale: 1.5, resolutionScale: 0.5 }) : null;
  const focusTarget = new Vector3();
  if (dof) dof.target = focusTarget;

  const chroma = new ChromaticAberrationEffect({ offset: new Vector2(0.0006, 0.0006), radialModulation: true, modulationOffset: 0.25 });
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  grain.blendMode.opacity.value = reducedMotion ? 0.05 : 0.11;
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

  // Convolution effects (DoF, chromatic aberration) can't share a pass.
  composer.addPass(new EffectPass(camera, ...(dof ? [dof] : []), bloom));
  composer.addPass(new EffectPass(camera, chroma, tone, vignette, grain));

  /* ---------------- interaction state ---------------- */
  const shot = { pos: new Vector3(), target: new Vector3(), bokeh: 1, fov: 34 };
  let progress = 0;
  sampleShot(0, shot);
  const camPos = shot.pos.clone();
  const camTarget = shot.target.clone();
  camera.position.copy(camPos);
  camera.lookAt(camTarget);

  const pointerRaw = new Vector2();
  const pointer = new Vector2();
  let scrollVelocity = 0;
  let hover = 0;
  let hovering = false;
  let valveOpen = 1; // 1 = open (flowing), 0 = shut
  let valveOpenTarget = 1;
  let wheelSpin = 0;
  const valveSphere = new Sphere(new Vector3(5.5, 1, 0), 1.35);
  const ray = new Ray();
  const tmp = new Vector3();
  const right = new Vector3();
  const upV = new Vector3();
  const dummy = new Object3D();
  const listeners = { hover: [] };

  /* ---------------- sizing + adaptive resolution ---------------- */
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the subject framed on portrait screens by widening the lens.
    camera.userData.fovBoost = camera.aspect < 1 ? (1 - camera.aspect) * 22 : 0;
    camera.updateProjectionMatrix();
  }
  resize();

  let frameAccum = 0;
  let frameCount = 0;
  let cooldown = 2; // let shaders compile before judging performance
  function adaptQuality(dt) {
    cooldown -= dt;
    frameAccum += dt;
    frameCount++;
    if (frameCount < 45 || cooldown > 0) return;
    const avg = frameAccum / frameCount;
    frameAccum = frameCount = 0;
    let next = dpr;
    if (avg > 1 / 45 && dpr > 0.75) next = Math.max(0.75, dpr - 0.25);
    else if (avg < 1 / 58 && dpr < maxDpr) next = Math.min(maxDpr, dpr + 0.25);
    if (next !== dpr) {
      dpr = next;
      renderer.setPixelRatio(dpr);
      resize();
      cooldown = 1.5;
    }
  }

  /* ---------------- frame ---------------- */
  const timer = new Timer();
  let running = false;
  let raf = 0;
  let firstFrame;
  const firstFramePromise = new Promise((r) => (firstFrame = r));

  function update(dt, t) {
    sampleShot(progress, shot);

    // Pointer: heavy, cinematic smoothing.
    pointer.lerp(pointerRaw, damp(dt, reducedMotion ? 20 : 4));

    // Inertial camera — lerp towards the scroll-driven shot + mouse parallax.
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    upV.setFromMatrixColumn(camera.matrixWorld, 1);
    const par = reducedMotion ? 0 : 1;
    tmp.copy(shot.pos).addScaledVector(right, pointer.x * 0.45 * par).addScaledVector(upV, pointer.y * 0.25 * par);
    camPos.lerp(tmp, damp(dt, reducedMotion ? 12 : 2.6));
    camTarget.lerp(shot.target, damp(dt, reducedMotion ? 12 : 3.2));
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    const fov = shot.fov + camera.userData.fovBoost;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * damp(dt, 3);
      camera.updateProjectionMatrix();
    }

    // Focus pulls follow the subject of each shot.
    focusTarget.copy(camTarget);
    if (dof) dof.bokehScale += (shot.bokeh - dof.bokehScale) * damp(dt, 3);

    // Chromatic aberration swells with scroll speed — the lens "strains".
    const ca = 0.0005 + Math.min(Math.abs(scrollVelocity) * 0.00012, 0.0028);
    chroma.offset.x += (ca - chroma.offset.x) * damp(dt, 6);
    chroma.offset.y = chroma.offset.x;
    scrollVelocity *= 1 - damp(dt, 5);

    /* Exploded flange (precision shot) */
    const e = near(progress, SHOT_INDEX.precision, 1.1);
    const g = groups;
    g['j2-left'].position.x = g['j2-left'].userData.rest.x - 0.42 * e;
    g['j2-right'].position.x = g['j2-right'].userData.rest.x + 0.42 * e;
    g['j2-gasket'].position.y = g['j2-gasket'].userData.rest.y + 0.8 * e;
    g['j2-gasket'].rotation.z = -0.5 * e;
    g['j2-bolts'].position.x = g['j2-bolts'].userData.rest.x + 1.25 * e;
    g['j2-bolts'].rotation.x = 0.35 * e;

    /* Magnetic valve (control shot) */
    const valveActive = near(progress, SHOT_INDEX.control, 0.8);
    ray.origin.copy(camera.position);
    ray.direction.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
    hovering = valveActive > 0.3 && !reducedMotion && ray.intersectsSphere(valveSphere);
    hover += ((hovering ? 1 : 0) - hover) * damp(dt, 6);
    // Lean towards the cursor: project the pointer onto the valve's depth.
    ray.closestPointToPoint(valveSphere.center, tmp).sub(valveSphere.center);
    const valve = g.valve;
    valve.rotation.z += (-tmp.x * 0.12 * hover - valve.rotation.z) * damp(dt, 5);
    valve.rotation.x += (tmp.z * 0.1 * hover + tmp.y * 0.05 * hover - valve.rotation.x) * damp(dt, 5);
    valve.scale.setScalar(1 + 0.035 * hover);
    valveOpen += (valveOpenTarget - valveOpen) * damp(dt, 2.2);
    wheelSpin += ((valveOpenTarget - valveOpen) * 7 + hover * 0.6 - wheelSpin) * damp(dt, 4);
    g.wheel.rotation.y += wheelSpin * dt;

    /* Water */
    const flowBoost = near(progress, SHOT_INDEX.flow, 1);
    const flow = (0.35 + 0.65 * flowBoost) * valveOpen;
    materials.water.uniforms.uTime.value = t;
    materials.water.uniforms.uFlow.value = flow;
    waterGlow.intensity = flow * 2.2;
    bloom.intensity = 0.9 + flowBoost * 0.5;

    for (let i = 0; i < BUBBLES; i++) {
      const s = bubbleSeeds[i];
      s.x = (s.x + dt * s.speed * flow * 0.35) % 1;
      const wob = Math.sin(t * 3 + i) * 0.015;
      dummy.position.set(-3.7 + s.x * 5.4, Math.cos(s.a) * s.rad + wob, Math.sin(s.a) * s.rad);
      dummy.scale.setScalar(s.size * Math.min(1, flow * 2.5));
      dummy.updateMatrix();
      bubbles.setMatrixAt(i, dummy.matrix);
    }
    bubbles.instanceMatrix.needsUpdate = true;

    for (const fn of listeners.hover) fn(hover > 0.5);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 1 / 20);
    update(dt, timer.getElapsed());
    composer.render(dt);
    adaptQuality(dt);
    if (firstFrame) {
      firstFrame();
      firstFrame = null;
    }
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  function start() {
    if (running) return;
    running = true;
    timer.reset();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }
  document.addEventListener('visibilitychange', onVisibility);

  // Compile every material up front so the first scroll doesn't hitch.
  await renderer.compileAsync(scene, camera);

  return {
    start,
    stop,
    resize,
    firstFrame: firstFramePromise,
    setProgress(f) {
      progress = f;
    },
    setPointer(x, y) {
      pointerRaw.set(x, y);
    },
    setVelocity(v) {
      scrollVelocity = v;
    },
    /** Returns true if the click hit the valve (and toggled it). */
    click() {
      if (!hovering) return false;
      valveOpenTarget = valveOpenTarget > 0.5 ? 0 : 1;
      return true;
    },
    /** Keyboard / button equivalent of clicking the valve. */
    toggleValve() {
      valveOpenTarget = valveOpenTarget > 0.5 ? 0 : 1;
      return valveOpenTarget > 0.5;
    },
    get valveOpen() {
      return valveOpenTarget > 0.5;
    },
    onHover(fn) {
      listeners.hover.push(fn);
    },
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      composer.dispose();
      renderer.dispose();
    },
  };
}
