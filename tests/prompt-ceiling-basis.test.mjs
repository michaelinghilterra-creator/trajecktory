import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CEILING_BASES } from '../verify-ceiling-basis.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// Every prompt that lets an evaluator set scoreCeiling must also tell it the closed set of
// ceilingBasis values. The batch prompt used to show scoreCeiling with no ceilingBasis at all,
// so batch workers invented "fit", which verify-ceiling-basis.mjs rejects.
const PROMPTS = ['batch/batch-prompt.md', 'modes/oferta.md', 'lib/spark-eval.mjs'];

for (const rel of PROMPTS) {
  test(`${rel} names ceilingBasis and every allowed value`, () => {
    const text = read(rel);
    assert.match(text, /ceilingBasis/);
    const lower = text.toLowerCase();
    for (const basis of CEILING_BASES) {
      assert.ok(lower.includes(`"${basis}"`), `${rel} does not list "${basis}"`);
    }
  });
}

test('the batch prompt schema block declares ceilingBasis next to scoreCeiling', () => {
  const text = read('batch/batch-prompt.md');
  const schema = text.slice(text.indexOf('"scoreCeiling"'), text.indexOf('"northStarArchetype"'));
  assert.match(schema, /"ceilingBasis"/);
  assert.match(schema, /"ceilingReason"/);
});

test('the batch prompt does not offer fit as a ceilingBasis', () => {
  const text = read('batch/batch-prompt.md');
  assert.doesNotMatch(text, /ceilingBasis"?\s*[:=]\s*"fit"/i);
  assert.match(text, /"fit" is NOT a valid basis/);
});
