/**
 * Tests for employer-status module.
 */

import { classifyStatusSignal, proposeStatusFromMessage, findStatusMismatches, confirmMismatch } from '../lib/employer-status.mjs';

let passes = 0;
let failures = 0;

function check(cond, msg) {
  if (cond) {
    passes += 1;
    console.log(`✓ ${msg}`);
  } else {
    failures += 1;
    console.log(`✗ ${msg}`);
  }
}

// classifyStatusSignal tests

// from_employer: rejection cases
check(
  classifyStatusSignal({ direction: 'from_employer', subject: 'we will not be moving forward with your application', body: '' }) === 'rejection',
  'from_employer: "we will not be moving forward with your application" gives rejection'
);

check(
  classifyStatusSignal({ direction: 'from_employer', subject: 'the position has been filled', body: '' }) === 'rejection',
  'from_employer: "the position has been filled" gives rejection'
);

check(
  classifyStatusSignal({ direction: 'from_employer', subject: 'unfortunately we have decided to move forward with other candidates', body: '' }) === 'rejection',
  'from_employer: "unfortunately we have decided to move forward with other candidates" gives rejection'
);

// from_employer: human reply
check(
  classifyStatusSignal({ direction: 'from_employer', subject: 'thanks for your time, let us know a good time to talk', body: '' }) === 'human_reply',
  'from_employer: "thanks for your time, let us know a good time to talk" gives human_reply'
);

// from_employer: auto replies give none
check(
  classifyStatusSignal({ direction: 'from_employer', subject: 'Automatic reply: out of office', body: 'I am out of office' }) === 'none',
  'from_employer: subject "Automatic reply: out of office" with out-of-office body gives none'
);

check(
  classifyStatusSignal({ direction: 'from_employer', subject: 'Your feedback survey', body: '' }) === 'none',
  'from_employer: subject "Your feedback survey" gives none'
);

// from_employer: invalid direction
check(
  classifyStatusSignal({ direction: 'sideways', subject: '', body: '' }) === 'none',
  'from_employer: direction "sideways" gives none'
);

// from_owner: withdrawal cases
check(
  classifyStatusSignal({ direction: 'from_owner', subject: 'I am withdrawing my application', body: '' }) === 'withdrawal',
  'from_owner: "I am withdrawing my application" gives withdrawal'
);

check(
  classifyStatusSignal({ direction: 'from_owner', subject: 'please withdraw my candidacy', body: '' }) === 'withdrawal',
  'from_owner: "please withdraw my candidacy" gives withdrawal'
);

// from_owner: none
check(
  classifyStatusSignal({ direction: 'from_owner', subject: 'thanks for the update', body: '' }) === 'none',
  'from_owner: "thanks for the update" gives none'
);

// proposeStatusFromMessage tests

// rejection
const rejectionMsg = {
  message_id: 'msg-900001',
  direction: 'from_employer',
  subject: 'we will not be moving forward with your application',
  body: '',
  sent_on: '2030-03-18'
};

const rejectionResult = proposeStatusFromMessage(rejectionMsg);
check(
  rejectionResult &&
    rejectionResult.status === 'Rejected' &&
    rejectionResult.dated_on === '2030-03-18' &&
    rejectionResult.evidence_ref === 'msg-900001',
  'proposeStatusFromMessage: rejection dated 2030-03-18 with message_id msg-900001'
);

// owner withdrawal
const withdrawalMsg = {
  message_id: 'msg-900002',
  direction: 'from_owner',
  subject: 'I am withdrawing my application',
  body: '',
  sent_on: '2030-03-10'
};

const withdrawalResult = proposeStatusFromMessage(withdrawalMsg);
check(
  withdrawalResult &&
    withdrawalResult.status === 'Passed' &&
    withdrawalResult.dated_on === '2030-03-10' &&
    withdrawalResult.evidence_ref === 'msg-900002',
  'proposeStatusFromMessage: owner withdrawal gives status Passed'
);

// human reply gives null
const humanReplyMsg = {
  message_id: 'msg-900003',
  direction: 'from_employer',
  subject: 'thanks for your time',
  body: '',
  sent_on: '2030-03-05'
};

check(
  proposeStatusFromMessage(humanReplyMsg) === null,
  'proposeStatusFromMessage: human reply gives null'
);

// rejection with invalid sent_on throws TypeError
try {
  proposeStatusFromMessage({
    message_id: 'msg-900004',
    direction: 'from_employer',
    subject: 'we will not be moving forward',
    body: '',
    sent_on: '2030-02-30'
  });
  check(false, 'proposeStatusFromMessage: rejection with sent_on 2030-02-30 throws TypeError');
} catch (e) {
  check(e instanceof TypeError, 'proposeStatusFromMessage: rejection with sent_on 2030-02-30 throws TypeError');
}

// rejection with empty message_id throws TypeError
try {
  proposeStatusFromMessage({
    message_id: '',
    direction: 'from_employer',
    subject: 'we will not be moving forward',
    body: '',
    sent_on: '2030-03-18'
  });
  check(false, 'proposeStatusFromMessage: rejection with empty message_id throws TypeError');
} catch (e) {
  check(e instanceof TypeError, 'proposeStatusFromMessage: rejection with empty message_id throws TypeError');
}

// findStatusMismatches tests

// rejection after no response
const app1 = {
  id: 900101,
  status: 'No Response',
  messages: [
    { message_id: 'msg-900003', direction: 'from_owner', subject: 'application sent', body: '', sent_on: '2030-03-01' },
    { message_id: 'msg-900002', direction: 'from_employer', subject: 'we will not be moving forward', body: '', sent_on: '2030-03-11' }
  ]
};

const mismatches1 = findStatusMismatches([app1]);
check(
  mismatches1.length === 1 &&
    mismatches1[0].application_id === 900101 &&
    mismatches1[0].type === 'rejection_after_no_response' &&
    mismatches1[0].message_id === 'msg-900002' &&
    mismatches1[0].dated_on === '2030-03-11' &&
    mismatches1[0].proposed.status === 'Rejected' &&
    mismatches1[0].proposed.dated_on === '2030-03-11',
  'findStatusMismatches: rejection after no response yields one mismatch'
);

// Applied status yields no mismatch
const app2 = {
  id: 900102,
  status: 'Applied',
  messages: [
    { message_id: 'msg-900004', direction: 'from_employer', subject: 'we will not be moving forward', body: '', sent_on: '2030-03-11' }
  ]
};

const mismatches2 = findStatusMismatches([app2]);
check(
  mismatches2.length === 0,
  'findStatusMismatches: Applied status yields no mismatch'
);

// human reply after no response
const app3 = {
  id: 900103,
  status: 'No Response',
  messages: [
    { message_id: 'msg-900005', direction: 'from_employer', subject: 'thanks for your time', body: '', sent_on: '2030-03-05' }
  ]
};

const mismatches3 = findStatusMismatches([app3]);
check(
  mismatches3.length === 1 &&
    mismatches3[0].application_id === 900103 &&
    mismatches3[0].type === 'reply_after_no_response' &&
    mismatches3[0].message_id === 'msg-900005' &&
    mismatches3[0].dated_on === '2030-03-05' &&
    mismatches3[0].proposed === null,
  'findStatusMismatches: human reply after no response yields reply mismatch with proposed null'
);

// rejection wins over earlier human reply
const app4 = {
  id: 900104,
  status: 'No Response',
  messages: [
    { message_id: 'msg-900006', direction: 'from_employer', subject: 'thanks for your time', body: '', sent_on: '2030-03-05' },
    { message_id: 'msg-900007', direction: 'from_employer', subject: 'we will not be moving forward', body: '', sent_on: '2030-03-11' }
  ]
};

const mismatches4 = findStatusMismatches([app4]);
check(
  mismatches4.length === 1 &&
    mismatches4[0].type === 'rejection_after_no_response',
  'findStatusMismatches: rejection wins over earlier human reply'
);

// auto reply yields nothing
const app5 = {
  id: 900105,
  status: 'No Response',
  messages: [
    { message_id: 'msg-900008', direction: 'from_employer', subject: 'Automatic reply: out of office', body: 'I am out', sent_on: '2030-03-05' }
  ]
};

const mismatches5 = findStatusMismatches([app5]);
check(
  mismatches5.length === 0,
  'findStatusMismatches: auto reply yields nothing'
);

// owner message alone yields nothing
const app6 = {
  id: 900106,
  status: 'No Response',
  messages: [
    { message_id: 'msg-900009', direction: 'from_owner', subject: 'application sent', body: '', sent_on: '2030-03-01' }
  ]
};

const mismatches6 = findStatusMismatches([app6]);
check(
  mismatches6.length === 0,
  'findStatusMismatches: owner message alone yields nothing'
);

// confirmMismatch tests

// not confirmed returns null
check(
  confirmMismatch(mismatches1[0], { confirmed: false }) === null,
  'confirmMismatch: not confirmed (false) returns null'
);

check(
  confirmMismatch(mismatches1[0], { confirmed: 'yes' }) === null,
  'confirmMismatch: not confirmed ("yes") returns null'
);

// confirmed true on rejection mismatch
const confirmed1 = confirmMismatch(mismatches1[0], { confirmed: true });
check(
  confirmed1 &&
    confirmed1.application_id === 900101 &&
    confirmed1.status === 'Rejected' &&
    confirmed1.occurred_on === '2030-03-11' &&
    confirmed1.evidence_ref === 'msg-900002' &&
    confirmed1.reason === 'employer_rejection_after_no_response',
  'confirmMismatch: confirmed true on rejection mismatch returns correct object'
);

// confirmed true on reply mismatch throws
try {
  confirmMismatch(mismatches3[0], { confirmed: true });
  check(false, 'confirmMismatch: confirmed true on reply mismatch throws Error');
} catch (e) {
  check(e.message === 'no proposal to confirm', 'confirmMismatch: confirmed true on reply mismatch throws Error with correct message');
}

check(classifyStatusSignal({ direction: 'from_employer', subject: 'Update', body: 'the role has been closed' }) === 'rejection', 'a closed role is a rejection');
check(classifyStatusSignal({ direction: 'from_employer', subject: 'Update', body: 'we regret to inform you of our decision' }) === 'rejection', 'regret to inform you is a rejection');
check(classifyStatusSignal({ direction: 'from_owner', subject: 'Update', body: 'I am no longer interested in this role' }) === 'withdrawal', 'no longer interested is a withdrawal');
check(classifyStatusSignal({ direction: 'from_owner', subject: 'Update', body: 'I no longer wish to pursue this' }) === 'withdrawal', 'no longer wish to pursue is a withdrawal');

const withdrawal = { message_id: 'msg-900010', direction: 'from_owner', subject: 'Update', body: 'please withdraw my candidacy', sent_on: '2030-03-12' };
let threwDate = false;
try { proposeStatusFromMessage({ ...withdrawal, sent_on: '2030-02-30' }); } catch (e) { threwDate = e instanceof TypeError; }
check(threwDate, 'a withdrawal with a bad sent_on throws a TypeError');
let threwId = false;
try { proposeStatusFromMessage({ ...withdrawal, message_id: '' }); } catch (e) { threwId = e instanceof TypeError; }
check(threwId, 'a withdrawal with an empty message_id throws a TypeError');
check(proposeStatusFromMessage({ message_id: '', direction: 'from_owner', subject: 'Hello', body: 'thanks for the update', sent_on: '2030-02-30' }) === null, 'a message with no status signal returns null even with bad fields');

const tie = findStatusMismatches([{
  id: 900110,
  status: 'No Response',
  messages: [
    { message_id: 'msg-900021', direction: 'from_employer', subject: 'Update', body: 'we regret to inform you of our decision', sent_on: '2030-03-11' },
    { message_id: 'msg-900020', direction: 'from_employer', subject: 'Update', body: 'the position has been filled', sent_on: '2030-03-11' }
  ]
}]);
check(tie.length === 1 && tie[0].message_id === 'msg-900020', 'same-day messages are ordered by message_id');

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
