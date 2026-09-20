// E-5: plain words for a status guard verdict. Invented fixtures only.
import { dialogFor } from '../lib/status-guard-dialog.mjs';
import { evaluateStatusChange } from '../lib/status-guards.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const CO = 'Zorblax Widgetry';
const held = [{ message_id: 'm900001', sent_on: '2030-03-05', subject: 'Example Cog Lead update' }];
const two = [...held, { message_id: 'm900002', sent_on: '2030-03-06', subject: 'Second note' }];

let d = dialogFor({ allowed: true, reason: null }, CO);
check(d.kind === 'proceed' && d.text === '' && d.needsDate === false, 'an allowed verdict needs nothing');

d = dialogFor({ allowed: false, reason: 'no_employer_evidence', show_first: [] }, CO);
check(d.kind === 'ask_phone_date' && d.needsDate === true && d.text === 'No rejection from Zorblax Widgetry is on record. If they told you no by phone, enter the date as YYYY-MM-DD. Otherwise cancel.', 'no evidence asks for a phone date, naming the company');

d = dialogFor({ allowed: false, reason: 'no_employer_evidence', show_first: held }, CO);
check(d.text.endsWith(' Read the 1 message from them first.'), 'one message to read is said in the singular');
d = dialogFor({ allowed: false, reason: 'no_employer_evidence', show_first: two }, CO);
check(d.text.endsWith(' Read the 2 messages from them first.'), 'two messages to read are said in the plural');
d = dialogFor({ allowed: false, reason: 'no_employer_evidence' }, CO);
check(d.kind === 'ask_phone_date' && !d.text.includes('Read the'), 'a missing show_first list is not an error');

d = dialogFor({ allowed: false, reason: 'future_phone_date' }, CO);
check(d.kind === 'ask_phone_date' && d.needsDate === true && d.text.startsWith('That date is in the future.'), 'a future date asks again');
d = dialogFor({ allowed: false, reason: 'invalid_phone_date' }, CO);
check(d.kind === 'ask_phone_date' && d.needsDate === true && d.text.startsWith('That is not a real date.'), 'a bad date asks again');

d = dialogFor({ allowed: false, reason: 'employer_message_exists', show_first: two }, CO);
check(d.kind === 'read_first' && d.needsDate === false && d.text === 'Zorblax Widgetry has written since you applied. Read it before you mark No Response:\n2030-03-05 Example Cog Lead update\n2030-03-06 Second note', 'an existing employer message is listed, oldest first as given');
d = dialogFor({ allowed: false, reason: 'employer_message_exists' }, CO);
check(d.kind === 'read_first' && d.text.endsWith('mark No Response:'), 'a missing message list is not an error');
d = dialogFor({ allowed: false, reason: 'employer_message_exists', show_first: [{ sent_on: '2030-03-05' }] }, CO);
check(d.text.endsWith('\n2030-03-05'), 'a message with no subject is listed by its date');

d = dialogFor({ allowed: false, reason: 'must_be_set_by_hand' }, CO);
check(d.kind === 'confirm_by_hand' && d.text === 'Mark Zorblax Widgetry as No Response yourself?' && d.needsDate === false, 'the by hand confirmation names the company');

d = dialogFor({ allowed: false, reason: 'withdrawal_is_not_rejection', suggest: 'Discarded' }, CO);
check(d.kind === 'use_other' && d.text === 'Use Discarded instead.', 'a withdrawal is redirected to the suggested status');
d = dialogFor({ allowed: false, reason: 'withdrawal_is_not_rejection', suggest: null }, CO);
check(d.kind === 'blocked' && d.needsDate === false, 'a redirect with nothing to suggest is blocked, not "Use null instead"');

d = dialogFor({ allowed: false, reason: 'something_new' }, CO);
check(d.kind === 'blocked' && d.needsDate === false && d.text === 'This change is not allowed.', 'an unknown reason is blocked');
check(dialogFor(undefined, CO).kind === 'blocked' && dialogFor(null, CO).needsDate === false && dialogFor(null, CO).kind === 'blocked', 'a missing verdict is blocked and never throws');
check(dialogFor({ allowed: false, reason: 'must_be_set_by_hand' }).text === 'Mark this employer as No Response yourself?', 'a missing company reads as "this employer"');

// The words match what the guard really returns.
const real = evaluateStatusChange({ to: 'No Response', messages: [{ message_id: 'm900003', sent_on: '2030-03-05', direction: 'from_employer', subject: 'thanks for your time, let us know a good time to talk', body: '' }], applied_on: '2030-03-01', by_hand: true });
d = dialogFor(real, CO);
check(d.kind === 'read_first' && d.text.includes('2030-03-05 thanks for your time'), 'a real guard verdict for No Response is shown with the message');
d = dialogFor(evaluateStatusChange({ to: 'Rejected', messages: [] }), CO);
check(d.kind === 'ask_phone_date', 'a real guard verdict for Rejected asks for a phone date');
d = dialogFor(evaluateStatusChange({ to: 'Rejected', messages: [], withdrawn: true }), CO);
check(d.kind === 'use_other' && d.text === 'Use Discarded instead.', 'a real guard verdict for a withdrawal redirects to Discarded');

console.log(`status-guard-dialog: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
