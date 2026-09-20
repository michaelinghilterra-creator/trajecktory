import { parseReplyNote, repliesByApplication, statusMismatchReport, overrideEvidenceGaps } from '../lib/data-review.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const DASH = '\u2014';
const note = (text, timestamp = '2030-03-08T10:00:00.000Z') => ({ timestamp, text });

// parseReplyNote
{
  const colon = parseReplyNote(note('### Reply logged (2030-03-08)\nhr@example.test: Update on your application [negative]\n\nThank you for applying.\nWe will not proceed.'));
  check(colon.sent_on === '2030-03-08' && colon.sender === 'hr@example.test' && colon.subject === 'Update on your application', 'colon header gives date, sender and subject');
  check(colon.sentiment === 'negative', 'sentiment negative is read');
  check(colon.body === 'Thank you for applying.\nWe will not proceed.', 'body keeps every line after the blank line');

  const dash = parseReplyNote(note(`### Reply logged (2030-03-08)\nhr@example.test ${DASH} Next steps [positive]`));
  check(dash.sender === 'hr@example.test' && dash.subject === 'Next steps' && dash.sentiment === 'positive', 'long dash header is split the same way');
  check(dash.body === '', 'a note with no body has an empty body');
  const stray = parseReplyNote(note('### Reply logged (2030-03-08)\nhr@example.test: Hello [neutral]\nline one\nline two\n\nreal body'));
  check(stray.body === 'real body', 'the body starts after the first blank line, not after the first line following the header');

  check(parseReplyNote(note('### Reply logged (2030-03-08)\nhr@example.test: Hello [neutral]')).sentiment === 'neutral', 'sentiment neutral is read from the tag');
  const untagged = parseReplyNote(note('### Reply logged (2030-03-08)\nhr@example.test: Hello'));
  check(untagged.sentiment === 'neutral' && untagged.subject === 'Hello', 'no sentiment tag means neutral and the tag is not stripped from nothing');
  const bare = parseReplyNote(note('### Reply logged (2030-03-08)\nJust a line [positive]'));
  check(bare.sender === '' && bare.subject === 'Just a line' && bare.sentiment === 'positive', 'a header with no separator has an empty sender');
  const nested = parseReplyNote(note('### Reply logged (2030-03-08)\nhr@example.test: Re: Offer: details [negative]'));
  check(nested.sender === 'hr@example.test' && nested.subject === 'Re: Offer: details', 'later separators stay in the subject');
  const mixed = parseReplyNote(note(`### Reply logged (2030-03-08)\nhr@example.test ${DASH} Re: Hello [neutral]`));
  check(mixed.sender === 'hr@example.test' && mixed.subject === 'Re: Hello', 'the earlier separator wins when both appear');
  const tagInSubject = parseReplyNote(note('### Reply logged (2030-03-08)\nhr@example.test: Score [positive] review [negative]'));
  check(tagInSubject.sentiment === 'negative' && tagInSubject.subject === 'Score [positive] review', 'only the tag at the end of the line is the sentiment');

  check(parseReplyNote(note('### Reply logged (2030-02-30)\nx: y [neutral]')) === null, 'an impossible date gives null');
  check(parseReplyNote(note('### Note (2030-03-08)\nx: y')) === null, 'another kind of note gives null');
  check(parseReplyNote(note('### Reply logged (2030-03-08) extra\nx: y')) === null, 'extra text on the first line gives null');
  check(parseReplyNote({ timestamp: 't' }) === null && parseReplyNote({ text: 42 }) === null && parseReplyNote(null) === null, 'missing, non-string and null input give null');
}

// repliesByApplication
{
  const map = repliesByApplication({
    900001: [
      note('### Reply logged (2030-03-08)\nhr@example.test: First [neutral]', 'ts-one'),
      note('### Meeting notes\nnot a reply', 'ts-skip'),
      note('### Reply logged (2030-03-09)\nhr@example.test: Second [negative]\n\nBody two', 'ts-two'),
    ],
    900002: [note('### Debrief: Phone Screen (2030-03-10)\ntext')],
    900003: 'not an array',
  });
  check(map.size === 1 && map.has('900001'), 'only applications with an accepted reply are in the map');
  const messages = map.get('900001');
  check(messages.length === 2 && messages[0].subject === 'First' && messages[1].subject === 'Second', 'order is preserved and non-replies are skipped');
  check(messages[0].message_id === 'note:900001:ts-one' && messages[1].message_id === 'note:900001:ts-two', 'message ids come from the application id and timestamp');
  check(messages[0].direction === 'from_employer' && messages[1].body === 'Body two' && messages[1].sent_on === '2030-03-09', 'direction, body and date are carried over');
  check(repliesByApplication(null).size === 0 && repliesByApplication({}).size === 0, 'missing input gives an empty map');
  check(repliesByApplication({ 900001: [{ text: '### Reply logged (2030-03-08)\nx: y [neutral]' }] }).get('900001')[0].message_id === 'note:900001:', 'a missing timestamp gives an empty timestamp part');
}

// statusMismatchReport
{
  const notes = {
    900001: [note('### Reply logged (2030-03-08)\nhr@example.test: Update on your application [negative]\n\nUnfortunately we will not be moving forward.')],
    900002: [note('### Reply logged (2030-03-09)\nhr@example.test: Thanks for your time, let us know a good time to talk [positive]')],
    900003: [note('### Reply logged (2030-03-10)\nhr@example.test: Update on your application [negative]\n\nUnfortunately we will not be moving forward.')],
    900004: [note('### Reply logged (2030-03-11)\nhr@example.test: Automatic reply: out of office [neutral]\n\nI am out of office')],
  };
  const apps = [
    { id: 900001, status: 'No Response' },
    { id: '900002', status: 'No Response' },
    { id: 900003, status: 'Applied' },
    { id: 900004, status: 'No Response' },
    { id: 900005, status: 'No Response' },
  ];
  const report = statusMismatchReport(apps, notes);
  const byApp = new Map(report.mismatches.map(item => [String(item.application_id), item]));
  check(report.mismatches.length === 2, 'two applications are flagged');
  check(byApp.get('900001')?.type === 'rejection_after_no_response' && byApp.get('900001').proposed?.status === 'Rejected' && byApp.get('900001').dated_on === '2030-03-08', 'a rejection reply is proposed as Rejected dated by the note');
  check(byApp.get('900002')?.type === 'reply_after_no_response' && byApp.get('900002').proposed === null, 'a human reply is listed with no proposal');
  check(!byApp.has('900003'), 'an application that is not No Response is never flagged');
  check(!byApp.has('900004'), 'an automatic reply is not evidence');
  check(report.checked === 4 && report.with_messages === 3, 'counts cover only No Response applications and those with replies');
  const empty = statusMismatchReport([], {});
  check(empty.mismatches.length === 0 && empty.checked === 0 && empty.with_messages === 0, 'no applications gives an empty report');
}

// overrideEvidenceGaps
{
  const resolveAll = () => true;
  const good = { appId: '900001', stage: 'Phone Screen', date: '2030-03-08', evidence_ref: { kind: 'message_id', id: 'msg-900001' } };
  check(overrideEvidenceGaps([good], resolveAll).ok === 1, 'an override with resolving evidence is ok');
  const result = overrideEvidenceGaps([
    good,
    { appId: '900002', stage: 'Phone Screen', date: '2030-03-08' },
    { appId: '900003', stage: 'Phone Screen', date: '2030-03-08', evidence_ref: { kind: 'message_id', id: 'msg-900003' } },
    { appId: '900004', stage: 'Phone Screen', date: '2030-02-30', evidence_ref: { kind: 'message_id', id: 'msg-900004' } },
    { stage: 'Phone Screen', date: '2030-03-08', evidence_ref: { kind: 'message_id', id: 'x' } },
    { appId: '900006', date: '2030-03-08', evidence_ref: { kind: 'message_id', id: 'x' } },
    { appId: '900007', stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'x' } },
    { appId: '900008', stage: 'Phone Screen', date: '2030-03-08', evidence_ref: { kind: 'note', id: 'x' } },
  ], (kind, id) => id !== 'msg-900003');
  const reasons = new Map(result.gaps.map(gap => [gap.index, gap.reason]));
  check(result.total === 8 && result.ok === 2 && result.gaps.length === 6, 'totals count every entry');
  check(reasons.get(1) === 'no_evidence', 'no evidence_ref gives no_evidence');
  check(reasons.get(2) === 'unresolved_evidence', 'evidence that does not resolve gives unresolved_evidence');
  check(reasons.get(3) === 'bad_date', 'an impossible date gives bad_date');
  check(reasons.get(4) === 'no_event_id' && reasons.get(5) === 'no_event_id', 'a missing appId or stage gives no_event_id');
  check(!reasons.has(6), 'a stage with no new date is a valid change');
  check(reasons.get(7) === 'bad_evidence_kind', 'an unknown evidence kind gives bad_evidence_kind');
  check(result.gaps[0].appId === '900002' && result.gaps[0].stage === 'Phone Screen', 'gaps carry the app and stage');
  const none = overrideEvidenceGaps(undefined, resolveAll);
  check(none.total === 0 && none.ok === 0 && none.gaps.length === 0, 'non-array input counts as empty');
}

console.log(`data-review: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
