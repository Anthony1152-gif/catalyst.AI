/**
 * Physically based materials. Every opaque material multiplies in the baked
 * light (vertex colours) — including metals, where it acts as specular
 * occlusion so crevices don't reflect the studio they can't see.
 */
import {
  AdditiveBlending,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
} from 'three';

/** Seeded value noise stretched along U — a brushed / drawn-tube micro surface. */
function brushedTexture(size = 256) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lines = new Float32Array(size).map(() => rnd());
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const band = lines[y] * 0.6 + lines[(y + 1) % size] * 0.4;
    for (let x = 0; x < size; x++) {
      const grain = rnd() * 0.18;
      const v = Math.round((0.55 + (band - 0.5) * 0.5 + grain - 0.09) * 255);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function createMaterials({ tier }) {
  const brushed = brushedTexture();
  // Tubes: uv.x runs along the pipe, uv.y around it → brush along the length.
  brushed.repeat.set(1, 6);

  const high = tier === 'high';
  const base = { vertexColors: true, envMapIntensity: 1 };

  const m = {
    copper: new MeshPhysicalMaterial({
      ...base,
      color: new Color('#e39a6f'),
      metalness: 1,
      roughness: 0.3,
      roughnessMap: brushed,
      anisotropy: high ? 0.55 : 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.2,
    }),
    agedCopper: new MeshPhysicalMaterial({
      ...base,
      color: new Color('#8a5a40'),
      metalness: 0.9,
      roughness: 0.55,
      roughnessMap: brushed,
    }),
    steel: new MeshPhysicalMaterial({
      ...base,
      color: new Color('#c9cdd3'),
      metalness: 1,
      roughness: 0.36,
      roughnessMap: brushed,
      anisotropy: high ? 0.7 : 0,
    }),
    darkSteel: new MeshStandardMaterial({ ...base, color: new Color('#3b3e44'), metalness: 0.85, roughness: 0.58 }),
    // Enamelled cast iron: diffuse oxide red under a glossy clear coat.
    castIron: new MeshPhysicalMaterial({
      ...base,
      color: new Color('#6e1a15'),
      metalness: 0.15,
      roughness: 0.62,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
    }),
    brass: new MeshPhysicalMaterial({ ...base, color: new Color('#d6ad5a'), metalness: 1, roughness: 0.26 }),
    rubber: new MeshStandardMaterial({ ...base, color: new Color('#131416'), metalness: 0, roughness: 0.92 }),
    // Woven grip wrapped around the hand-wheel: fabric sheen at grazing angles.
    grip: new MeshPhysicalMaterial({
      ...base,
      color: new Color('#1d2026'),
      metalness: 0,
      roughness: 0.82,
      sheen: 1,
      sheenColor: new Color('#8fa3b8'),
      sheenRoughness: 0.45,
    }),
    glass: high
      ? new MeshPhysicalMaterial({
          color: new Color('#ffffff'),
          metalness: 0,
          roughness: 0.03,
          transmission: 1,
          thickness: 0.18,
          ior: 1.5,
          attenuationColor: new Color('#d7f2ec'),
          attenuationDistance: 1.5,
          specularIntensity: 1,
          side: 2,
        })
      : new MeshPhysicalMaterial({
          color: new Color('#cfe9e4'),
          metalness: 0,
          roughness: 0.05,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: 2,
        }),
    water: createWaterMaterial(),
    bubble: new MeshBasicMaterial({ color: new Color(2.2, 3.2, 3.0), toneMapped: false }),
  };

  // The water is refracted through the glass on high tier (opaque → captured by
  // the transmission pass). On lower tiers it's drawn additively instead.
  if (!high) {
    m.water.transparent = true;
    m.water.blending = AdditiveBlending;
    m.water.depthWrite = false;
  }
  return m;
}

export function createFloorMaterial(lightmap) {
  const mat = new MeshStandardMaterial({
    color: new Color('#26272b'),
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  if (lightmap) mat.map = lightmap;
  return mat;
}

/** Flowing water — HDR streaks feed the bloom pass. */
function createWaterMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 0.4 },
      uColor: { value: new Color('#0c3b3d') },
      uGlow: { value: new Color('#5ff5da') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlow;
      uniform vec3 uColor;
      uniform vec3 uGlow;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }

      void main() {
        // uv.x runs along the pipe, uv.y wraps around it.
        vec2 p = vec2(vUv.y * 11.0, vUv.x * 4.0 - uTime * (0.35 + uFlow * 1.6));
        float n = noise(p) * 0.55 + noise(p * vec2(2.1, 1.3) + 4.0) * 0.3 + noise(p * vec2(4.7, 2.2)) * 0.15;
        // Thin ridges of the noise field read as filaments stretched by the current.
        float streak = pow(1.0 - abs(n * 2.0 - 1.0), 7.0);
        float fres = pow(1.0 - max(dot(normalize(vN), normalize(vView)), 0.0), 2.0);
        vec3 col = uColor * (0.6 + 0.8 * fres) + uGlow * streak * (0.4 + uFlow * 3.2) + uGlow * fres * 0.35 * uFlow;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
