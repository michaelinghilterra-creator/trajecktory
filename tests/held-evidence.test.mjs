/**
 * Tests for held-evidence module.
 */

import { evaluateHeldEvidence, classifyEmployerMessage, EVIDENCE_KINDS } from '../lib/held-evidence.mjs';

const slot_end = '2030-03-08T19:00:00.000Z';

function check(cond, msg) {
  if (cond) {
    console.log('✓ ' + msg);
  } else {
    console.log('✗ ' + msg);
    process.exit(1);
  }
}

// Test EVIDENCE_KINDS
check(EVIDENCE_KINDS.length === 10, 'EVIDENCE_KINDS has 10 items');
check(EVIDENCE_KINDS.includes('owner_message'), 'EVIDENCE_KINDS includes owner_message');
check(EVIDENCE_KINDS.includes('employer_message'), 'EVIDENCE_KINDS includes employer_message');
check(EVIDENCE_KINDS.includes('owner_confirmation'), 'EVIDENCE_KINDS includes owner_confirmation');
check(EVIDENCE_KINDS.includes('calendar_event'), 'EVIDENCE_KINDS includes calendar_event');
check(EVIDENCE_KINDS.includes('invitation'), 'EVIDENCE_KINDS includes invitation');
check(EVIDENCE_KINDS.includes('reminder'), 'EVIDENCE_KINDS includes reminder');
check(EVIDENCE_KINDS.includes('scheduling_confirmation'), 'EVIDENCE_KINDS includes scheduling_confirmation');
check(EVIDENCE_KINDS.includes('feedback_survey'), 'EVIDENCE_KINDS includes feedback_survey');
check(EVIDENCE_KINDS.includes('out_of_office'), 'EVIDENCE_KINDS includes out_of_office');
check(EVIDENCE_KINDS.includes('debrief'), 'EVIDENCE_KINDS includes debrief');

// Test classifyEmployerMessage
check(classifyEmployerMessage({ subject: 'Interview reminder', body: 'Reminder about your interview' }) === 'reminder', 'classifyEmployerMessage returns reminder');
check(classifyEmployerMessage({ subject: 'Interview confirmed for Example Personone', body: 'Your interview has been scheduled' }) === 'scheduling_confirmation', 'classifyEmployerMessage returns scheduling_confirmation');
check(classifyEmployerMessage({ subject: 'Your feedback survey', body: 'Please complete our feedback survey' }) === 'feedback_survey', 'classifyEmployerMessage returns feedback_survey');
check(classifyEmployerMessage({ subject: 'Invitation to schedule a call', body: 'Please select a time' }) === 'invitation', 'classifyEmployerMessage returns invitation');
check(classifyEmployerMessage({ subject: 'Automatic reply: out of office', body: 'I am currently out of the office' }) === 'out_of_office', 'classifyEmployerMessage returns out_of_office');
check(classifyEmployerMessage({ subject: 'Thanks for speaking with us', body: 'The team enjoyed the conversation' }) === 'human', 'classifyEmployerMessage returns human');

// Test evaluateHeldEvidence with qualifying items
const qualifyingItems = [
  { kind: 'owner_message', at: '2030-03-08T20:15:00.000Z', refers_to_conversation: true },
  { kind: 'employer_message', at: '2030-03-09T14:00:00.000Z', refers_to_conversation: true },
  { kind: 'owner_confirmation', confirmed_on: '2030-03-09' }
];
const result1 = evaluateHeldEvidence({ slot_end, items: qualifyingItems });
check(result1.held === true, 'held is true with qualifying items');
check(result1.qualifying.length === 3, 'qualifying has 3 items');
check(result1.rejected.length === 0, 'rejected is empty with qualifying items');

// Test non-evidence kinds
const nonEvidenceItems = [
  { kind: 'calendar_event', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'invitation', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'reminder', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'scheduling_confirmation', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'feedback_survey', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'out_of_office', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'debrief', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true }
];
const result2 = evaluateHeldEvidence({ slot_end, items: nonEvidenceItems });
check(result2.held === false, 'held is false with non-evidence kinds');
check(result2.qualifying.length === 0, 'qualifying is empty with non-evidence kinds');
check(result2.rejected.length === 7, 'rejected has 7 items with non-evidence kinds');
for (const r of result2.rejected) {
  check(r.reason === 'not_evidence_kind', `rejected item has reason not_evidence_kind`);
}

// Test before_or_at_slot_end
const beforeItems = [
  { kind: 'owner_message', at: '2030-03-08T18:59:00.000Z', refers_to_conversation: true }
];
const result3 = evaluateHeldEvidence({ slot_end, items: beforeItems });
check(result3.held === false, 'held is false for before slot_end');
check(result3.rejected.length === 1, 'rejected has 1 item for before slot_end');
check(result3.rejected[0].reason === 'before_or_at_slot_end', 'rejected reason is before_or_at_slot_end');

// Test at exactly slot_end
const atItems = [
  { kind: 'owner_message', at: '2030-03-08T19:00:00.000Z', refers_to_conversation: true }
];
const result4 = evaluateHeldEvidence({ slot_end, items: atItems });
check(result4.held === false, 'held is false for at slot_end');
check(result4.rejected[0].reason === 'before_or_at_slot_end', 'rejected reason is before_or_at_slot_end for at slot_end');

// Test does_not_refer
const notReferItems = [
  { kind: 'owner_message', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: false }
];
const result5 = evaluateHeldEvidence({ slot_end, items: notReferItems });
check(result5.held === false, 'held is false for does_not_refer');
check(result5.rejected[0].reason === 'does_not_refer', 'rejected reason is does_not_refer');

// Test bad_confirmation
const badConfirmationItems = [
  { kind: 'owner_confirmation', confirmed_on: '2030-02-30' }
];
const result6 = evaluateHeldEvidence({ slot_end, items: badConfirmationItems });
check(result6.held === false, 'held is false for bad_confirmation');
check(result6.rejected[0].reason === 'bad_confirmation', 'rejected reason is bad_confirmation');

// Test debrief plus feedback_survey together
const debriefFeedbackItems = [
  { kind: 'debrief', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'feedback_survey', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true }
];
const result7 = evaluateHeldEvidence({ slot_end, items: debriefFeedbackItems });
check(result7.held === false, 'held is false with debrief and feedback_survey only');
check(result7.qualifying.length === 0, 'qualifying is empty with debrief and feedback_survey only');

// Test adding one qualifying item
const withQualifying = [
  { kind: 'debrief', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'feedback_survey', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'owner_message', at: '2030-03-08T20:15:00.000Z', refers_to_conversation: true }
];
const result8 = evaluateHeldEvidence({ slot_end, items: withQualifying });
check(result8.held === true, 'held is true with one qualifying item');
check(result8.qualifying.length === 1, 'qualifying has length 1');

// Test bad_timestamp
const badTimestampItems = [
  { kind: 'owner_message', at: 'not-a-date', refers_to_conversation: true }
];
const result9 = evaluateHeldEvidence({ slot_end, items: badTimestampItems });
check(result9.held === false, 'held is false for bad_timestamp');
check(result9.rejected[0].reason === 'bad_timestamp', 'rejected reason is bad_timestamp');

// Test unknown kind, employer_message bad_timestamp, malformed confirmation
const extraItems = [
  { kind: 'carrier_pigeon', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
  { kind: 'employer_message', at: 'not-a-date', refers_to_conversation: true },
  { kind: 'owner_confirmation', confirmed_on: '2030-3-9' }
];
const result10 = evaluateHeldEvidence({ slot_end, items: extraItems });
check(result10.held === false, 'held is false for unknown kind, bad employer timestamp and malformed confirmation');
check(result10.rejected[0].reason === 'unknown_kind', 'rejected reason is unknown_kind');
check(result10.rejected[1].reason === 'bad_timestamp', 'employer_message bad_timestamp is rejected');
check(result10.rejected[2].reason === 'bad_confirmation', 'malformed confirmed_on is rejected as bad_confirmation');

// Test TypeError for invalid slot_end
try {
  evaluateHeldEvidence({ slot_end: 'invalid-date', items: [] });
  check(false, 'should throw TypeError for invalid slot_end');
} catch (e) {
  check(e instanceof TypeError, 'throws TypeError for invalid slot_end');
}

console.log('All tests passed.');
