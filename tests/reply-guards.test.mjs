// E-3: the reply attachment guard. Pure rules on invented messages.
import { classifyReplyAutomation, evaluateReplyAttachment } from '../lib/reply-guards.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const human = { date: '2030-03-10T15:00:00Z', subject: 'Example Cog Lead next steps', body: 'Can we talk Thursday?' };

check(classifyReplyAutomation({ subject: 'Thank you for applying to Zorblax Widgetry', body: '' }) === 'receipt', 'a thank you for applying subject is a receipt');
check(classifyReplyAutomation({ subject: 'Security code for your application to Quennox Ratchet Works', body: '' }) === 'receipt', 'a security code subject is a receipt');
check(classifyReplyAutomation({ subject: 'Out of office', body: 'I am away and will reply when I return. Automatic reply.' }) === 'out_of_office', 'an out of office reply is out_of_office');
check(classifyReplyAutomation({ subject: 'How was your interview? Feedback survey', body: '' }) === 'feedback_survey', 'a survey is a feedback_survey');
check(classifyReplyAutomation(human) === 'human', 'a person writing about next steps is human');

let v = evaluateReplyAttachment({ message: human, apply_date: '2030-03-01', candidate_count: 1 });
check(v.allowed && v.reason === null && v.warnings.length === 0, 'one fitting application and a human message attach with no question');

v = evaluateReplyAttachment({ message: human, apply_date: '2030-03-01', candidate_count: 2 });
check(!v.allowed && v.reason === 'pick_required', 'two fitting applications need an explicit pick');
v = evaluateReplyAttachment({ message: human, apply_date: '2030-03-01', candidate_count: 2, pick_confirmed: true });
check(v.allowed, 'an explicit pick among several attaches');

v = evaluateReplyAttachment({ message: { ...human, date: '2030-02-20T09:00:00Z' }, apply_date: '2030-03-01', candidate_count: 1 });
check(!v.allowed && v.reason === 'needs_acknowledgement' && v.warnings[0].type === 'older_than_application' && v.warnings[0].message_on === '2030-02-20', 'a message older than the application is held for an acknowledgement');
v = evaluateReplyAttachment({ message: { ...human, date: '2030-02-20T09:00:00Z' }, apply_date: '2030-03-01', candidate_count: 1, acknowledged: true });
check(v.allowed && v.warnings.length === 1, 'acknowledged, it attaches and the warning is still reported');

v = evaluateReplyAttachment({ message: { date: '2030-03-10', subject: 'Thank you for applying', body: '' }, apply_date: '2030-03-01', candidate_count: 1 });
check(!v.allowed && v.reason === 'needs_acknowledgement' && v.warnings[0].type === 'automated' && v.warnings[0].kind === 'receipt', 'an automated receipt is held for an acknowledgement');

v = evaluateReplyAttachment({ message: human, apply_date: '2030-03-01', candidate_count: 1, already_attached_to: 900002 });
check(!v.allowed && v.reason === 'already_attached' && v.attached_to === 900002, 'a message already attached elsewhere is refused');
v = evaluateReplyAttachment({ message: human, apply_date: '2030-03-01', candidate_count: 2, already_attached_to: 900002, pick_confirmed: true, acknowledged: true });
check(v.reason === 'already_attached', 'already attached is refused even with a pick and an acknowledgement');

v = evaluateReplyAttachment({ message: { ...human, date: 'not a date' }, apply_date: '2030-03-01', candidate_count: 1 });
check(v.allowed, 'an unreadable message date is not held (nothing to compare)');
v = evaluateReplyAttachment({ message: human, apply_date: null, candidate_count: 1 });
check(v.allowed, 'no apply date on file is not held');
v = evaluateReplyAttachment({});
check(v.allowed, 'no input never throws');

console.log(`reply-guards: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
