import { gateTwcExport } from '../lib/export-gate.mjs';

const range = { from: '2030-03-03', to: '2030-03-09' };
const today = '2030-03-20';
const slot_end = '2030-03-08T19:00:00.000Z';

let passes = 0;
let failures = 0;

function check(cond, msg) {
  if (cond) {
    console.log('PASS: ' + msg);
    passes++;
  } else {
    console.log('FAIL: ' + msg);
    failures++;
  }
}

function copy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Case 1: unconfirmed interview blocks export
{
  const interviews = [
    { id: 900001, stage: 'Phone Screen', scheduled_for: '2030-03-08', held_on: '2030-03-08', slot_end, evidence: [] }
  ];
  const mismatches = [];
  const rows = [];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(!result.allowed, 'export blocked by unconfirmed interview');
  check(result.blockers.length === 1, 'one blocker');
  check(result.blockers[0].type === 'unconfirmed_interview', 'blocker type is unconfirmed_interview');
  check(result.blockers[0].id === 900001, 'blocker id is 900001');
  check(JSON.stringify(result.blockers[0].reasons) === JSON.stringify(['no_evidence']), 'blocker reasons is [no_evidence]');
  check(JSON.stringify(result.rows) === JSON.stringify([]), 'rows is empty');
  check(result.appendix.length === 0, 'appendix is empty');
  check(result.footer === null, 'footer is null');
}

// Case 2: unconfirmed interview with qualifying evidence does not block
{
  const interviews = [
    { id: 900001, stage: 'Phone Screen', scheduled_for: '2030-03-08', held_on: '2030-03-08', slot_end, evidence: [{ kind: 'owner_message', at: '2030-03-08T20:15:00.000Z', refers_to_conversation: true }] }
  ];
  const mismatches = [];
  const rows = [];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(result.allowed, 'export allowed when interview has qualifying evidence');
  check(result.blockers.length === 0, 'no blockers');
  check(result.rows.length === 0, 'rows empty');
}

// Case 3: scheduled interview later than today is not in range
{
  const interviews = [
    { id: 900002, stage: 'Phone Screen', scheduled_for: '2030-03-25', slot_end }
  ];
  const mismatches = [];
  const rows = [];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(result.allowed, 'export allowed when scheduled interview is after range');
  check(result.blockers.length === 0, 'no blockers');
}

// Case 4: scheduled interview in range blocks
{
  const range2 = { from: '2030-03-03', to: '2030-03-09' };
  const today2 = '2030-03-08';
  const interviews = [
    { id: 900002, stage: 'Phone Screen', scheduled_for: '2030-03-09', slot_end }
  ];
  const mismatches = [];
  const rows = [];

  const result = gateTwcExport({ range: range2, today: today2, interviews, mismatches, rows });

  check(!result.allowed, 'export blocked by scheduled interview in range');
  check(result.blockers.length === 1, 'one blocker');
  check(result.blockers[0].type === 'scheduled_in_range', 'blocker type is scheduled_in_range');
  check(result.blockers[0].id === 900002, 'blocker id is 900002');
}

// Case 5: mismatch in range blocks
{
  const interviews = [];
  const mismatches = [
    { application_id: 900101, type: 'rejection_after_no_response', dated_on: '2030-03-05' }
  ];
  const rows = [];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(!result.allowed, 'export blocked by mismatch in range');
  check(result.blockers.length === 1, 'one blocker');
  check(result.blockers[0].type === 'status_mismatch', 'blocker type is status_mismatch');
  check(result.blockers[0].id === 900101, 'blocker id is 900101');
  check(result.blockers[0].mismatch_type === 'rejection_after_no_response', 'mismatch type is rejection_after_no_response');
}

// Case 6: mismatch outside range does not block
{
  const interviews = [];
  const mismatches = [
    { application_id: 900101, type: 'rejection_after_no_response', dated_on: '2030-03-15' }
  ];
  const rows = [];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(result.allowed, 'export allowed when mismatch is outside range');
  check(result.blockers.length === 0, 'no blockers');
}

// Case 7: blockers order: unconfirmed interview first, then mismatch
{
  const interviews = [
    { id: 900001, stage: 'Phone Screen', scheduled_for: '2030-03-08', held_on: '2030-03-08', slot_end, evidence: [] }
  ];
  const mismatches = [
    { application_id: 900101, type: 'rejection_after_no_response', dated_on: '2030-03-05' }
  ];
  const rows = [];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(!result.allowed, 'export blocked');
  check(result.blockers.length === 2, 'two blockers');
  check(result.blockers[0].type === 'unconfirmed_interview', 'first blocker is unconfirmed_interview');
  check(result.blockers[1].type === 'status_mismatch', 'second blocker is status_mismatch');
}

// Case 8: allowed export with rows
{
  const range3 = { from: '2030-03-03', to: '2030-03-31' };
  const today3 = '2030-03-20';
  const interviews = [];
  const mismatches = [];
  const rows = [
    { id: 900003, kind: 'application', date: '2030-03-06', evidence_ref: 'file-900003' },
    { id: 900002, kind: 'application', date: '2030-03-06', evidence_ref: 'file-900002' },
    { id: 900004, kind: 'application', date: '2030-03-25', evidence_ref: 'file-900004' }
  ];

  const result = gateTwcExport({ range: range3, today: today3, interviews, mismatches, rows });

  check(result.allowed, 'export allowed');
  check(result.blockers.length === 0, 'no blockers');
  check(result.rows.length === 2, 'two counted rows');
  check(result.rows[0].id === 900002, 'first row id is 900002');
  check(result.rows[1].id === 900003, 'second row id is 900003');
  check(result.rows[0].date === '2030-03-06', 'first row date is 2030-03-06');
  check(result.rows[1].date === '2030-03-06', 'second row date is 2030-03-06');
  check(result.rows[0].kind === 'application', 'first row kind is application');
  check(result.rows[1].kind === 'application', 'second row kind is application');
  check(result.appendix.length === 2, 'two appendix entries');
  check(result.appendix[0].id === 900002, 'first appendix entry id is 900002');
  check(result.appendix[0].evidence_ref === 'file-900002', 'first appendix evidence_ref');
  check(result.appendix[1].id === 900003, 'second appendix entry id is 900003');
  check(result.appendix[1].evidence_ref === 'file-900003', 'second appendix evidence_ref');
  check(result.footer.counted === 2, 'footer counted is 2');
  check(result.footer.excluded === 1, 'footer excluded is 1');
  check(result.footer.excluded_reasons.future_date === 1, 'future_date count is 1');
  check(result.footer.excluded_reasons.no_evidence === 0, 'no_evidence count is 0');
  check(result.footer.excluded_reasons.bad_date === 0, 'bad_date count is 0');
}

// Case 9: row with empty evidence_ref excluded with no_evidence
{
  const interviews = [];
  const mismatches = [];
  const rows = [
    { id: 900005, kind: 'application', date: '2030-03-06', evidence_ref: '' }
  ];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(result.allowed, 'export allowed');
  check(result.rows.length === 0, 'no counted rows');
  check(result.footer.excluded_reasons.no_evidence === 1, 'no_evidence count is 1');
}

// Case 10: row with bad date excluded with bad_date
{
  const interviews = [];
  const mismatches = [];
  const rows = [
    { id: 900006, kind: 'application', date: '2030-02-30', evidence_ref: 'file-900006' }
  ];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(result.allowed, 'export allowed');
  check(result.rows.length === 0, 'no counted rows');
  check(result.footer.excluded_reasons.bad_date === 1, 'bad_date count is 1');
}

// Case 11: row outside range is not counted and not excluded
{
  const interviews = [];
  const mismatches = [];
  const rows = [
    { id: 900007, kind: 'application', date: '2030-02-01', evidence_ref: 'file-900007' }
  ];

  const result = gateTwcExport({ range, today, interviews, mismatches, rows });

  check(result.allowed, 'export allowed');
  check(result.rows.length === 0, 'no counted rows');
  check(result.footer.excluded_reasons.bad_date === 0, 'bad_date count is 0');
  check(result.footer.excluded_reasons.no_evidence === 0, 'no_evidence count is 0');
  check(result.footer.excluded_reasons.future_date === 0, 'future_date count is 0');
}

// Case 12: row in future is excluded with future_date
{
  const interviews = [];
  const mismatches = [];
  const rows = [
    { id: 900008, kind: 'application', date: '2030-03-25', evidence_ref: 'file-900008' }
  ];

  const result = gateTwcExport({ range: { from: '2030-03-03', to: '2030-03-31' }, today, interviews, mismatches, rows });

  check(result.allowed, 'export allowed');
  check(result.rows.length === 0, 'no counted rows');
  check(result.footer.excluded_reasons.future_date === 1, 'future_date count is 1');
}

// Case 13: invalid range (from later than to) throws TypeError
{
  try {
    gateTwcExport({ range: { from: '2030-03-10', to: '2030-03-03' }, today, interviews: [], mismatches: [], rows: [] });
    check(false, 'throws TypeError for from > to');
  } catch (e) {
    check(e instanceof TypeError, 'throws TypeError for from > to');
  }
}

// Case 14: invalid today throws TypeError
{
  try {
    gateTwcExport({ range, today: '2030-02-30', interviews: [], mismatches: [], rows: [] });
    check(false, 'throws TypeError for bad today');
  } catch (e) {
    check(e instanceof TypeError, 'throws TypeError for bad today');
  }
}

// Case 15: inputs unchanged after call
{
  const interviews = [
    { id: 900001, stage: 'Phone Screen', scheduled_for: '2030-03-08', held_on: '2030-03-08', slot_end, evidence: [] }
  ];
  const mismatches = [
    { application_id: 900101, type: 'rejection_after_no_response', dated_on: '2030-03-05' }
  ];
  const rows = [
    { id: 900003, kind: 'application', date: '2030-03-06', evidence_ref: 'file-900003' }
  ];

  const interviewsCopy = copy(interviews);
  const mismatchesCopy = copy(mismatches);
  const rowsCopy = copy(rows);

  gateTwcExport({ range, today, interviews, mismatches, rows });

  check(JSON.stringify(interviews) === JSON.stringify(interviewsCopy), 'interviews unchanged');
  check(JSON.stringify(mismatches) === JSON.stringify(mismatchesCopy), 'mismatches unchanged');
  check(JSON.stringify(rows) === JSON.stringify(rowsCopy), 'rows unchanged');
}

console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures > 0) {
  process.exit(1);
}
