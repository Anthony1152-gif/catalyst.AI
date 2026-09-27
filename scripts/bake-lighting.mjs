/**
 * Offline light baker — `npm run bake`
 *
 * Ray-traces the static pipe network once, at build time, instead of asking
 * every visitor's GPU to approximate it each frame:
 *
 *   • Ambient occlusion: cosine-weighted hemisphere rays per vertex / texel.
 *   • Soft key-light shadows: a jittered cone of rays towards KEY_DIR, giving
 *     penumbrae a shadow map can't afford in real time.
 *
 * Output (committed to /public/bake, ~200 KB, served with long cache headers):
 *   lighting.json — manifest (part name → byte offset / vertex count, floor size)
 *   lighting.bin  — Uint8 baked light per vertex, followed by the floor lightmap.
 *
 * This is the same idea as a Blender Cycles bake; swap in a Blender-exported
 * lightmap (see README) if you author the scene there instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferAttribute, BufferGeometry, DoubleSide, PlaneGeometry, Ray, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { buildNetwork, FLOOR, FLOOR_Y, KEY_DIR } from '../src/webgl/network.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'public/bake');

const AO_SAMPLES = 64;
const SUN_SAMPLES = 16;
const SUN_CONE = 0.12; // radians ≈ 7° — softness of the key-light penumbra
const FLOOR_RES = [288, 192];

const t0 = performance.now();
const { parts } = buildNetwork();
const baked = parts.filter((p) => p.bake);

/* Occluders: every opaque part + a generous floor slab. */
const floorOcc = new PlaneGeometry(200, 200).rotateX(-Math.PI / 2).translate(0, FLOOR_Y, 0);
const strip = (g) => {
  const out = new BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setIndex(g.index);
  return out;
};
const scene = mergeGeometries([...baked.map((p) => strip(p.geometry)), strip(floorOcc)]);
const bvh = new MeshBVH(scene);

/* Deterministic low-discrepancy hemisphere directions (Fibonacci, cosine-weighted). */
function hemisphere(n) {
  const dirs = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    const phi = i * ga;
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)]);
  }
  return dirs;
}
const HEMI = hemisphere(AO_SAMPLES);
const CONE = hemisphere(SUN_SAMPLES).map(([x, y]) => [x * SUN_CONE, y * SUN_CONE]);

const ray = new Ray();
const t = new Vector3();
const b = new Vector3();
const n = new Vector3();
const up = new Vector3(0, 1, 0);

function basis(normal, spin) {
  t.set(Math.abs(normal.y) < 0.99 ? 0 : 1, Math.abs(normal.y) < 0.99 ? 1 : 0, 0).cross(normal).normalize();
  b.crossVectors(normal, t);
  // Rotate the pattern per sample point to trade banding for fine noise.
  const c = Math.cos(spin), s = Math.sin(spin);
  const tx = t.clone().multiplyScalar(c).addScaledVector(b, s);
  const bx = b.clone().multiplyScalar(c).addScaledVector(t, -s);
  return [tx, bx];
}

function occlusion(origin, normal, spin, maxDist) {
  const [tx, bx] = basis(normal, spin);
  let occ = 0;
  for (const [x, y, z] of HEMI) {
    ray.origin.copy(origin);
    ray.direction.copy(tx).multiplyScalar(x).addScaledVector(bx, y).addScaledVector(normal, z).normalize();
    const hit = bvh.raycastFirst(ray, DoubleSide, 0.002, maxDist);
    if (hit) occ += 1 - hit.distance / maxDist;
  }
  return 1 - occ / HEMI.length;
}

const [kt, kb] = basis(KEY_DIR, 0);
function sunlight(origin, normal) {
  const ndl = normal.dot(KEY_DIR);
  if (ndl <= 0) return 0;
  let vis = 0;
  for (const [x, y] of CONE) {
    ray.origin.copy(origin);
    ray.direction.copy(KEY_DIR).addScaledVector(kt, x).addScaledVector(kb, y).normalize();
    if (!bvh.raycastFirst(ray, DoubleSide, 0.002, 60)) vis++;
  }
  return vis / CONE.length;
}

const hash = (i) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * Math.PI * 2;
};
const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/* ---- per-vertex bake ---- */
const manifest = { version: 1, generated: new Date().toISOString(), parts: {}, floor: null };
const chunks = [];
let offset = 0;
const o = new Vector3();

for (const part of baked) {
  const pos = part.geometry.getAttribute('position');
  const nor = part.geometry.getAttribute('normal');
  const out = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i).normalize();
    o.fromBufferAttribute(pos, i).addScaledVector(n, 0.004);
    const ao = Math.pow(occlusion(o, n, hash(i + offset), 1.6), 1.15);
    const sun = sunlight(o, n);
    out[i] = to8(ao * (0.62 + 0.38 * sun));
  }
  manifest.parts[part.name] = { offset, count: pos.count };
  chunks.push(out);
  offset += out.length;
  process.stdout.write(`  ${part.name.padEnd(18)} ${String(pos.count).padStart(6)} verts\n`);
}

/* ---- floor lightmap (texel grid over FLOOR, row 0 = far edge / uv.y = 1) ---- */
const [W, H] = FLOOR_RES;
const floor = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W;
    const v = (y + 0.5) / H;
    o.set(FLOOR.cx + (u - 0.5) * FLOOR.width, FLOOR_Y + 0.003, FLOOR.cz + (v - 0.5) * FLOOR.depth);
    const ao = occlusion(o, up, hash(y * W + x), 3.2);
    const sun = sunlight(o, up);
    // PlaneGeometry uv.y = 1 at -z after rotateX(-90°); DataTexture row 0 = uv.y 0 (+z edge).
    floor[(H - 1 - y) * W + x] = to8(Math.pow(ao, 1.3) * (0.35 + 0.65 * sun));
  }
}
manifest.floor = { offset, width: W, height: H };
chunks.push(floor);
offset += floor.length;

mkdirSync(OUT, { recursive: true });
const bin = new Uint8Array(offset);
let p = 0;
for (const c of chunks) {
  bin.set(c, p);
  p += c.length;
}
writeFileSync(resolve(OUT, 'lighting.bin'), bin);
writeFileSync(resolve(OUT, 'lighting.json'), JSON.stringify(manifest, null, 2));
console.log(`\nBaked ${Object.keys(manifest.parts).length} parts + ${W}×${H} floor → ${(offset / 1024).toFixed(0)} KB in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
