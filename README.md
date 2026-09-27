# Pipeworks — scrollytelling 3D site

A cinematic, scroll-driven WebGL site for **Pipeworks**, a (placeholder) mechanical & plumbing engineering firm. The camera flies through one continuous pipe network across seven shots: hero → materials → exploded flange → flowing water → interactive valve → system overview → contact.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
npm run bake       # re-run the offline light bake after changing src/webgl/network.js
```

URL flags: `?quality=high|low|none` forces a render tier, and `?snap` turns off camera inertia so screenshots are deterministic.

## How it meets the brief

### Performance & asset management
- **The text paints first.** `index.html` is complete static content. `main.js` (≈9 KB gz) adds the enhancements. Three.js and the post stack sit in a separate chunk (≈158 KB gz) that is `import()`ed on `requestIdleCallback` after `load`, so they never block the LCP.
- **Baked lighting, not real-time shadows.** The shadow map is off, so there is no per-frame shadow cost (see below).
- **Draw-call budget.** All static parts are merged into **one mesh per material**. The 8 bolts and 16 nuts on each flange are also merged into one mesh. Bubbles use an `InstancedMesh`.
- **Adaptive resolution.** Frame time is sampled continuously. The pixel ratio steps down (to 0.75 at the lowest) when frames exceed ~22 ms and steps back up when there is headroom.
- **Tiering.** `detectTier()` uses WebGL2 support, `deviceMemory`, core count, Save-Data and pointer type. The **low** tier drops DoF, MSAA, transmission and anisotropy. The **none** tier shows a CSS poster.
- Shaders are compiled up front with `compileAsync`. The render loop pauses when the tab is hidden. `public/_headers` sets immutable caching for hashed assets.

### Hybrid architecture (SEO & accessibility)
- The page uses semantic landmarks, one `h1`, ordered `h2`/`h3`, a skip link, JSON-LD (`Plumber` + service catalog), OG/Twitter meta, a canonical URL, `robots.txt` and `sitemap.xml`.
- The canvas is `aria-hidden`. Everything the 3D scene shows is also stated in the text.
- Headings are split into words for the reveal animation. The original text is kept as `aria-label`, and the word spans are hidden from screen readers.
- The valve interaction has a real `<button aria-pressed>` equivalent with an `aria-live` status.
- **`prefers-reduced-motion`** turns off Lenis, mouse parallax, the magnetic/lean effects, the custom cursor and the reveal travel. The camera still follows scroll, because that motion is user-driven.
- The site works without JavaScript: all content is visible and anchor links scroll.

### Intentional lighting & shading
- **Ray-traced light baking** (`scripts/bake-lighting.mjs`). The pipe network is pure, deterministic geometry (`src/webgl/network.js`), so Node builds exactly the same vertices as the browser. The baker uses `three-mesh-bvh` and computes:
  - 64 cosine-weighted AO rays per vertex and per floor texel
  - 16 jittered cone rays towards the key light, for soft penumbra shadows

  The output is **91 KB** (`public/bake/lighting.{json,bin}`). At runtime it is applied as vertex colours and as the floor's lightmap texture. On metals the vertex colour also acts as specular occlusion. Vertex counts are checked for each part, so a stale bake falls back gracefully instead of corrupting the scene.
- **PBR materials** (`materials.js`):
  - Brushed copper and steel: anisotropy plus a procedural brushed roughness map
  - Enamelled cast-iron valve: clear coat over oxide red
  - Refractive sight-glass: `transmission`, `ior` and `attenuation`, with the water refracted through it
  - Fabric hand-wheel grip: `sheen`
  - Brass fittings and rough rubber gaskets
- **Studio environment** (`environment.js`). A hand-placed softbox rig is rendered once to a PMREM map:
  - Warm key aligned with the baked shadow direction
  - Cool rim light
  - Top fill
  - Warm floor bounce
  - Teal kicker that echoes the water

### Motion & interaction ("juice")
- **Inertial camera.** Scroll maps to a float index between shots. Positions and targets are sampled on centripetal Catmull-Rom splines with a quintic "dwell" ease. The camera then lerps towards that point with frame-rate-independent damping (`1 - e^(-λ·dt)`). Lenis adds smooth scrolling on top.
- **Magnetic hover.** The valve leans towards the cursor, swells slightly and spins its hand-wheel. Clicking it shuts off the flow: the water and bubbles stop and the glow fades. Buttons are magnetic too, with their labels moving on a separate layer.
- **Parallax layers.** There are four depths:
  - the 3D scene (camera + mouse parallax)
  - giant outline "ghost" type (`data-speed=0.55`)
  - foreground copy
  - service cards (`data-speed>1`)

  The 3D scene has its own depth layers as well: foreground line, mid rack and back trunk.
- **Exploded view.** In the precision shot the flange separates, the gasket lifts and the bolts withdraw, all driven by scroll.

### Post-processing (cinema look)
`postprocessing` runs two merged effect passes on a HalfFloat, 4×MSAA target:
1. **Depth of field**, auto-focused on each shot's subject, with bokeh size animated per shot. **Mipmap bloom** runs in the same pass on HDR highlights and the water.
2. **Chromatic aberration** with radial falloff (it intensifies with scroll velocity), **AgX tone mapping**, a **vignette** and **film grain** (overlay noise).

### Typography & UI contrast
- *Instrument Serif* display type is paired with *Inter Tight* (variable). Both are self-hosted through Fontsource, with no third-party requests.
- Sections get directional scrims behind the copy, so text stays legible over any frame.
- Structural UI (spec tables, stats, services, form, nav) uses `backdrop-filter` glass, with an opaque fallback where it isn't supported.

## Using a Blender bake instead
The runtime reads baked light from `public/bake/lighting.bin`: one byte per vertex for each named part, plus a floor lightmap. To author the scene in Blender:
1. Model it and bake with Cycles to a **Color Attribute** (AO + shadow).
2. Export a GLB.
3. Load it with `GLTFLoader` in place of `buildNetwork()`, and set `vertexColors: true` on the materials, which is already set.

Adding a KTX2 lightmap on `uv1` instead would need a GLTF/KTX2 loading path. That path is not included yet.

## Before launch
- The company details are placeholders: the stats, "Est. 1998", `pipeworks.example`, the 555 phone number and the email. Replace them, and add a real `og.jpg`.
- The contact form posts using the Netlify Forms convention. On other hosts, point the `fetch` in `main.js` at your own endpoint.
