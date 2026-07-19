#!/usr/bin/env node
/**
 * capture-web.mjs — capture the public web pages used in Guide 1 (Claude setup).
 * These are public, unauthenticated pages: the Claude site and the Git for
 * Windows download page. Account creation, payment, and the Claude Desktop app
 * itself are user-specific or external and are handled as illustrations or
 * placeholders in the guide, not captured here.
 *
 * Usage: node docs/onboarding/capture-web.mjs
 * Network required. If a page blocks headless browsers, it logs and continues;
 * the guide falls back to a labeled placeholder for that shot.
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'captures');
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1366, height: 900 };
const SCALE = 2;

// `crop` keeps only the top fraction of the viewport. A guide page is a fixed
// 8.5x11in box with `overflow: hidden`, so a near-square screenshot silently
// pushes whatever follows it off the bottom of the page. Cropping away the part
// of the page the guide never refers to is the fix; shrinking the figure instead
// just makes the text unreadable.
//
// CAUTION: the guides position their ring/tag annotations as percentages of the
// image box, so changing a `crop` value INVALIDATES every ring on that figure and
// they must be re-measured against the new image.
const TARGETS = [
  { name: 'web-claude-home', url: 'https://claude.com/', full: false },
  { name: 'web-claude-pricing', url: 'https://claude.com/pricing', full: false },
  // Guide 1 page 4/8 only uses the hero and the two download buttons. Capturing
  // the full viewport also pulled in the "Get started" section, which overflowed
  // the page and cut off the SmartScreen illustration below it.
  { name: 'web-claude-download', url: 'https://claude.com/download', full: false, crop: 0.58 },
  { name: 'web-git-download', url: 'https://git-scm.com/downloads/win', full: false },
  { name: 'web-gitforwindows', url: 'https://gitforwindows.org/', full: false },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: SCALE,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  for (const t of TARGETS) {
    try {
      console.log('capturing', t.name, t.url);
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3500); // let hero/marketing content settle
      // dismiss common cookie banners if present
      for (const label of ['Accept all', 'Accept All', 'Accept', 'I agree', 'Got it']) {
        try { const b = page.getByRole('button', { name: label }); if (await b.count()) { await b.first().click({ timeout: 1500 }); break; } } catch {}
      }
      await page.waitForTimeout(800);
      // clip is in CSS pixels; deviceScaleFactor still applies, so a 0.58 crop of
      // a 1366x900 viewport at scale 2 writes 2732x1044.
      const clip = t.crop
        ? { x: 0, y: 0, width: VIEWPORT.width, height: Math.round(VIEWPORT.height * t.crop) }
        : undefined;
      await page.screenshot({ path: resolve(OUT, `${t.name}.png`), fullPage: !!t.full, clip });
      console.log('  saved', t.name + '.png' + (t.crop ? ` (top ${Math.round(t.crop * 100)}%)` : ''));
    } catch (e) {
      console.log('  FAILED (will use placeholder in guide):', t.name, '-', e.message);
    }
  }

  await browser.close();
  console.log('Done. Web screenshots in', OUT);
}

main().catch((e) => { console.error('web capture failed:', e); process.exit(1); });
