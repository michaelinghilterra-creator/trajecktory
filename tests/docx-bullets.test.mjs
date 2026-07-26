#!/usr/bin/env node
/**
 * docx-bullets.test.mjs — bullet-level tailoring in generate-docx-from-template.mjs
 *
 * Hermetic: builds a synthetic word/document.xml (two bullet blocks separated
 * by a heading) and exercises rewriteBulletGroups directly. No real resume data.
 */
import assert from 'node:assert/strict';
import {
  scanParagraphs,
  findBulletBlocks,
  rewriteBulletGroups,
  replaceParagraphText,
} from '../generate-docx-from-template.mjs';

let n = 0;
const ok = (m) => { n++; console.log(`  ok ${m}`); };

// ---- synthetic document ---------------------------------------------------
const listPara = (t) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const headPara = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

const block0 = ['First bullet text AAAA', 'Second bullet text BBBB'];
const block1 = ['Gamma one CCCC', 'Delta two DDDD', 'Epsilon three EEEE'];
const chars = (a) => a.reduce((s, t) => s + t.length, 0);

const xml =
  headPara('Michael Example') +
  headPara('Director, Example Role') +
  block0.map(listPara).join('') +
  headPara('Manager, Example Role') +
  block1.map(listPara).join('');

const groups = {
  g0: { ordinal: 0, label: 'Role 0', baseline_count: 2, baseline_chars: chars(block0), page_break_sensitive: true },
  g1: { ordinal: 1, label: 'Role 1', baseline_count: 3, baseline_chars: chars(block1), page_break_sensitive: true },
};

// ---- structure detection --------------------------------------------------
const paras = scanParagraphs(xml);
const blocks = findBulletBlocks(paras);
assert.equal(blocks.length, 2, 'two bullet blocks found');
assert.equal(blocks[0].endIdx - blocks[0].startIdx + 1, 2, 'block 0 has 2 bullets');
assert.equal(blocks[1].endIdx - blocks[1].startIdx + 1, 3, 'block 1 has 3 bullets');
ok('detects two bullet blocks of sizes 2 and 3');

// ---- reorder (same count/chars → no blocker, formatting preserved) --------
{
  const report = [];
  const out = rewriteBulletGroups(xml, groups, { g0: [block0[1], block0[0]] }, report, { allowLengthDrift: false });
  const r = report.find((x) => x.group === 'g0');
  assert.ok(r && !r.blocker && !r.error, 'reorder is not blocked');
  // order swapped
  assert.ok(out.indexOf('Second bullet text BBBB') < out.indexOf('First bullet text AAAA'), 'bullets reordered');
  // list formatting preserved: same total numPr count as the master
  const numprBefore = (xml.match(/<w:numPr/g) || []).length;
  const numprAfter = (out.match(/<w:numPr/g) || []).length;
  assert.equal(numprAfter, numprBefore, 'numPr count preserved (bullets stay list items)');
  // block 1 untouched
  for (const t of block1) assert.ok(out.includes(t), `block 1 bullet preserved: ${t}`);
  ok('reorders a group, preserves list formatting, leaves other roles untouched');
}

// ---- replace with fewer bullets → count guard blocks ----------------------
{
  const report = [];
  rewriteBulletGroups(xml, groups, { g1: ['only one bullet now'] }, report, { allowLengthDrift: false });
  const r = report.find((x) => x.group === 'g1');
  assert.ok(r.countChanged && r.blocker, 'dropping a bullet on a page-break-sensitive role blocks');
  ok('count change on a page-break-sensitive role is a blocker');
}

// ---- same change with --allow-length-drift → not blocked ------------------
{
  const report = [];
  const out = rewriteBulletGroups(xml, groups, { g1: ['only one bullet now'] }, report, { allowLengthDrift: true });
  const r = report.find((x) => x.group === 'g1');
  assert.ok(r.countChanged && !r.blocker, 'allow-length-drift clears the blocker');
  assert.ok(out.includes('only one bullet now'), 'new bullet written');
  assert.ok(!out.includes('Delta two DDDD'), 'dropped bullet removed');
  ok('allow-length-drift permits a curated (shorter) bullet set');
}

// ---- unknown ordinal → error, blocker -------------------------------------
{
  const report = [];
  rewriteBulletGroups(xml, groups, { g9: ['x'] }, report, { allowLengthDrift: false });
  const r = report.find((x) => x.group === 'g9');
  assert.ok(r && r.error && r.blocker, 'unknown group errors and blocks');
  ok('unknown bullet group is an error');
}

// ---- empty array → refuse to wipe a role ----------------------------------
{
  const report = [];
  const out = rewriteBulletGroups(xml, groups, { g0: [] }, report, { allowLengthDrift: false });
  const r = report.find((x) => x.group === 'g0');
  assert.ok(r.error && r.blocker, 'empty bullet array refused');
  assert.ok(out.includes('First bullet text AAAA'), 'original bullets untouched when refused');
  ok('refuses to delete every bullet in a role');
}

// ---- replaceParagraphText keeps numPr + rPr, swaps text -------------------
{
  const one = replaceParagraphText(listPara('Original'), 'Replaced <text> & more');
  assert.ok(one.includes('<w:numPr'), 'numPr preserved');
  assert.ok(one.includes('<w:sz w:val="20"/>'), 'run properties preserved');
  assert.ok(one.includes('Replaced &lt;text&gt; &amp; more'), 'text XML-escaped');
  assert.ok(!one.includes('Original'), 'old text gone');
  ok('replaceParagraphText preserves list + run formatting and escapes text');
}

console.log(`\n docx-bullets: ${n} checks passed`);
