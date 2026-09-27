/**
 * Camera "shots" — one per story section, in DOM order. The scroll position is
 * mapped to a float index between shots; positions and targets are sampled on
 * Catmull-Rom splines through the keyframes so transitions arc, never cut.
 */
import { CatmullRomCurve3, Vector3 } from 'three';

const V = (x, y, z) => new Vector3(x, y, z);

export const SHOTS = [
  /* hero      */ { pos: V(-1.2, 1.7, 10.6), target: V(1.4, 0.35, 0), bokeh: 1.4, fov: 34 },
  /* materials */ { pos: V(-6.1, 0.95, 3.1), target: V(-7.0, 0.05, 0), bokeh: 3.2, fov: 30 },
  /* precision */ { pos: V(0.2, 1.6, 4.6), target: V(3.2, 0.3, 0), bokeh: 3.4, fov: 30 },
  /* flow      */ { pos: V(-4.6, 0.75, 1.7), target: V(-0.2, -0.15, -0.35), bokeh: 3.0, fov: 32 },
  /* control   */ { pos: V(3.3, 3.0, 5.4), target: V(7.0, 0.85, 0), bokeh: 2.8, fov: 30 },
  /* systems   */ { pos: V(-6.5, 7.8, 15.5), target: V(0.5, 0.6, -2.2), bokeh: 1.0, fov: 36 },
  /* contact   */ { pos: V(13.2, -1.3, 7.4), target: V(5.6, 2.2, -1.2), bokeh: 1.6, fov: 34 },
];

export const SHOT_INDEX = Object.fromEntries(
  ['hero', 'materials', 'precision', 'flow', 'control', 'systems', 'contact'].map((k, i) => [k, i]),
);

const posCurve = new CatmullRomCurve3(SHOTS.map((s) => s.pos), false, 'centripetal', 0.5);
const targetCurve = new CatmullRomCurve3(SHOTS.map((s) => s.target), false, 'centripetal', 0.5);
const last = SHOTS.length - 1;

/** Quintic ease so the camera dwells on each shot while its copy is read. */
const dwell = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Weight (0..1) of how close `f` is to shot `i` — for per-shot effects. */
export const near = (f, i, width = 1) => {
  const d = Math.abs(f - i) / width;
  return d >= 1 ? 0 : 1 - dwell(d);
};

export function sampleShot(f, out) {
  const clamped = Math.min(Math.max(f, 0), last);
  const i = Math.min(Math.floor(clamped), last - 1);
  const local = dwell(clamped - i);
  const u = (i + local) / last;
  posCurve.getPoint(u, out.pos);
  targetCurve.getPoint(u, out.target);
  const a = SHOTS[i];
  const b = SHOTS[i + 1];
  out.bokeh = a.bokeh + (b.bokeh - a.bokeh) * local;
  out.fov = a.fov + (b.fov - a.fov) * local;
  return out;
}
