// E-5: status guards. Rejected needs employer evidence, Passed is always allowed, No Response is only a prompt.
import { evaluateStatusChange, noResponsePrompt } from '../lib/status-guards.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const msg = (id, sentOn, direction, subject, body = '') => ({ message_id: id, sent_on: sentOn, direction, subject, body });
const reject = (id, sentOn) => msg(id, sentOn, 'from_employer', 'we will not be moving forward with your application');
const human = (id, sentOn) => msg(id, sentOn, 'from_employer', 'thanks for your time, let us know a good time to talk');
const receipt = (id, sentOn) => msg(id, sentOn, 'from_employer', 'Confirmation: we received your application');
const ownerMail = (id, sentOn) => msg(id, sentOn, 'from_owner', 'thanks for the update');

// Rejected
let v = evaluateStatusChange({ to: 'Rejected', messages: [reject('m900001', '2030-03-10')], applied_on: '2030-03-01' });
check(v.allowed && v.reason === null && v.dated_on === '2030-03-10' && v.evidence_ref === 'm900001', 'Rejected with an employer rejection is allowed and dated by the message');

v = evaluateStatusChange({ to: 'Rejected', messages: [reject('m900002', '2030-03-12'), reject('m900001', '2030-03-10')], applied_on: '2030-03-01' });
check(v.allowed && v.dated_on === '2030-03-10' && v.evidence_ref === 'm900001', 'with two rejections the earliest one dates the change');

v = evaluateStatusChange({ to: 'Rejected', messages: [reject('m900022', '2030-03-10'), reject('m900021', '2030-03-10')], applied_on: '2030-03-01' });
check(v.allowed && v.evidence_ref === 'm900021', 'two rejections on one day tie break on the message id');

v = evaluateStatusChange({ to: 'Rejected', messages: [], applied_on: '2030-03-01' });
check(!v.allowed && v.reason === 'no_employer_evidence' && v.show_first.length === 0, 'Rejected with no message is blocked');

v = evaluateStatusChange({ to: 'Rejected', messages: [receipt('m900003', '2030-03-02'), ownerMail('m900004', '2030-03-03')], applied_on: '2030-03-01' });
check(!v.allowed && v.reason === 'no_employer_evidence', 'a receipt and a message the person sent are not evidence of a rejection');

v = evaluateStatusChange({ to: 'Rejected', messages: [human('m900005', '2030-03-05')], applied_on: '2030-03-01' });
check(!v.allowed && v.reason === 'no_employer_evidence' && v.show_first.length === 1 && v.show_first[0].message_id === 'm900005', 'a human reply that is not a rejection is not evidence, and it is shown first');

v = evaluateStatusChange({ to: 'Rejected', messages: [reject('m900006', '2030-02-20')], applied_on: '2030-03-01' });
check(!v.allowed && v.reason === 'no_employer_evidence', 'a rejection dated before the application is not evidence');

v = evaluateStatusChange({ to: 'Rejected', messages: [reject('m900007', '2030-03-01')], applied_on: '2030-03-01' });
check(v.allowed, 'a rejection on the apply date counts');

v = evaluateStatusChange({ to: 'Rejected', messages: [reject('m900008', '2030-02-20')] });
check(v.allowed && v.dated_on === '2030-02-20', 'with no apply date on record every message counts');

v = evaluateStatusChange({ to: 'Rejected', messages: [], applied_on: '2030-03-01', phone_rejection_on: '2030-03-09', today: '2030-03-10' });
check(v.allowed && v.dated_on === '2030-03-09' && v.evidence_ref === 'said_no_by_phone', 'a dated "said no by phone" allows Rejected');

v = evaluateStatusChange({ to: 'Rejected', messages: [], phone_rejection_on: '2030-03-10', today: '2030-03-10' });
check(v.allowed && v.dated_on === '2030-03-10', 'a phone rejection dated today is allowed');

v = evaluateStatusChange({ to: 'Rejected', messages: [], phone_rejection_on: '2030-03-11', today: '2030-03-10' });
check(!v.allowed && v.reason === 'future_phone_date', 'a phone rejection dated in the future is blocked');

v = evaluateStatusChange({ to: 'Rejected', messages: [], phone_rejection_on: '2030-02-30' });
check(!v.allowed && v.reason === 'invalid_phone_date', 'a phone rejection with an impossible date is blocked');

v = evaluateStatusChange({ to: 'Rejected', messages: [], phone_rejection_on: 'yesterday' });
check(!v.allowed && v.reason === 'invalid_phone_date', 'a phone rejection with no real date is blocked');

v = evaluateStatusChange({ to: 'Rejected', messages: [reject('m900009', '2030-03-10')], withdrawn: true });
check(!v.allowed && v.reason === 'withdrawal_is_not_rejection' && v.suggest === 'Discarded', 'a withdrawal is not a rejection and is offered as Discarded');

// Passed
v = evaluateStatusChange({ to: 'Passed' });
check(v.allowed && v.reason === null && v.suggest === null, 'Passed is live and allowed');

// No Response
v = evaluateStatusChange({ to: 'No Response', messages: [], applied_on: '2030-03-01' });
check(!v.allowed && v.reason === 'must_be_set_by_hand', 'No Response is never set unless the person chose it');

v = evaluateStatusChange({ to: 'No Response', messages: [], applied_on: '2030-03-01', by_hand: true });
check(v.allowed && v.reason === null, 'No Response by hand with no employer message is allowed');

v = evaluateStatusChange({ to: 'No Response', messages: [receipt('m900010', '2030-03-02')], applied_on: '2030-03-01', by_hand: true });
check(v.allowed, 'a receipt does not stop No Response');

v = evaluateStatusChange({ to: 'No Response', messages: [human('m900011', '2030-03-05')], applied_on: '2030-03-01', by_hand: true });
check(!v.allowed && v.reason === 'employer_message_exists' && v.show_first[0].message_id === 'm900011', 'a human employer message blocks No Response and is shown first');

v = evaluateStatusChange({ to: 'No Response', messages: [reject('m900012', '2030-03-05')], applied_on: '2030-03-01', by_hand: true });
check(!v.allowed && v.reason === 'employer_message_exists', 'a rejection blocks No Response');

v = evaluateStatusChange({ to: 'No Response', messages: [human('m900013', '2030-02-01')], applied_on: '2030-03-01', by_hand: true });
check(v.allowed, 'a message from before the application does not stop No Response');

v = evaluateStatusChange({ to: 'No Response', messages: [], by_hand: 'yes' });
check(!v.allowed && v.reason === 'must_be_set_by_hand', 'by_hand must be exactly true');

// The prompt
let p = noResponsePrompt({ messages: [], applied_on: '2030-03-01' });
check(p.offer === true && p.show_first.length === 0, 'the prompt is offered when no employer message exists');
p = noResponsePrompt({ messages: [human('m900014', '2030-03-06'), human('m900015', '2030-03-04')], applied_on: '2030-03-01' });
check(p.offer === false && p.show_first.map((m) => m.message_id).join() === 'm900015,m900014', 'the prompt is not offered and lists the messages oldest first');
p = noResponsePrompt();
check(p.offer === true, 'the prompt works with no arguments');

// Other statuses pass through
v = evaluateStatusChange({ to: 'Applied' });
check(v.allowed && v.reason === null, 'other statuses are not guarded');
v = evaluateStatusChange({ to: 'Discarded', withdrawn: true });
check(v.allowed, 'Discarded is allowed for a withdrawal');

console.log(`status-guards: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
