// E-7: the exclusion rules on invented event lists. No files, no store.
import { reviewItemKey, buildReviewItemExcludedEvent, reviewResolutionsFromEvents, REVIEW_ITEM_KINDS } from '../lib/review-resolutions.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

check(reviewItemKey('unconfirmed_interview', { application_id: 900001, stage: 'Phone Screen' }) === 'interview|900001|phone screen', 'an interview key is app id and lowercase stage');
check(reviewItemKey('scheduled', { application_id: 900001, stage: 'Phone Screen' }) === reviewItemKey('unconfirmed_interview', { application_id: 900001, stage: 'Phone Screen' }), 'scheduled and unconfirmed share the same key for the same round, since it is the same interview line');
check(reviewItemKey('scheduled', { application_id: 900001, stage: '  1st  Interview  ' }) === 'interview|900001|1st interview', 'stage spacing is normalized');
check(reviewItemKey('newer_message', { application_id: 900002, message_id: 'm900001' }) === 'newer_message|900002|m900001', 'a newer-message key includes the message id');
check(reviewItemKey('unmatched_reply', { application_id: 900002, message_id: 'm900001' }) === 'unmatched_reply|900002|m900001', 'an unmatched-reply key includes the message id');
let threw = false;
try { reviewItemKey('bogus', {}); } catch { threw = true; }
check(threw, 'an unknown kind is refused');

let ev = buildReviewItemExcludedEvent({ application_id: 900002, item_kind: 'unmatched_reply', item_key: 'unmatched_reply|900002|m900001', reason: '  Waiting on the employer to clarify.  ', occurred_on: '2030-03-10' });
check(ev.type === 'review_item_excluded' && ev.payload.reason === 'Waiting on the employer to clarify.' && ev.source === 'dashboard', 'the event trims the reason and is dashboard sourced');
for (const bad of [{}, { application_id: 1, item_kind: 'bogus', item_key: 'x', reason: 'y' }, { application_id: 1, item_kind: 'scheduled', item_key: '', reason: 'y' }, { application_id: 1, item_kind: 'scheduled', item_key: 'x', reason: '' }, { application_id: 1, item_kind: 'scheduled', item_key: 'x', reason: '   ' }, { item_kind: 'scheduled', item_key: 'x', reason: 'y' }]) {
  threw = false;
  try { buildReviewItemExcludedEvent(bad); } catch { threw = true; }
  check(threw, `refuses ${JSON.stringify(bad)}`);
}

let id = 1;
const ev2 = (over) => ({ id: id++, type: 'review_item_excluded', occurred_on: '2030-03-10', payload: {}, ...over });
let map = reviewResolutionsFromEvents([ev2({ payload: { item_kind: 'scheduled', item_key: 'interview|900001|phone screen', reason: 'Traveling that week.' } })]);
check(map.get('interview|900001|phone screen').reason === 'Traveling that week.' && map.get('interview|900001|phone screen').item_kind === 'scheduled', 'one exclusion is readable back by key');
check(map.get('nope') === undefined, 'an unexcluded key has nothing');

// Newest wins.
map = reviewResolutionsFromEvents([
  ev2({ payload: { item_kind: 'unmatched_reply', item_key: 'unmatched_reply|900002|m900001', reason: 'First reason.' } }),
  ev2({ payload: { item_kind: 'unmatched_reply', item_key: 'unmatched_reply|900002|m900001', reason: 'Second reason.' } }),
]);
check(map.get('unmatched_reply|900002|m900001').reason === 'Second reason.', 'the newest exclusion for a key wins');

// A void clears an exclusion.
const target = ev2({ payload: { item_kind: 'newer_message', item_key: 'newer_message|900003|m900002', reason: 'Known, ignoring for now.' } });
const undone = { id: id++, type: 'event_undone', occurred_on: '2030-03-11', corrects_event_id: target.id, payload: { reason_code: 'undone_by_owner', actor: 'owner' } };
map = reviewResolutionsFromEvents([target, undone]);
check(map.size === 0, 'voiding the exclusion event removes it');

check(REVIEW_ITEM_KINDS.length === 4 && REVIEW_ITEM_KINDS.includes('unconfirmed_interview') && REVIEW_ITEM_KINDS.includes('scheduled') && REVIEW_ITEM_KINDS.includes('newer_message') && REVIEW_ITEM_KINDS.includes('unmatched_reply'), 'the four weekly-review categories are exactly the four exclusion kinds');

console.log(`review-resolutions: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
