// Bundles the built app into one self-contained HTML file you can open by
// double-clicking it: no server, no install. AI scan stays off in this mode.
//
//   npm run build:single            -> dist-single/leakproof.html
//   node scripts/build-single.mjs --fragment out.html
//        same page without the <html>/<head>/<body> wrapper, for hosts that
//        add their own document skeleton.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || join(root, 'dist-single', 'leakproof.html');

let html = await readFile(join(dist, 'index.html'), 'utf8');
const icon = await readFile(join(root, 'public', 'icon.svg'), 'utf8');

// Inline the stylesheet and the script. Function replacers keep "$" in the
// bundled code from being read as replacement patterns.
const cssHref = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
const css = await readFile(join(dist, cssHref[1]), 'utf8');
html = html.replace(cssHref[0], () => `<style>${css}</style>`);

const jsSrc = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
const js = (await readFile(join(dist, jsSrc[1]), 'utf8')).replace(/<\/script/gi, '<\\/script');
html = html.replace(jsSrc[0], '');
html = html.replace('</body>', () => `<script type="module">${js}</script>\n</body>`);

// Drop the PWA files (they need a server) and embed the icon.
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
html = html.replace(/href="\/icon\.svg"/, `href="data:image/svg+xml,${encodeURIComponent(icon)}"`);

if (fragment) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/\s*<meta charset[^>]*>/, '')
    .replace(/\s*<meta name="viewport"[^>]*>/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = `${head.trim()}\n${body.trim()}\n`;
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
