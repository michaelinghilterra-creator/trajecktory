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

// Vendor React locally by BUNDLING it with esbuild. React 19 dropped the UMD
// builds we used to copy, so instead produce one self-contained IIFE that sets
// the global `React`/`ReactDOM` the per-file app bundles expect. react and
// react-dom go in a SINGLE bundle so there is exactly one React instance — a
// separate react-dom bundle would embed its own copy of react and break the
// hooks dispatcher. Stays local/offline (no CDN); dist is gitignored, so this
// is regenerated on every build like the transpiled app.
await build({
  stdin: {
    contents: [
      "import React from 'react';",
      "import ReactDOMMain from 'react-dom';",
      "import { createRoot, hydrateRoot } from 'react-dom/client';",
      "window.React = React;",
      "window.ReactDOM = Object.assign({}, ReactDOMMain, { createRoot, hydrateRoot });",
    ].join('\n'),
    resolveDir: __dirname, // resolve react/react-dom from ./node_modules
    loader: 'js',
  },
  outfile: path.join(DIST, 'react-vendor.min.js'),
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2019',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
console.log(`[build] ${entries.length} JSX files + vendored React (bundled) → src/dist/ in ${Date.now() - t0}ms`);
