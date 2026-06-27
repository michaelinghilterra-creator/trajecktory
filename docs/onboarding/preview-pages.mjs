#!/usr/bin/env node
/**
 * preview-pages.mjs — render each .page of a guide HTML to a PNG so the layout
 * and annotation alignment can be reviewed (the same Chromium that makes the PDF).
 * Usage: node docs/onboarding/preview-pages.mjs <guide.html> <prefix>
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [input, prefix] = process.argv.slice(2);
const OUT = resolve(__dirname, 'captures', 'preview');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts && document.fonts.ready);
await page.waitForTimeout(400);
const n = await page.locator('.page').count();
for (let i = 0; i < n; i++) {
  await page.locator('.page').nth(i).screenshot({ path: resolve(OUT, `${prefix}-p${i + 1}.png`) });
}
console.log(`rendered ${n} pages -> ${OUT}/${prefix}-p*.png`);
await browser.close();
