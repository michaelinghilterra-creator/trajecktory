import { buildProvenance, detectUnverifiedNote, noteSupportsCountedInterview } from '../lib/provenance.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('✅ ' + msg); }
  else { failed++; console.log('❌ ' + msg); }
}

// buildProvenance tests
const p1 = buildProvenance({ source: 'dashboard_action', recorded_at: '2030-03-08T13:00:00.417Z' });
check(p1.source === 'dashboard_action', 'buildProvenance dashboard_action source');
check(p1.recorded_at === '2030-03-08T13:00:00.417Z', 'buildProvenance recorded_at');
check(!('script' in p1), 'buildProvenance no script for non-bulk');
check(!('run_id' in p1), 'buildProvenance no run_id for non-bulk');

const pDrop = buildProvenance({ source: 'importer', script: 'example-repair', run_id: 'run-900001', recorded_at: '2030-03-08T13:00:00.417Z' });
check(!('script' in pDrop) && !('run_id' in pDrop), 'buildProvenance drops script and run_id for a non-bulk source');

const p2 = buildProvenance({ source: 'bulk_script', script: 'example-repair', run_id: 'run-900001', recorded_at: '2030-03-08T13:00:00.417Z' });
check(p2.source === 'bulk_script', 'buildProvenance bulk_script source');
check(p2.script === 'example-repair', 'buildProvenance bulk_script script');
check(p2.run_id === 'run-900001', 'buildProvenance bulk_script run_id');

try {
  buildProvenance({ source: 'bulk_script', script: 'example-repair', recorded_at: '2030-03-08T13:00:00.417Z' });
  check(false, 'buildProvenance bulk_script without run_id throws');
} catch (e) {
  check(/run_id/.test(e.message), 'buildProvenance bulk_script without run_id throws run_id');
}

try {
  buildProvenance({ source: 'unknown_source', recorded_at: '2030-03-08T13:00:00.417Z' });
  check(false, 'buildProvenance unknown source throws');
} catch (e) {
  check(/source/.test(e.message), 'buildProvenance unknown source throws source');
}

try {
  buildProvenance({ source: 'dashboard_action', recorded_at: '2030-03-08T13:00:00Z' });
  check(false, 'buildProvenance without milliseconds throws');
} catch (e) {
  check(/recorded_at/.test(e.message), 'buildProvenance without milliseconds throws recorded_at');
}

// detectUnverifiedNote tests
const note1 = {
  timestamp: '2030-03-08T13:00:00.000Z',
  slot_start: '2030-03-08T18:00:00.000Z',
  confirmation: undefined
};
const r1 = detectUnverifiedNote(note1);
check(r1.unverified === true, 'detectUnverifiedNote second_boundary and before_slot unverified');
check(r1.reasons.includes('second_boundary'), 'detectUnverifiedNote has second_boundary');
check(r1.reasons.includes('before_slot'), 'detectUnverifiedNote has before_slot');

const note2 = {
  timestamp: '2030-03-08T13:00:00.000Z',
  slot_start: '2030-03-08T18:00:00.000Z',
  confirmation: { confirmed_on: '2030-03-09' }
};
const r2 = detectUnverifiedNote(note2);
check(r2.unverified === false, 'detectUnverifiedNote with valid confirmation unverified false');
check(r2.reasons.includes('second_boundary'), 'detectUnverifiedNote with confirmation still has second_boundary');
check(r2.reasons.includes('before_slot'), 'detectUnverifiedNote with confirmation still has before_slot');

const note3 = {
  timestamp: '2030-03-08T19:05:12.381Z',
  slot_start: '2030-03-08T18:00:00.000Z',
  confirmation: undefined
};
const r3 = detectUnverifiedNote(note3);
check(r3.unverified === false, 'detectUnverifiedNote normal timestamp unverified false');
check(r3.reasons.length === 0, 'detectUnverifiedNote normal timestamp no reasons');

const note4 = {
  timestamp: '2030-03-08T19:05:12.381Z',
  slot_start: undefined,
  confirmation: undefined
};
const r4 = detectUnverifiedNote(note4);
check(r4.unverified === false, 'detectUnverifiedNote no slot_start unverified false');
check(r4.reasons.length === 0, 'detectUnverifiedNote no slot_start no reasons');

const note5 = {
  timestamp: 'not a date',
  slot_start: '2030-03-08T18:00:00.000Z',
  confirmation: undefined
};
const r5 = detectUnverifiedNote(note5);
check(r5.unverified === true, 'detectUnverifiedNote bad_timestamp unverified');
check(r5.reasons.length === 1, 'detectUnverifiedNote bad_timestamp only one reason');
check(r5.reasons[0] === 'bad_timestamp', 'detectUnverifiedNote bad_timestamp reason');

const note6 = {
  timestamp: '2030-03-08T13:00:00.000Z',
  slot_start: '2030-03-08T18:00:00.000Z',
  confirmation: { confirmed_on: '2030-02-30' }
};
const r6 = detectUnverifiedNote(note6);
check(r6.unverified === true, 'detectUnverifiedNote invalid confirmation date unverified');
check(r6.reasons.includes('second_boundary'), 'detectUnverifiedNote invalid confirmation still has second_boundary');
check(r6.reasons.includes('before_slot'), 'detectUnverifiedNote invalid confirmation still has before_slot');

// noteSupportsCountedInterview tests
check(noteSupportsCountedInterview(note1) === false, 'noteSupportsCountedInterview unverified note returns false');
check(noteSupportsCountedInterview(note2) === true, 'noteSupportsCountedInterview confirmed note returns true');
check(noteSupportsCountedInterview(note3) === true, 'noteSupportsCountedInterview normal note returns true');

console.log(`provenance: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
