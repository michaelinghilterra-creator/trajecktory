#!/usr/bin/env node

const { heldBackBounceIds } = await import('../dashboard-web/server/lib/google.mjs');

let passed = 0, failed = 0;
const check = (cond, msg) => {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
};

console.log('bounce-cursor.test.mjs');

const isFlippable = (flip) => [10, 11, 12].includes(flip.id);
const hardBounce = (msgId, id) => ({
  msgId,
  kind: 'hard',
  address: `${id}@example.com`,
  contact: { source: 'ta', id },
  flip: { source: 'ta', id, state: 'bounced' },
});

const unconfirmed = heldBackBounceIds([hardBounce('m1', 10)], {
  confirmSet: new Set(), isFlippable,
});
check(unconfirmed.has('m1'), 'unconfirmed flippable hard bounce is held back');

const confirmed = heldBackBounceIds([hardBounce('m2', 10)], {
  confirmSet: new Set(['ta:10']), isFlippable,
});
check(!confirmed.has('m2'), 'confirmed flippable hard bounce is not held back');

const soft = heldBackBounceIds([{
  msgId: 'm3', kind: 'soft', address: 'soft@example.com', contact: null, flip: null,
}], { confirmSet: new Set(), isFlippable });
check(!soft.has('m3'), 'soft bounce is not held back');

const notFlippable = heldBackBounceIds([hardBounce('m4', 99)], {
  confirmSet: new Set(), isFlippable,
});
check(!notFlippable.has('m4'), 'non-flippable hard bounce is not held back');

const reported = heldBackBounceIds([
  hardBounce('mA', 10),
  hardBounce('mB', 11),
], { confirmSet: new Set(['ta:10']), isFlippable });
check(!reported.has('mA'), 'confirmed message in a multi-bounce sweep advances');
check(reported.has('mB'), 'another unconfirmed message in the same sweep stays unseen');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
