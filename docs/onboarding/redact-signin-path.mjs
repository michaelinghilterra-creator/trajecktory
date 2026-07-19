#!/usr/bin/env node
/**
 * redact-signin-path.mjs — one-shot privacy fix for captures/signin-6.png.
 *
 * That screenshot is a real Claude Code console prompt, captured before the
 * response-interception system existed, and it prints the absolute path of the
 * project's AGENTS.md. The path contains the real Windows account name, which
 * would ship inside a public release PDF. Nothing automated catches this:
 * verify-no-pii.mjs scans the tracked tree and the .exe payload, and captures/
 * is gitignored while the PDFs are release assets.
 *
 * The path is replaced with the same C:\Users\you\... placeholder the guides use
 * everywhere else, rather than blacked out, so the screenshot still teaches the
 * step it is there to teach.
 *
 * The background colour is SAMPLED from the image rather than guessed, so the
 * patch is invisible instead of a slightly-wrong dark rectangle.
 *
 * Idempotent: re-running it just repaints the same replacement.
 *
 * Usage: node docs/onboarding/redact-signin-path.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMG = resolve(__dirname, 'captures', 'signin-6.png');

// Region of the leaked line, measured from the 1500x348 capture.
const PATCH = { x: 34, y: 115, w: 500, h: 24 };
const TEXT = 'C:\\Users\\you\\trajecktory\\trajecktory\\AGENTS.md';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 348 } });

// Inlined as a data URI: a page created with setContent has an opaque origin and
// cannot load a file:// image, and the canvas sample below would taint anyway.
const dataUri = 'data:image/png;base64,' + readFileSync(IMG).toString('base64');
await page.setContent(`<body style="margin:0;padding:0">
  <img id="shot" src="${dataUri}" style="display:block">
</body>`);
await page.waitForFunction(() => {
  const i = document.getElementById('shot');
  return i && i.complete && i.naturalWidth > 0;
});

const { width, height } = await page.evaluate(() => {
  const i = document.getElementById('shot');
  return { width: i.naturalWidth, height: i.naturalHeight };
});
if (width !== 1500 || height !== 348) {
  console.warn(`! signin-6.png is ${width}x${height}, expected 1500x348. Patch coordinates may be off; check the result.`);
}

// Sample the terminal background from a point on the same line but well right of
// any glyph, so the patch matches exactly.
const bg = await page.evaluate(({ y }) => {
  const img = document.getElementById('shot');
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const d = c.getContext('2d').getImageData(1200, y + 10, 1, 1).data;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}, { y: PATCH.y });

await page.evaluate(({ PATCH, TEXT, bg }) => {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'absolute', left: PATCH.x + 'px', top: PATCH.y + 'px',
    width: PATCH.w + 'px', height: PATCH.h + 'px', background: bg,
  });
  const txt = document.createElement('div');
  Object.assign(txt.style, {
    position: 'absolute', left: (PATCH.x + 10) + 'px', top: (PATCH.y + 3) + 'px',
    font: '15px Consolas, "Cascadia Mono", "Courier New", monospace',
    color: '#c9c9c9', whiteSpace: 'pre', letterSpacing: '0px',
  });
  txt.textContent = TEXT;
  document.body.appendChild(box);
  document.body.appendChild(txt);
}, { PATCH, TEXT, bg });

await page.screenshot({ path: IMG, clip: { x: 0, y: 0, width, height } });
await browser.close();
console.log(`redacted ${IMG}`);
console.log(`  sampled background ${bg}, wrote placeholder path`);
