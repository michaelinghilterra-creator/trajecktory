#!/usr/bin/env node
// Tests for receipt, auto-reply and rejection gap rules in inbound-classify.mjs

import { isApplicationReceipt, isAutoReply, isAutomatedRejection } from '../lib/inbound-classify.mjs';
import { classifyForEvent } from '../lib/inbound-events.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
console.log('inbound-classify-gaps.test.mjs');

const AUTO = 'no-reply@example.test';
const PERSON = 'ada.vance@example.test';
const REVIEWING = 'Thank you for your interest. We are carefully reviewing each application.';
const CONDITIONAL = 'Our team will review it. If you have not heard back within four weeks, we regret to inform you that your application has not been successful.';
const FILLED = 'We have filled this role with another qualified applicant.';

// A. Re: prefix veto, isApplicationReceipt
check(isApplicationReceipt({ subject: 'Re: Thank you for applying to Zorblax Widgetry', body: 'Thanks for your follow up.', sentiment: 'neutral', sender: PERSON }) === false, 'A1: Re: prefix veto with human sender returns false');
check(isApplicationReceipt({ subject: 'Thank you for applying to Zorblax Widgetry', body: 'We received it.', sentiment: 'neutral', sender: PERSON }) === true, 'A2: No Re: prefix with human sender returns true');
check(same(classifyForEvent({ subject: 'Re: Thank you for applying to Zorblax Widgetry', body: 'Thanks for your follow up.', sentiment: 'neutral', sender: PERSON }), { kind: 'human', sentiment: 'neutral' }), 'A3: classifyForEvent with Re: prefix returns human');

// B. Out-of-office, isAutoReply
check(isAutoReply({ subject: 'Currently on Vacation Re: Zorblax Widgetry application', body: 'Hello' }) === true, 'B4: Currently on Vacation subject returns true');
check(isAutoReply({ subject: "You’re Catching Me Out of Office! Re: Zorblax Widgetry role", body: '' }) === true, 'B5: Out of Office subject with apostrophe returns true');
check(isAutoReply({ subject: 'Away from my desk Re: Zorblax Widgetry role', body: '' }) === true, 'B6: Away from my desk subject returns true');
check(isAutoReply({ subject: 'Re: Zorblax Widgetry role', body: 'Hi, I am currently OOO and will be back next week.' }) === true, 'B7: OOO in body returns true');
check(isAutoReply({ subject: 'Re: Zorblax Widgetry role', body: 'Hi, I am glad you reached out.' }) === false, 'B8: Glad you reached out body returns false');
check(isAutoReply({ subject: 'Re: Zorblax Widgetry role', body: 'Happy to chat. I am out of the office next Monday but free Tuesday.' }) === false, 'B9: Out next Monday but free Tuesday returns false');
check(same(classifyForEvent({ subject: 'Currently on Vacation Re: Zorblax Widgetry role', body: 'Back Monday.', sentiment: 'neutral', sender: PERSON }), { kind: 'auto_reply', sentiment: null }), 'B10: classifyForEvent with vacation subject returns auto_reply');

// C. Acknowledgements from automated senders, isApplicationReceipt
check(isApplicationReceipt({ subject: "We’ve received your Senior Widget Engineer application for Zorblax Widgetry", body: '', sentiment: 'neutral', sender: AUTO }) === true, 'C11: Automated receipt subject returns true');
check(isApplicationReceipt({ subject: "We’ve received your Senior Widget Engineer application for Zorblax Widgetry", body: '', sentiment: 'neutral', sender: PERSON }) === false, 'C12: Human sender with receipt subject returns false');
check(isApplicationReceipt({ subject: 'Zorblax Widgetry has received your application!', body: '', sentiment: 'neutral', sender: AUTO }) === true, 'C13: Has received subject returns true');
check(isApplicationReceipt({ subject: 'You applied to Zorblax Widgetry - thank you', body: '', sentiment: 'positive', sender: AUTO }) === true, 'C14: Applied and thank you subject returns true');
check(isApplicationReceipt({ subject: 'Your application for Widget Engineer at Zorblax Widgetry', body: REVIEWING, sentiment: 'neutral', sender: AUTO }) === true, 'C15: Generic subject with reviewing body returns true');
check(isApplicationReceipt({ subject: 'Your application for Widget Engineer at Zorblax Widgetry', body: '', sentiment: 'neutral', sender: AUTO }) === false, 'C16: Generic subject with empty body returns false');
check(isApplicationReceipt({ subject: 'Update regarding your application to Zorblax Widgetry', body: REVIEWING, sentiment: 'neutral', sender: AUTO }) === false, 'C17: Update subject with reviewing body returns false');
check(same(classifyForEvent({ subject: "We’ve received your Senior Widget Engineer application for Zorblax Widgetry", body: '', sentiment: 'neutral', sender: AUTO }), { kind: 'receipt', sentiment: null }), 'C18: classifyForEvent with receipt subject returns receipt');

// D. Conditional sentences, isApplicationReceipt
check(isApplicationReceipt({ subject: 'Thank you for applying to Zorblax Widgetry', body: CONDITIONAL, sentiment: 'neutral', sender: AUTO }) === true, 'D19: Conditional body returns true');
check(isApplicationReceipt({ subject: 'Thank you for applying to Zorblax Widgetry', body: 'We regret to inform you that your application has not been successful.', sentiment: 'neutral', sender: AUTO }) === false, 'D20: Direct rejection body returns false');

// E. Extra rejection wording, isAutomatedRejection
check(isAutomatedRejection({ subject: 'Update', body: 'We have decided to close this position at this time.', sender: AUTO }) === true, 'E21: Close position body with AUTO returns true');
check(isAutomatedRejection({ subject: 'Update', body: FILLED, sender: AUTO }) === true, 'E22: Filled body with AUTO returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'We do not feel like this position best matches your skill set.', sender: AUTO }) === true, 'E23: Does not match body with AUTO returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'We have decided to move forward with candidates whose experience is closer.', sender: AUTO }) === true, 'E24: Move forward with candidates body with AUTO returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'The role is being canceled.', sender: AUTO }) === true, 'E25: Role canceled body with AUTO returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'We have decided to close this position at this time.', sender: PERSON }) === false, 'E26: Close position body with PERSON returns false');
check(isAutomatedRejection({ subject: 'Update', body: FILLED, sender: PERSON }) === false, 'E27: Filled body with PERSON returns false');
check(isAutomatedRejection({ subject: 'Update', body: 'We do not feel like this position best matches your skill set.', sender: PERSON }) === false, 'E28: Does not match body with PERSON returns false');
check(isAutomatedRejection({ subject: 'Update', body: 'We have decided to move forward with candidates whose experience is closer.', sender: PERSON }) === false, 'E29: Move forward with candidates body with PERSON returns false');
check(isAutomatedRejection({ subject: 'Update', body: 'The role is being canceled.', sender: PERSON }) === false, 'E30: Role canceled body with PERSON returns false');

// E2. More rejection wording seen in real automated rejections, isAutomatedRejection
check(isAutomatedRejection({ subject: 'Update', body: 'At this time we will be moving forward with other candidates who are better aligned.', sender: AUTO }) === true, 'E31: will be moving forward with other candidates returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'Unfortunately, we won’t be moving forward with your application for this role.', sender: AUTO }) === true, 'E32: won’t be moving forward (curly apostrophe) returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'We are unable to move forward with your candidacy at this time.', sender: AUTO }) === true, 'E33: unable to move forward returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'We found a new hire. The role is now closed.', sender: AUTO }) === true, 'E34: role is now closed returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'Our team has decided not to move forward at this time.', sender: AUTO }) === true, 'E35: decided not to move forward returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'We have filled the role with another applicant.', sender: AUTO }) === true, 'E36: filled the role returns true');
check(isAutomatedRejection({ subject: 'Update', body: 'We will be moving forward with other candidates.', sender: PERSON }) === false, 'E37: a person sender is not an automated rejection');
check(isAutomatedRejection({ subject: 'Update', body: 'If we decide to move forward with your application, we will contact you.', sender: AUTO }) === false, 'E38: a conditional about moving forward is not a rejection');

// F. Neutral tag corrected, classifyForEvent
check(same(classifyForEvent({ subject: 'Update regarding your application to Zorblax Widgetry', body: FILLED, sentiment: 'neutral', sender: AUTO }), { kind: 'human', sentiment: 'negative', sentiment_source: 'rule' }), 'F31: classifyForEvent with Filled body and AUTO returns negative');
check(same(classifyForEvent({ subject: 'Update regarding your application to Zorblax Widgetry', body: FILLED, sentiment: 'neutral', sender: PERSON }), { kind: 'human', sentiment: 'neutral' }), 'F32: classifyForEvent with Filled body and PERSON returns neutral');

// G. Surveys, isApplicationReceipt
check(isApplicationReceipt({ subject: 'Tell us about your Application experience!', body: 'Share feedback.', sentiment: 'positive', sender: AUTO }) === true, 'G33: Survey subject with feedback body returns true');
check(isApplicationReceipt({ subject: 'We Value Your Feedback on Your Zorblax Widgetry Interview', body: '', sentiment: 'neutral', sender: AUTO }) === true, 'G34: Value feedback subject returns true');
check(isApplicationReceipt({ subject: 'Tell us about your Application experience!', body: '', sentiment: 'positive', sender: PERSON }) === false, 'G35: Survey subject with PERSON returns false');
check(isApplicationReceipt({ subject: 'Tell us about your Application experience!', body: '', sentiment: 'negative', sender: AUTO }) === false, 'G36: Survey subject with negative sentiment returns false');
check(same(classifyForEvent({ subject: 'Tell us about your Application experience!', body: 'Share feedback.', sentiment: 'positive', sender: AUTO }), { kind: 'receipt', sentiment: null }), 'G37: classifyForEvent with survey subject returns receipt');

// H. An interview confirmation from an automated sender stays a positive reply
check(same(classifyForEvent({ subject: "You're All Set - Interview Confirmation with Zorblax Widgetry", body: 'Your interview is booked.', sentiment: 'positive', sender: AUTO }), { kind: 'human', sentiment: 'positive' }), 'H38: classifyForEvent with interview confirmation returns human positive');

console.log(`\ninbound-classify-gaps: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
