import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, 'src');
const DIST = path.resolve(__dirname, 'src/dist');

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

const entries = fs.readdirSync(SRC).filter(f => f.endsWith('.jsx'));

const t0 = Date.now();
await build({
  entryPoints: entries.map(f => path.join(SRC, f)),
  outdir: DIST,
  outExtension: { '.js': '.js' },
  bundle: false,
  loader: { '.jsx': 'jsx' },
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  format: 'iife',
  target: 'es2019',
  logLevel: 'warning',
});

// Vendor React from node_modules into dist (replaces the unpkg CDN <script>s).
// package.json pins the version; copying the prebuilt UMD bundles keeps the
// global `React`/`ReactDOM` the per-file IIFEs expect, with no bundler. dist is
// gitignored, so these are regenerated on every build like the transpiled app.
const NM = path.resolve(__dirname, 'node_modules');
const vendor = [
  ['react/umd/react.production.min.js', 'react.production.min.js'],
  ['react-dom/umd/react-dom.production.min.js', 'react-dom.production.min.js'],
];
for (const [from, to] of vendor) {
  fs.copyFileSync(path.join(NM, from), path.join(DIST, to));
}
console.log(`[build] ${entries.length} JSX files + ${vendor.length} vendored libs → src/dist/ in ${Date.now() - t0}ms`);
