#!/usr/bin/env node
/**
 * release-notes.test.mjs — unit tests for the release-note parser behind the
 * Change Log tab and the update banner.
 *
 * Pins three behaviours that each shipped as a visible defect:
 *   1. Items carry a `type`, so a prose paragraph renders as a paragraph. Both
 *      surfaces used to bullet every item, turning hand-written prose into a
 *      wall of one-sentence bullets.
 *   2. cleanNote sentence-cases commit subjects but NOT the brand, which is
 *      lowercase by house rule even sentence-initially. It rendered the brand
 *      capitalised in both surfaces.
 *   3. parseChangelog (routes/setup-modules.mjs) emits the SAME item shape.
 *      It is a second parser feeding the same two components, so a shape change
 *      in one silently breaks the other's render path.
 *
 * Run: node tests/release-notes.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { cleanNote, parseReleaseBody } from '../dashboard-web/server/lib/release-notes.mjs';

let failed = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label}`); failed++; }
};

const BODY = [
  'Maintenance release. Recommended for all installs.',
  '',
  '## Install (Windows)',
  '',
  '**Already installed?** Launch it and accept the prompt.',
  '',
  '## What changed',
  '',
  '### A prose section',
  '',
  'First paragraph, line one.',
  'Still paragraph one after a soft wrap.',
  '',
  'Second paragraph.',
  '',
  '### For contributors',
  '',
  '- a bullet item',
  '- another bullet item',
  '',
].join('\n');

console.log('\nrelease-notes: parseReleaseBody');
const secs = parseReleaseBody(BODY);
const byHeading = Object.fromEntries(secs.map(s => [s.heading, s.items]));

ok(secs.every(s => s.items.every(i => i && typeof i.text === 'string' && /^(prose|bullet)$/.test(i.type))),
  'every item is {type, text}');
ok(!secs.some(s => /install/i.test(s.heading)) && !JSON.stringify(secs).includes('Already installed'),
  'the Install section is skipped, since the reader is already installed');
ok(!secs.some(s => /^what changed$/i.test(s.heading)),
  '"What changed" is a wrapper, not a rendered section');
ok((byHeading['A prose section'] || []).every(i => i.type === 'prose'),
  'prose paragraphs are typed prose');
ok((byHeading['A prose section'] || []).length === 2,
  'a blank line separates paragraphs; a soft wrap does not');
ok((byHeading['A prose section'] || [])[0].text === 'First paragraph, line one. Still paragraph one after a soft wrap.',
  'soft-wrapped lines fold into one paragraph');
ok((byHeading['For contributors'] || []).every(i => i.type === 'bullet'),
  'list items are typed bullet');

console.log('\nrelease-notes: cleanNote');
ok(cleanNote('close the leak') === 'Close the leak',
  'a commit subject is still sentence-cased (the CHANGELOG.md fallback needs it)');
ok(cleanNote('trajecktory keeps a set of files.') === 'trajecktory keeps a set of files.',
  'the brand is NOT capitalised, even sentence-initially');
ok(cleanNote('**bold** and [a link](http://x)') === 'Bold and a link',
  'markdown emphasis and links are stripped');

console.log('\nrelease-notes: the second parser agrees on the shape');
const routes = await import('../dashboard-web/server/routes/setup-modules.mjs')
  .then(() => null).catch(() => null);
// parseChangelog is module-private, so assert on the contract it must honour:
// the file emits {type, text} items and never a bare string.
const src = await import('node:fs').then(fs =>
  fs.readFileSync(new URL('../dashboard-web/server/routes/setup-modules.mjs', import.meta.url), 'utf8'));
ok(!/items\.push\(cleanNote\(/.test(src),
  'parseChangelog does not push bare strings into items[]');
ok(/items\.push\(\{\s*type:/.test(src),
  'parseChangelog pushes {type, ...} items');
void routes;

console.log(`\n${failed ? `🔴 ${failed} failed` : '🟢 All release-notes tests passed'}\n`);
process.exit(failed ? 1 : 0);
