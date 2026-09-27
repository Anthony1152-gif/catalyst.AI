/**
 * Pipeworks — the pipe network.
 *
 * Pure, deterministic geometry description (no DOM, no WebGL) so the exact same
 * vertices can be generated in the browser AND in Node by the offline light
 * baker (scripts/bake-lighting.mjs). The baker ray-traces ambient occlusion and
 * soft key-light shadows against this geometry and writes them to /public/bake;
 * at runtime those values are matched back onto the vertices by part name.
 *
 * All geometry is authored in world space. Parts that animate reference a
 * `group` (with a pivot) so the runtime can wrap them in transform nodes.
 */
import {
  BoxGeometry,
  CatmullRomCurve3,
  CurvePath,
  CylinderGeometry,
  LatheGeometry,
  LineCurve3,
  QuadraticBezierCurve3,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const FLOOR_Y = -2.4;
/** Baked floor region (world units) — matches the floor mesh exactly. */
export const FLOOR = { width: 48, depth: 32, cx: 0, cz: -2 };
/** Key light direction (towards the light) — shared by the baker and the renderer. */
export const KEY_DIR = new Vector3(-0.45, 1, 0.55).normalize();

const V = (x, y, z) => new Vector3(x, y, z);

/* ------------------------------------------------------------------ helpers */

/** Polyline pipe run with filleted (bent) corners, like real bent tube. */
function pipeRun(points, radius, bend, radial = 24) {
  const path = new CurvePath();
  let cursor = points[0].clone();
  let corners = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const inDir = p.clone().sub(points[i - 1]).normalize();
    const outDir = points[i + 1].clone().sub(p).normalize();
    const a = p.clone().addScaledVector(inDir, -bend);
    const b = p.clone().addScaledVector(outDir, bend);
    path.add(new LineCurve3(cursor, a));
    path.add(new QuadraticBezierCurve3(a, p.clone(), b));
    cursor = b;
    corners++;
  }
  path.add(new LineCurve3(cursor, points[points.length - 1].clone()));
  const segs = Math.ceil(path.getLength() * 3) + corners * 16;
  return new TubeGeometry(path, segs, radius, radial, false);
}

/** Cylinder whose axis runs along X from x0 to x1. */
function cylX(x0, x1, r, y = 0, z = 0, radial = 40, open = false) {
  // Enough length segments that baked per-vertex light has samples along the run.
  const g = new CylinderGeometry(r, r, x1 - x0, radial, Math.max(1, Math.ceil((x1 - x0) * 5)), open);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  // Match TubeGeometry's convention (u along the pipe, v around it) so brushed
  // roughness and anisotropy run the same way on every pipe.
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getY(i), uv.getX(i));
  return g;
}

/** Cylinder along Y from y0 to y1. */
function cylY(y0, y1, r, x = 0, z = 0, radial = 32) {
  const g = new CylinderGeometry(r, r, y1 - y0, radial, 1, false);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

/** Lathe profile (radius, axial) revolved around the X axis, centred at x. */
function latheX(profile, x, segments = 64) {
  const g = new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), segments);
  g.rotateZ(-Math.PI / 2); // lathe axis Y -> X
  g.translate(x, 0, 0);
  return g;
}

function box(w, h, d, x, y, z) {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Chamfered flange disc profile (hollow centre is hidden by the pipe). */
const FLANGE_PROFILE = [
  [0.3, -0.08], [0.58, -0.08], [0.62, -0.05], [0.62, 0.05], [0.58, 0.08], [0.3, 0.08],
];
const HUB_PROFILE = [
  [0.33, -0.14], [0.37, -0.14], [0.42, 0.06], [0.42, 0.14], [0.33, 0.14],
];

/** A bolted flange joint centred at x. Returns parts tagged with the joint id. */
function flangeJoint(id, x, { exploded = false } = {}) {
  const parts = [];
  const g = (side) => (exploded ? `${id}-${side}` : undefined);

  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const disc = latheX(FLANGE_PROFILE, x + side * 0.1);
    // Weld-neck hub: wide against the disc, tapering towards the pipe.
    const hubProfile = HUB_PROFILE.map(([r, h]) => [r, side > 0 ? -h : h]);
    if (side > 0) hubProfile.reverse();
    const hub = latheX(hubProfile, x + side * 0.32);
    parts.push({ name: `${id}-flange-${key}`, material: 'steel', geometry: mergeGeometries([disc, hub]), group: g(key) });
  }

  parts.push({
    name: `${id}-gasket`,
    material: 'rubber',
    geometry: cylX(x - 0.018, x + 0.018, 0.56, 0, 0, 48),
    group: g('gasket'),
  });

  // 8 bolts + 16 hex nuts, merged into a single draw call per joint.
  const bolts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const y = Math.cos(a) * 0.49;
    const z = Math.sin(a) * 0.49;
    bolts.push(cylX(x - 0.3, x + 0.3, 0.035, y, z, 10));
    bolts.push(cylX(x - 0.26, x - 0.18, 0.075, y, z, 6));
    bolts.push(cylX(x + 0.18, x + 0.26, 0.075, y, z, 6));
  }
  parts.push({ name: `${id}-bolts`, material: 'brass', geometry: mergeGeometries(bolts), group: g('bolts') });
  return parts;
}

/** Pipe support: base plate, post and a saddle cradle under a pipe of radius r. */
function support(name, x, z, pipeY, r) {
  const top = pipeY - r - 0.04;
  const cradle = new TorusGeometry(r + 0.03, 0.035, 10, 36, Math.PI);
  cradle.rotateX(Math.PI); // lower half
  cradle.rotateY(Math.PI / 2); // into the YZ plane
  cradle.translate(x, pipeY, z);
  return {
    name,
    material: 'darkSteel',
    geometry: mergeGeometries([
      box(0.62, 0.05, 0.62, x, FLOOR_Y + 0.025, z),
      box(0.14, top - FLOOR_Y, 0.14, x, (top + FLOOR_Y) / 2, z),
      box(0.16, 0.05, r * 2 + 0.2, x, top, z),
      cradle,
    ]),
  };
}

/* ------------------------------------------------------------------- build */

export function buildNetwork() {
  const parts = [];
  const push = (p) => parts.push(p);

  /* Main line: copper → [J1] → glass sight section → [J2] → steel → valve → riser */
  push({ name: 'main-copper', material: 'copper', geometry: pipeRun([V(-26, 0, 0), V(-4.28, 0, 0)], 0.32, 0.5, 40) });
  flangeJoint('j1', -4).forEach(push);
  flangeJoint('j2', 2, { exploded: true }).forEach(push);

  push({ name: 'sight-glass', material: 'glass', geometry: cylX(-3.8, 1.8, 0.345, 0, 0, 64, true), bake: false });
  push({ name: 'sight-water', material: 'water', geometry: cylX(-3.75, 1.75, 0.27, 0, 0, 48, true), bake: false });

  push({ name: 'main-steel-a', material: 'steel', geometry: cylX(2.28, 4.62, 0.32, 0, 0, 48, true) });
  push({
    name: 'main-steel-b',
    material: 'steel',
    geometry: pipeRun([V(6.38, 0, 0), V(9.6, 0, 0), V(9.6, 12, 0)], 0.32, 1.3, 40),
  });

  /* Gate valve — the interactive "magnetic" hero object */
  const VX = 5.5;
  const body = latheX(
    [[0.33, -0.9], [0.42, -0.78], [0.52, -0.58], [0.63, -0.3], [0.67, 0], [0.63, 0.3], [0.52, 0.58], [0.42, 0.78], [0.33, 0.9]],
    VX,
  );
  const endL = latheX(FLANGE_PROFILE.map(([r, h]) => [r * 0.85, h]), VX - 0.86);
  const endR = latheX(FLANGE_PROFILE.map(([r, h]) => [r * 0.85, h]), VX + 0.86);
  push({ name: 'valve-body', material: 'castIron', geometry: mergeGeometries([body, endL, endR]), group: 'valve' });

  const bonnetProfile = new LatheGeometry(
    [[0.001, 1.34], [0.2, 1.34], [0.26, 1.28], [0.3, 1.1], [0.36, 0.72], [0.36, 0.5]].map(([r, h]) => new Vector2(r, h)).reverse(),
    48,
  );
  bonnetProfile.translate(VX, 0, 0);
  push({ name: 'valve-bonnet', material: 'castIron', geometry: bonnetProfile, group: 'valve' });
  push({ name: 'valve-stem', material: 'brass', geometry: cylY(1.3, 2.05, 0.05, VX, 0, 16), group: 'valve' });

  const rim = new TorusGeometry(0.62, 0.065, 16, 72);
  rim.rotateX(Math.PI / 2);
  rim.translate(VX, 1.95, 0);
  const spokes = [];
  for (let i = 0; i < 5; i++) {
    const s = new CylinderGeometry(0.028, 0.028, 0.6, 8);
    s.rotateZ(Math.PI / 2);
    s.translate(0.3, 0, 0);
    s.rotateY((i / 5) * Math.PI * 2);
    s.translate(VX, 1.95, 0);
    spokes.push(s);
  }
  push({ name: 'valve-wheel', material: 'grip', geometry: rim, group: 'wheel' });
  push({
    name: 'valve-spokes',
    material: 'steel',
    geometry: mergeGeometries([...spokes, cylY(1.88, 2.04, 0.1, VX, 0, 24)]),
    group: 'wheel',
  });

  /* Tee + branch dropping to the floor */
  push({ name: 'tee-collar', material: 'brass', geometry: latheX([[0.34, -0.34], [0.38, -0.3], [0.38, 0.3], [0.34, 0.34]], -9, 48) });
  push({
    name: 'branch',
    material: 'copper',
    geometry: pipeRun([V(-9, 0, 0.25), V(-9, 0, 3), V(-9, FLOOR_Y - 0.2, 3)], 0.2, 0.7, 28),
  });
  push({ name: 'branch-coupling', material: 'brass', geometry: latheX([[0.22, -0.12], [0.24, -0.1], [0.24, 0.1], [0.22, 0.12]], 0, 32) });
  parts[parts.length - 1].geometry.rotateY(Math.PI / 2).translate(-9, 0, 1.6);

  for (const x of [-15, -12]) {
    push({ name: `coupling-${x}`, material: 'brass', geometry: latheX([[0.34, -0.12], [0.365, -0.09], [0.365, 0.09], [0.34, 0.12]], x, 48) });
  }

  /* Supports */
  [-17, -11, -6.5, 3.4, 7.8].forEach((x, i) => push(support(`support-${i}`, x, 0, 0, 0.32)));

  /* Background rack — the far parallax layer */
  const RZ = -5.5;
  push({ name: 'rack-1', material: 'darkSteel', geometry: pipeRun([V(-26, 1.0, RZ), V(26, 1.0, RZ)], 0.16, 0.5, 20) });
  push({ name: 'rack-2', material: 'steel', geometry: pipeRun([V(-26, 1.7, RZ), V(26, 1.7, RZ)], 0.21, 0.5, 24) });
  push({
    name: 'rack-3',
    material: 'agedCopper',
    geometry: pipeRun([V(-26, 2.45, RZ), V(12.5, 2.45, RZ), V(12.5, 2.45, -2.4), V(12.5, FLOOR_Y - 0.2, -2.4)], 0.17, 0.8, 20),
  });
  for (const [i, x] of [-14, -4, 6].entries()) {
    push({
      name: `rack-post-${i}`,
      material: 'darkSteel',
      geometry: mergeGeometries([
        box(0.12, 3.1 - FLOOR_Y, 0.12, x, (3.1 + FLOOR_Y) / 2, RZ - 0.35),
        box(0.12, 0.08, 0.9, x, 0.78, RZ),
        box(0.12, 0.08, 0.9, x, 1.44, RZ),
        box(0.12, 0.08, 0.9, x, 2.24, RZ),
        box(0.6, 0.05, 0.6, x, FLOOR_Y + 0.025, RZ - 0.35),
      ]),
    });
  }
  push({
    name: 'trunk',
    material: 'agedCopper',
    geometry: pipeRun([V(-26, 4.4, -9), V(-10.5, 4.4, -9), V(-10.5, FLOOR_Y - 0.2, -9)], 0.55, 1.6, 40),
  });

  /* A sweeping overhead return — gives the wide "systems" shot a silhouette */
  const sweep = new CatmullRomCurve3([V(9.6, 6.5, 0), V(9.6, 7.4, -1.2), V(4, 7.6, -3.5), V(-6, 7.4, -4.5), V(-14, 7.6, -6)]);
  push({ name: 'overhead', material: 'steel', geometry: new TubeGeometry(sweep, 160, 0.24, 24, false) });

  // Every baked geometry must carry the same attribute set so it can be merged.
  for (const p of parts) {
    for (const key of Object.keys(p.geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(key)) p.geometry.deleteAttribute(key);
    }
    if (!p.geometry.index) throw new Error(`Non-indexed part: ${p.name}`);
    if (p.bake === undefined) p.bake = true;
  }

  return {
    parts,
    groups: {
      valve: { pivot: V(VX, 0, 0) },
      wheel: { pivot: V(VX, 1.95, 0), parent: 'valve' },
      'j2-left': { pivot: V(2, 0, 0) },
      'j2-right': { pivot: V(2, 0, 0) },
      'j2-gasket': { pivot: V(2, 0, 0) },
      'j2-bolts': { pivot: V(2, 0, 0) },
    },
  };
}
