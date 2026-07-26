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
 * BULLET TAILORING (optional, past the top four slots):
 * A bullet "group" is one role's contiguous block of Word list items (the
 * paragraphs carrying <w:numPr>). Groups are keyed by their ORDINAL position
 * in the document (0 = the first role's bullets, 1 = the next role's, ...),
 * not by bullet text, so the config survives a full resume rewrite. When the
 * swaps file carries a "bullets" object, each group's bullet paragraphs are
 * replaced with the supplied ordered list, each new paragraph cloned from that
 * group's first bullet so list formatting (numId/ilvl, font, size) is exact.
 * The engine is a deterministic executor: it does not know whether a bullet is
 * truthful. The docx mode is responsible for only ever reordering, curating, or
 * lightly rephrasing the candidate's REAL bullets, never inventing.
 *
 * Usage:
 *   node generate-docx-from-template.mjs \\
 *     --template templates/cv-master.docx \\
 *     --swaps /tmp/swaps.json \\
 *     --output output/cv-xyz-2026-06-05.docx
 *
 * --swaps points to a JSON file like:
 *   {
 *     "title": "Senior Director of Customer Support",
 *     "subtitle_secondary": "Pipeline | Forecasting | Field Enablement",
 *     "summary": "Revenue Operations leader with eight years...",
 *     "areas_of_expertise": "Revenue Forecasting, Pipeline Inspection, ...",
 *     "bullets": {
 *       "role_0": ["Reordered / lightly rephrased bullet one.", "Bullet two."]
 *     }
 *   }
 *
 * Slot names not provided in the swaps file are left untouched. Bullet groups
 * not listed under "bullets" are left untouched.
 *
 * Slot locators live in templates/cv-template-slots.json. Bullet-group
 * definitions live in templates/cv-bullet-groups.json (both user-layer). Edit
 * those if you restructure your master resume.
 */

import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = __dirname;
const LENGTH_DRIFT_LIMIT = 0.15;

function parseArgs(argv) {
  const opts = {
    template: `${REPO}/templates/cv-master.docx`,
    slots: `${REPO}/templates/cv-template-slots.json`,
    bulletGroups: `${REPO}/templates/cv-bullet-groups.json`,
    swaps: null,
    output: null,
    allowLengthDrift: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--template') opts.template = resolve(argv[++i]);
    else if (a === '--slots') opts.slots = resolve(argv[++i]);
    else if (a === '--bullet-groups') opts.bulletGroups = resolve(argv[++i]);
    else if (a === '--swaps') opts.swaps = resolve(argv[++i]);
    else if (a === '--output') opts.output = resolve(argv[++i]);
    else if (a === '--allow-length-drift') opts.allowLengthDrift = true;
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

/**
 * Split document.xml into ordered paragraph descriptors. Each is
 * { xml, start, end, isList, text }. Positions index into `xml`.
 */
function scanParagraphs(xml) {
  const re = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push({
      xml: m[0],
      start: m.index,
      end: m.index + m[0].length,
      isList: /<w:numPr\b/.test(m[0]),
      text: extractText(m[0]).trim(),
    });
  }
  return out;
}

/**
 * Group the paragraphs into ordered bullet blocks: each maximal run of
 * consecutive list paragraphs. Returns [{ startIdx, endIdx }] in document
 * order, where indices point into the `paras` array.
 */
function findBulletBlocks(paras) {
  const blocks = [];
  let i = 0;
  while (i < paras.length) {
    if (!paras[i].isList) { i++; continue; }
    const startIdx = i;
    while (i < paras.length && paras[i].isList) i++;
    blocks.push({ startIdx, endIdx: i - 1 });
  }
  return blocks;
}

/**
 * Replace each requested bullet group's paragraphs with the supplied ordered
 * list of bullet texts. Groups are matched by ordinal (their position among
 * the document's bullet blocks). Each new bullet paragraph is cloned from the
 * group's first bullet, so list formatting carries over exactly.
 */
function rewriteBulletGroups(xml, groups, bulletsSwaps, report, opts) {
  const paras = scanParagraphs(xml);
  const blocks = findBulletBlocks(paras);
  const edits = [];

  for (const [groupName, newBullets] of Object.entries(bulletsSwaps)) {
    const def = groups[groupName];
    if (!def || typeof def.ordinal !== 'number') {
      report.push({ group: groupName, error: 'no such bullet group (check ordinal in cv-bullet-groups.json)', blocker: true });
      continue;
    }
    const block = blocks[def.ordinal];
    if (!block) {
      report.push({ group: groupName, error: `ordinal ${def.ordinal} has no bullet block (master has ${blocks.length})`, blocker: true });
      continue;
    }
    if (!Array.isArray(newBullets)) {
      report.push({ group: groupName, error: 'bullets value must be an array of strings', blocker: true });
      continue;
    }
    const oldParas = paras.slice(block.startIdx, block.endIdx + 1);
    const oldCount = oldParas.length;
    const oldChars = oldParas.reduce((s, p) => s + p.text.length, 0);
    const newCount = newBullets.length;
    const newChars = newBullets.reduce((s, t) => s + t.length, 0);

    if (newCount === 0) {
      report.push({ group: groupName, oldCount, newCount, oldChars, newChars, error: 'refusing to delete every bullet in a role', blocker: !opts.allowLengthDrift });
      if (!opts.allowLengthDrift) continue;
    }

    const template = oldParas[0].xml;
    const replacement = newBullets.map((t) => replaceParagraphText(template, String(t))).join('');
    edits.push({ from: oldParas[0].start, to: oldParas[oldParas.length - 1].end, replacement });

    const baselineCount = def.baseline_count;
    const baselineChars = def.baseline_chars;
    const countChanged = baselineCount != null && newCount !== baselineCount;
    const drift = baselineChars ? (newChars - baselineChars) / baselineChars : 0;
    const pageBreakSensitive = def.page_break_sensitive !== false; // default true
    const overDrift = baselineChars != null && Math.abs(drift) > LENGTH_DRIFT_LIMIT;
    const blocker = pageBreakSensitive && (countChanged || overDrift) && !opts.allowLengthDrift;
    report.push({ group: groupName, ordinal: def.ordinal, label: def.label, oldCount, newCount, oldChars, newChars, baselineCount, baselineChars, drift, countChanged, overDrift, pageBreakSensitive, blocker });
  }

  // Apply edits from the end so earlier positions stay valid.
  edits.sort((a, b) => b.from - a.from);
  let out = xml;
  for (const e of edits) {
    out = out.slice(0, e.from) + e.replacement + out.slice(e.to);
  }
  return out;
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
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
 * carries the original first run's <w:rPr>. Keeps <w:pPr> intact (so a bullet's
 * <w:numPr> list membership is preserved).
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

function loadJsonWithFallback(path, exampleName, label) {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
  const example = `${REPO}/templates/${exampleName}`;
  if (existsSync(example)) {
    console.warn(`${label} file not found: ${path}`);
    console.warn(`Falling back to ${example} — its values are fictional and will not match your master.`);
    return JSON.parse(readFileSync(example, 'utf-8'));
  }
  return null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.swaps || !opts.output) {
    console.error('Usage: node generate-docx-from-template.mjs --swaps <file.json> --output <out.docx> [--template <master.docx>] [--slots <slots.json>] [--bullet-groups <groups.json>] [--allow-length-drift]');
    process.exit(1);
  }
  if (!existsSync(opts.template)) {
    console.error(`CV master template not found: ${opts.template}`);
    console.error('Provide your Word resume at templates/cv-master.docx. It is user-layer (not shipped); the dashboard Launchpad / onboarding generates it from your CV.');
    process.exit(1);
  }
  // The real slots file is user-layer (gitignored), because its locators are
  // verbatim text from the user's own master resume. A fresh clone will not have it;
  // fall back to the shipped .example so the tool runs and reports which locators
  // failed to match (prompting the user to regenerate slots from their CV) rather
  // than crashing with a bare "not found".
  const slots = loadJsonWithFallback(opts.slots, 'cv-template-slots.example.json', 'slots');
  if (!slots) {
    console.error(`slots not found: ${opts.slots} (and no example fallback)`);
    process.exit(1);
  }
  if (!existsSync(opts.swaps)) {
    console.error(`swaps not found: ${opts.swaps}`);
    process.exit(1);
  }
  const swaps = JSON.parse(readFileSync(opts.swaps, 'utf-8'));

  // Bullet groups are only needed when the swaps file requests bullet tailoring.
  const wantsBullets = swaps.bullets && typeof swaps.bullets === 'object' && Object.keys(swaps.bullets).length > 0;
  let bulletGroups = {};
  if (wantsBullets) {
    bulletGroups = loadJsonWithFallback(opts.bulletGroups, 'cv-bullet-groups.example.json', 'bullet-groups') || {};
    if (Object.keys(bulletGroups).length === 0) {
      console.warn('Bullets requested but no bullet-group definitions found; skipping bullet tailoring.');
    }
  }

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
  let after = rewriteDocumentXml(before, slots, swaps, report);
  if (wantsBullets && Object.keys(bulletGroups).length > 0) {
    after = rewriteBulletGroups(after, bulletGroups, swaps.bullets, report, opts);
  }

  zip.deleteFile('word/document.xml');
  zip.addFile('word/document.xml', Buffer.from(after, 'utf-8'));
  zip.writeZip(opts.output);

  console.log(`Template: ${opts.template}`);
  console.log(`Output:   ${opts.output}`);

  const slotReport = report.filter((r) => r.slot);
  const bulletReport = report.filter((r) => r.group);

  if (slotReport.length === 0 && bulletReport.length === 0) {
    console.log('No slots or bullet groups changed (swaps file was empty or nothing matched).');
  }

  if (slotReport.length > 0) {
    console.log(`Swapped ${slotReport.length} slot(s):`);
    for (const r of slotReport) {
      const baseline = slots[r.slot]?.baseline_chars;
      let lengthNote = '';
      if (baseline) {
        const drift = ((r.newLen - baseline) / baseline) * 100;
        const sign = drift >= 0 ? '+' : '';
        lengthNote = `  baseline=${baseline}  drift=${sign}${drift.toFixed(0)}%`;
        if (Math.abs(drift) > 15) lengthNote += '  WARNING_LENGTH_OFF';
      }
      console.log(`  - ${r.slot}: ${r.oldLen} -> ${r.newLen} chars${lengthNote}`);
    }
  }

  if (bulletReport.length > 0) {
    console.log(`Rewrote ${bulletReport.filter((r) => !r.error).length} bullet group(s):`);
    for (const r of bulletReport) {
      if (r.error) {
        console.warn(`  - ${r.group}: ${r.error}`);
        continue;
      }
      const driftPct = r.baselineChars ? `${r.drift >= 0 ? '+' : ''}${(r.drift * 100).toFixed(0)}%` : 'n/a';
      let note = `  count ${r.oldCount}->${r.newCount}  chars ${r.oldChars}->${r.newChars}  drift=${driftPct}`;
      if (r.countChanged) note += '  COUNT_CHANGED';
      if (r.overDrift) note += '  LENGTH_OFF';
      console.log(`  - ${r.group}${r.label ? ` (${r.label})` : ''}:${note}`);
    }
  }

  // Unified page-break-drift gate across slots and bullet groups.
  const slotBlockers = slotReport.filter((r) => {
    const slot = slots[r.slot];
    if (!slot?.baseline_chars || !slot?.page_break_sensitive) return false;
    return Math.abs((r.newLen - slot.baseline_chars) / slot.baseline_chars) > LENGTH_DRIFT_LIMIT;
  });
  const bulletBlockers = bulletReport.filter((r) => r.blocker);

  if (slotBlockers.length + bulletBlockers.length > 0) {
    console.warn('');
    console.warn(`LENGTH WARNING: ${slotBlockers.length + bulletBlockers.length} page-break-sensitive change(s) drift from the master (count or > +-15% chars).`);
    console.warn('This shifts page-break geometry away from how the master flows.');
    console.warn('Either tighten/extend the tailored text (match the master bullet count) or override with --allow-length-drift.');
    if (!opts.allowLengthDrift) process.exit(2);
  }

  const unswapped = Object.keys(swaps)
    .filter((k) => k !== 'bullets')
    .filter((k) => !slotReport.some((r) => r.slot === k));
  if (unswapped.length > 0) {
    console.warn(`WARNING: requested swaps did not match any paragraph: ${unswapped.join(', ')}`);
    console.warn('Check that the locators in', opts.slots, 'match your master file.');
  }
}

// Only run when invoked directly, so tests can import the pure functions.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}

export { rewriteDocumentXml, rewriteBulletGroups, scanParagraphs, findBulletBlocks, replaceParagraphText, extractText };
