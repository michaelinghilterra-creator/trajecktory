#!/usr/bin/env node
// Downscale the user's sign-in screenshots (tjk-run7-shots/image1-7.png) into
// captures/signin-1..7.png so they fit the guide and can be reviewed. Loads via a
// real file:// HTML page so the file:// <img> resolves (about:blank cannot).
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'captures');
mkdirSync(OUT, { recursive: true });
const htmlPath = resolve(OUT, '_resize.html');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1.5 });
// Source screenshots: override with SHOTS_DIR, else a folder next to this script.
// No hardcoded absolute path, so the repo stays portable.
const SRC_DIR = process.env.SHOTS_DIR ? resolve(process.env.SHOTS_DIR) : resolve(__dirname, 'tjk-run7-shots');
for (let i = 1; i <= 7; i++) {
  const src = pathToFileURL(resolve(SRC_DIR, `image${i}.png`)).href;
  writeFileSync(htmlPath, `<body style="margin:0"><img id="i" src="${src}" style="width:1000px;display:block"></body>`);
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.waitForFunction(() => { const i = document.getElementById('i'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 20000 });
  await page.waitForTimeout(150);
  await page.locator('#i').screenshot({ path: resolve(OUT, `signin-${i}.png`) });
  console.log('resized image' + i);
}
await browser.close();
