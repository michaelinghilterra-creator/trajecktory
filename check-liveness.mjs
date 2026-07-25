#!/usr/bin/env node

/**
 * check-liveness.mjs — Playwright job link liveness checker
 *
 * Tests whether job posting URLs are still active or have expired.
 * Uses the same detection logic as scan.md step 7.5.
 * Zero Claude API tokens — pure Playwright.
 *
 * Usage:
 *   node check-liveness.mjs <url1> [url2] ...
 *   node check-liveness.mjs --file urls.txt
 *   node check-liveness.mjs --isolated --file urls.txt
 *
 * Flags:
 *   --file <path>   read newline-delimited URLs from a file (# lines ignored)
 *   --isolated      use a fresh page per URL (avoids the "interrupted by
 *                   another navigation" artifact some SPAs trigger on a reused
 *                   page); slightly slower. Default reuses one page.
 *
 * Exit code: 0 if all active, 1 if any expired or uncertain
 */

import { chromium } from 'playwright';
import { readFile } from 'fs/promises';
import { classifyLiveness, parseWorkdayUrl, checkWorkdayLiveness } from './liveness-core.mjs';

// Navigate to a URL and classify it. Shared by both the reused-page and
// isolated (fresh-page) modes so the detection logic exists in one place.
async function probePage(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const status = response?.status() ?? 0;

  // Give SPAs (Ashby, Lever, Workday) time to hydrate
  await page.waitForTimeout(2000);

  const finalUrl = page.url();
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
  const applyControls = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]')
    );

    return candidates
      .filter((element) => {
        if (element.closest('nav, header, footer')) return false;
        if (element.closest('[aria-hidden="true"]')) return false;

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (!element.getClientRects().length) return false;

        return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
      })
      .map((element) => {
        const label = [
          element.innerText,
          element.value,
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
        ]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        return label;
      })
      .filter(Boolean);
  });

  return classifyLiveness({ status, finalUrl, bodyText, applyControls });
}

// Check one URL. In isolated mode, use a fresh page (closed afterwards);
// otherwise reuse the shared page.
// Reject non-public targets before any navigation or API probe. An attacker-
// influenced job URL (written into pipeline.md by scan.mjs from board JSON) could
// point at loopback / private / link-local / cloud-metadata addresses and turn
// this liveness probe into an SSRF (security: CWE-918). Best-effort literal check;
// hostnames that DNS-resolve to private space are out of scope for a job-URL probe.
function isSafeLivenessUrl(url) {
  let u;
  try { u = new URL(String(url == null ? '' : url)); } catch (e) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.includes(':')) return false;
  const parts = h.split('.');
  if (parts.length === 4 && parts.every(p => p.length > 0 && Number.isInteger(Number(p)) && Number(p) >= 0 && Number(p) <= 255)) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return true;
}

async function checkUrl(browser, sharedPage, url, isolated) {
  if (!isSafeLivenessUrl(url)) {
    return { result: 'expired', reason: 'refused: non-public / loopback / metadata URL' };
  }
  // Workday job pages 404 / time out on a raw Playwright load even when live, so
  // resolve them via the CXS JSON API first. Only a definitive verdict short-
  // circuits; an inconclusive API result (null) falls through to Playwright.
  if (parseWorkdayUrl(url)) {
    const verdict = await checkWorkdayLiveness(url);
    if (verdict) return verdict;
  }

  const page = isolated ? await browser.newPage() : sharedPage;
  try {
    return await probePage(page, url);
  } catch (err) {
    return { result: 'expired', reason: `navigation error: ${err.message.split('\n')[0]}` };
  } finally {
    if (isolated) await page.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isolated = args.includes('--isolated') || args.includes('--fresh-page');
  const rest = args.filter((a) => a !== '--isolated' && a !== '--fresh-page');

  if (rest.length === 0) {
    console.error('Usage: node check-liveness.mjs <url1> [url2] ...');
    console.error('       node check-liveness.mjs --file urls.txt');
    console.error('       node check-liveness.mjs --isolated --file urls.txt');
    process.exit(1);
  }

  let urls;
  if (rest[0] === '--file') {
    const text = await readFile(rest[1], 'utf-8');
    urls = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } else {
    urls = rest;
  }

  console.log(`Checking ${urls.length} URL(s)${isolated ? ' (isolated)' : ''}...\n`);

  const browser = await chromium.launch({ headless: true });
  const sharedPage = isolated ? null : await browser.newPage();

  let active = 0, expired = 0, uncertain = 0;

  // Sequential — project rule: never Playwright in parallel
  for (const url of urls) {
    const { result, reason } = await checkUrl(browser, sharedPage, url, isolated);
    const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[result];
    console.log(`${icon} ${result.padEnd(10)} ${url}`);
    if (result !== 'active') console.log(`           ${reason}`);
    if (result === 'active') active++;
    else if (result === 'expired') expired++;
    else uncertain++;
  }

  await browser.close();

  console.log(`\nResults: ${active} active  ${expired} expired  ${uncertain} uncertain`);
  if (expired > 0 || uncertain > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
