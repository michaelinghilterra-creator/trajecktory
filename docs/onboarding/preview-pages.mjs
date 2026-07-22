#!/usr/bin/env node
/**
 * preview-pages.mjs — render each .page of a guide HTML to a PNG so the layout
 * and annotation alignment can be reviewed (the same Chromium that makes the PDF),
 * AND fail if any page has silently outgrown its box.
 *
 * Usage: node docs/onboarding/preview-pages.mjs <guide.html> <prefix>
 *        node docs/onboarding/preview-pages.mjs <guide.html> --check   (no PNGs)
 *        node docs/onboarding/preview-pages.mjs <guide.html> --report  (headroom per page)
 *
 * --report prints how much vertical room each page has left. Use it before adding
 * content, and to confirm the check is measuring something real: a gate that only
 * ever passes tells you nothing about whether it works.
 *
 * Why the check exists: .page is a fixed 11in box with overflow:hidden, so content
 * that runs past the bottom is CLIPPED rather than pushed to a new page. Nothing
 * reported it. render-pdf.mjs counts pages after the fact but validates nothing, so
 * a guide could lose the end of a paragraph and still build clean, and the first
 * reader to notice would be a user holding the PDF.
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [input, prefix] = process.argv.slice(2);
if (!input) {
  console.error('usage: node preview-pages.mjs <guide.html> [prefix|--check]');
  process.exit(2);
}
const report = prefix === '--report';
const checkOnly = report || prefix === '--check' || !prefix;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts && document.fonts.ready);
await page.waitForTimeout(400);

const n = await page.locator('.page').count();

if (!checkOnly) {
  const OUT = resolve(__dirname, 'captures', 'preview');
  mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < n; i++) {
    await page.locator('.page').nth(i).screenshot({ path: resolve(OUT, `${prefix}-p${i + 1}.png`) });
  }
  console.log(`rendered ${n} pages -> ${OUT}/${prefix}-p*.png`);
}

// .page is height:11in + overflow:hidden + box-sizing:border-box, so scrollHeight
// exceeding clientHeight is exactly the clipping condition. .foot is absolutely
// positioned inside the box and contributes nothing. A 1px tolerance absorbs
// sub-pixel rounding in the padding accounting.
const pages = await page.$$eval('.page', els => els.map((el, i) => {
  const cs = getComputedStyle(el);
  const boxTop = el.getBoundingClientRect().top;
  let maxBottom = 0;
  for (const c of el.children) {
    if (c.classList.contains('foot')) continue;   // absolutely positioned, out of flow
    const r = c.getBoundingClientRect();
    if (r.height > 0) maxBottom = Math.max(maxBottom, r.bottom - boxTop);
  }
  const head = Math.round(el.clientHeight - parseFloat(cs.paddingBottom) - maxBottom);
  const h = el.querySelector('.h1, .h2, .title');
  return { p: i + 1, over: el.scrollHeight - el.clientHeight, head,
           title: (h ? h.textContent : '').trim().replace(/\s+/g, ' ').slice(0, 44) };
}));
const over = pages.filter(x => x.over > 1);

await browser.close();

if (report) {
  console.log(`${input}\n  page  headroom  status  title`);
  for (const r of pages) {
    const status = r.over > 1 ? 'CLIPPED' : r.head < 60 ? 'TIGHT' : '';
    console.log(`  ${String(r.p).padStart(4)}  ${String(r.head).padStart(6)}px  ${status.padEnd(7)} ${r.title}`);
  }
}

if (over.length) {
  console.error(`CLIPPED in ${input}: ${over.map(o => `p${o.p} +${o.over}px`).join(', ')}`);
  console.error('Those pages are losing content off the bottom. Trim them or split the page.');
  process.exit(1);
}
console.log(`no overflow: ${n} pages fit`);
