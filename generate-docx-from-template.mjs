#!/usr/bin/env node

/**
 * generate-docx-from-template.mjs
 *
 * Produces a tailored .docx by copying templates/cv-master.docx (the user's
 * Word resume) and surgically swapping the text of named slots inside
 * word/document.xml, preserving every byte of formatting we don't touch.
 *
 * Slots are located by matching the start of a paragraph's concatenated text
 * against a locator string. When matched, ALL runs in that paragraph are
 * replaced with a single new run that reuses the original paragraph's first
 * run's <w:rPr> (so bold/font/size/italic/color carry over) and contains the
 * new text.
 *
 * Usage:
 *   node generate-docx-from-template.mjs \\
 *     --template templates/cv-master.docx \\
 *     --swaps /tmp/swaps.json \\
 *     --output output/cv-xyz-2026-06-05.docx
 *
 * --swaps points to a JSON file like:
 *   {
 *     "title": "Senior Director of Revenue Operations",
 *     "subtitle_secondary": "Pipeline | Forecasting | Field Enablement",
 *     "summary": "Revenue Operations leader with eight years...",
 *     "areas_of_expertise": "Revenue Forecasting, Pipeline Inspection, ..."
 *   }
 *
 * Slot names not provided in the swaps file are left untouched.
 *
 * Locators are configured in templates/cv-template-slots.json — edit that
 * file if you restructure the top of your master resume.
 */

import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = __dirname;

function parseArgs(argv) {
  const opts = {
    template: `${REPO}/templates/cv-master.docx`,
    slots: `${REPO}/templates/cv-template-slots.json`,
    swaps: null,
    output: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--template') opts.template = resolve(argv[++i]);
    else if (a === '--slots') opts.slots = resolve(argv[++i]);
    else if (a === '--swaps') opts.swaps = resolve(argv[++i]);
    else if (a === '--output') opts.output = resolve(argv[++i]);
    else if (!opts.swaps && !a.startsWith('--')) opts.swaps = resolve(a);
    else if (!opts.output && !a.startsWith('--')) opts.output = resolve(a);
  }
  return opts;
}

/**
 * Walk paragraph blocks in document.xml. For each, check if any slot
 * locator matches the paragraph's start text. If so, splice in a replacement
 * run.
 */
function rewriteDocumentXml(xml, slots, swaps, report) {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paraXml) => {
    const fullText = extractText(paraXml);
    for (const [slotName, slotDef] of Object.entries(slots)) {
      if (!(slotName in swaps)) continue;
      const locator = slotDef.locator;
      if (!locator) continue;
      const matchKind = slotDef.match || 'exact';
      const hit = matchKind === 'exact'
        ? fullText.trim() === locator
        : fullText.startsWith(locator);
      if (!hit) continue;
      const newText = swaps[slotName];
      const rebuilt = replaceParagraphText(paraXml, newText);
      report.push({ slot: slotName, oldLen: fullText.length, newLen: newText.length });
      return rebuilt;
    }
    return paraXml;
  });
}

function extractText(paraXml) {
  let out = '';
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(paraXml)) !== null) {
    out += m[1];
  }
  return decodeXmlEntities(out);
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function encodeXmlEntities(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replace all <w:r>...</w:r> children of a paragraph with one new run that
 * carries the original first run's <w:rPr>. Keeps <w:pPr> intact.
 */
function replaceParagraphText(paraXml, newText) {
  const pPrMatch = paraXml.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';

  const firstRunMatch = paraXml.match(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/);
  let rPr = '';
  if (firstRunMatch) {
    const inner = firstRunMatch[1];
    const rPrMatch = inner.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/);
    if (rPrMatch) rPr = rPrMatch[0];
  }

  const safeText = encodeXmlEntities(newText);
  const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${safeText}</w:t></w:r>`;

  // Pull out the opening <w:p ...> tag so we can preserve its attributes.
  const openTagMatch = paraXml.match(/<w:p\b[^>]*>/);
  const openTag = openTagMatch ? openTagMatch[0] : '<w:p>';

  return `${openTag}${pPr}${newRun}</w:p>`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.swaps || !opts.output) {
    console.error('Usage: node generate-docx-from-template.mjs --swaps <file.json> --output <out.docx> [--template <master.docx>] [--slots <slots.json>]');
    process.exit(1);
  }
  if (!existsSync(opts.template)) {
    console.error(`CV master template not found: ${opts.template}`);
    console.error('Provide your Word resume at templates/cv-master.docx. It is user-layer (not shipped); the dashboard Launchpad / onboarding generates it from your CV.');
    process.exit(1);
  }
  for (const [k, v] of Object.entries({ slots: opts.slots, swaps: opts.swaps })) {
    if (!existsSync(v)) {
      console.error(`${k} not found: ${v}`);
      process.exit(1);
    }
  }

  const slots = JSON.parse(readFileSync(opts.slots, 'utf-8'));
  const swaps = JSON.parse(readFileSync(opts.swaps, 'utf-8'));

  mkdirSync(dirname(opts.output), { recursive: true });
  copyFileSync(opts.template, opts.output);

  const zip = new AdmZip(opts.output);
  const docEntry = zip.getEntry('word/document.xml');
  if (!docEntry) {
    console.error('word/document.xml not found in template');
    process.exit(1);
  }

  const before = docEntry.getData().toString('utf-8');
  const report = [];
  const after = rewriteDocumentXml(before, slots, swaps, report);

  zip.deleteFile('word/document.xml');
  zip.addFile('word/document.xml', Buffer.from(after, 'utf-8'));
  zip.writeZip(opts.output);

  console.log(`Template: ${opts.template}`);
  console.log(`Output:   ${opts.output}`);
  if (report.length === 0) {
    console.log('No slots swapped (swaps file was empty or no slots matched).');
  } else {
    console.log(`Swapped ${report.length} slot(s):`);
    for (const r of report) {
      const baseline = slots[r.slot]?.baseline_chars;
      let lengthNote = '';
      if (baseline) {
        const drift = ((r.newLen - baseline) / baseline) * 100;
        const sign = drift >= 0 ? '+' : '';
        lengthNote = `  baseline=${baseline}  drift=${sign}${drift.toFixed(0)}%`;
        if (Math.abs(drift) > 15) {
          lengthNote += '  WARNING_LENGTH_OFF';
        }
      }
      console.log(`  - ${r.slot}: ${r.oldLen} -> ${r.newLen} chars${lengthNote}`);
    }
    const blockers = report.filter((r) => {
      const slot = slots[r.slot];
      if (!slot?.baseline_chars || !slot?.page_break_sensitive) return false;
      return Math.abs((r.newLen - slot.baseline_chars) / slot.baseline_chars) > 0.15;
    });
    if (blockers.length > 0) {
      console.warn('');
      console.warn(`LENGTH WARNING: ${blockers.length} page-break-sensitive slot(s) drift more than +-15% from the master.`);
      console.warn('This will shift page break geometry away from how the master flows.');
      console.warn('Either tighten/extend the tailored text or override with --allow-length-drift.');
      if (!process.argv.includes('--allow-length-drift')) {
        process.exit(2);
      }
    }
  }
  const unswapped = Object.keys(swaps).filter((k) => !report.some((r) => r.slot === k));
  if (unswapped.length > 0) {
    console.warn(`WARNING: requested swaps did not match any paragraph: ${unswapped.join(', ')}`);
    console.warn('Check that the locators in', opts.slots, 'match your master file.');
  }
}

main();
