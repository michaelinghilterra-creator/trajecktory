import { planBulkRun, describePlan } from '../lib/bulk-ledger.mjs';

let passes = 0;
let failures = 0;

function check(cond, msg) {
  if (cond) {
    console.log('✓ ' + msg);
    passes++;
  } else {
    console.log('✗ ' + msg);
    failures++;
  }
}

// Fixture data
const applications = {
  '900101': {
    status: 'Applied',
    employer_messages: [{ message_id: 'msg-900001', kind: 'rejection' }]
  },
  '900102': {
    status: 'Applied',
    employer_messages: [
      { message_id: 'msg-900002', kind: 'auto_reply' },
      { message_id: 'msg-900003', kind: 'receipt' }
    ]
  },
  '900103': {
    status: 'Applied',
    employer_messages: []
  }
};

const operations = [
  { application_id: '900101', field: 'status', to: 'Rejected', evidence_ref: 'msg-900001' },
  { application_id: '900102', field: 'status', to: 'Rejected', evidence_ref: 'msg-900002' },
  { application_id: '900103', field: 'status', to: 'No Response', evidence_ref: 'msg-900003' },
  { application_id: '900103', field: 'status', to: 'Rejected', evidence_ref: '' },
  { application_id: '999999', field: 'status', to: 'Rejected', evidence_ref: 'msg-900001' },
  { application_id: '900103', field: 'status', to: 'Applied', evidence_ref: 'msg-900003' },
  { application_id: '900101', field: 'custom_field', to: 'new_value', evidence_ref: 'msg-900001' }
];

const script = 'example-repair';
const run_id = 'run-900001';

// Test 1: employer_evidence_exists for 900101
const plan1 = planBulkRun({ script, run_id, operations: [operations[0]], applications });
check(plan1.planned.length === 0, 'plan1: no planned operations');
check(plan1.refused.length === 1, 'plan1: one refused operation');
check(plan1.refused[0].reason === 'employer_evidence_exists', 'plan1: refused reason employer_evidence_exists');

// Test 2: planned for 900102 (only automated messages)
const plan2 = planBulkRun({ script, run_id, operations: [operations[1]], applications });
check(plan2.planned.length === 1, 'plan2: one planned operation');
check(plan2.planned[0].application_id === '900102', 'plan2: correct application');
check(plan2.planned[0].from === 'Applied', 'plan2: from is Applied');
check(plan2.planned[0].to === 'Rejected', 'plan2: to is Rejected');
check(plan2.planned[0].tag.script === 'example-repair', 'plan2: tag script');
check(plan2.planned[0].tag.run_id === 'run-900001', 'plan2: tag run_id');
check(plan2.ledger.length === 1, 'plan2: one ledger entry');
check(plan2.ledger[0].evidence_ref === 'msg-900002', 'plan2: ledger evidence_ref');

// Test 3: no_response_is_hand_set for 900103
const plan3 = planBulkRun({ script, run_id, operations: [operations[2]], applications });
check(plan3.planned.length === 0, 'plan3: no planned operations');
check(plan3.refused.length === 1, 'plan3: one refused operation');
check(plan3.refused[0].reason === 'no_response_is_hand_set', 'plan3: refused reason no_response_is_hand_set');

// Test 4: no_evidence for empty evidence_ref
const plan4 = planBulkRun({ script, run_id, operations: [operations[3]], applications });
check(plan4.planned.length === 0, 'plan4: no planned operations');
check(plan4.refused.length === 1, 'plan4: one refused operation');
check(plan4.refused[0].reason === 'no_evidence', 'plan4: refused reason no_evidence');

// Test 5: unknown_application for 999999
const plan5 = planBulkRun({ script, run_id, operations: [operations[4]], applications });
check(plan5.planned.length === 0, 'plan5: no planned operations');
check(plan5.refused.length === 1, 'plan5: one refused operation');
check(plan5.refused[0].reason === 'unknown_application', 'plan5: refused reason unknown_application');

// Test 6: no_change for same status
const plan6 = planBulkRun({ script, run_id, operations: [operations[5]], applications });
check(plan6.planned.length === 0, 'plan6: no planned operations');
check(plan6.refused.length === 1, 'plan6: one refused operation');
check(plan6.refused[0].reason === 'no_change', 'plan6: refused reason no_change');

// Test 7: non-status field change is planned
const plan7 = planBulkRun({ script, run_id, operations: [operations[6]], applications });
check(plan7.planned.length === 1, 'plan7: one planned operation');
check(plan7.planned[0].from === null, 'plan7: from is null for non-status field');
check(plan7.planned[0].field === 'custom_field', 'plan7: field is custom_field');

// Test 8: missing script
const plan8 = planBulkRun({ script: '', run_id, operations, applications });
check(plan8.planned.length === 0, 'plan8: no planned operations when script missing');
check(plan8.refused.length === operations.length, 'plan8: all operations refused when script missing');
check(plan8.refused[0].reason === 'missing_script_or_run_id', 'plan8: refused reason missing_script_or_run_id');

// Test 9: empty run_id
const plan9 = planBulkRun({ script, run_id: '', operations, applications });
check(plan9.planned.length === 0, 'plan9: no planned operations when run_id empty');
check(plan9.refused.length === operations.length, 'plan9: all operations refused when run_id empty');

// Test 10: mode is dry_run
const plan10 = planBulkRun({ script, run_id, operations, applications });
check(plan10.mode === 'dry_run', 'plan10: mode is dry_run');

// Test 11: inputs unchanged
const appsCopy = JSON.parse(JSON.stringify(applications));
const opsCopy = JSON.parse(JSON.stringify(operations));
planBulkRun({ script, run_id, operations, applications });
check(JSON.stringify(applications) === JSON.stringify(appsCopy), 'plan11: applications unchanged');
check(JSON.stringify(operations) === JSON.stringify(opsCopy), 'plan11: operations unchanged');

// Test 12: describePlan output
const plan12 = planBulkRun({ script, run_id, operations: [operations[0], operations[1]], applications });
const description = describePlan(plan12);
check(description[0] === 'DRY RUN example-repair run-900001: 1 planned, 1 refused', 'description header correct');
check(description[1] === 'REFUSED #0 application 900101: employer_evidence_exists', 'description first item correct');
check(description[2] === 'PLAN #1 application 900102 status: Applied -> Rejected [example-repair run-900001] evidence msg-900002', 'description second item correct');

for (const badScript of [undefined, null, 42]) {
  const p = planBulkRun({ script: badScript, run_id, operations: [operations[1]], applications });
  check(p.planned.length === 0 && p.refused.length === 1 && p.refused[0].reason === 'missing_script_or_run_id', 'script ' + String(badScript) + ' refuses every operation');
}
const noRun = planBulkRun({ script, run_id: '', operations: [operations[1]], applications });
const noRunLines = describePlan(noRun);
check(noRunLines[0] === 'DRY RUN example-repair missing: 0 planned, 1 refused', 'description prints missing for an empty run_id');
check(noRunLines[1] === 'REFUSED #0 application 900102: missing_script_or_run_id', 'description lists the refusal for a missing run_id');
const noScriptLines = describePlan(planBulkRun({ script: undefined, run_id, operations: [operations[1]], applications }));
check(noScriptLines[0] === 'DRY RUN missing run-900001: 0 planned, 1 refused', 'description prints missing for an absent script');

for (const badEvidence of [null, '', 7]) {
  const p = planBulkRun({ script, run_id, operations: [{ ...operations[1], evidence_ref: badEvidence }], applications });
  check(p.planned.length === 0 && p.refused[0].reason === 'no_evidence', 'evidence_ref ' + JSON.stringify(badEvidence) + ' is refused as no_evidence');
}

const noMessages = planBulkRun({ script, run_id, operations: [{ application_id: '900104', field: 'status', to: 'Rejected', evidence_ref: 'msg-900004' }], applications: { '900104': { status: 'Applied' } } });
check(noMessages.planned.length === 1, 'an application with no employer_messages list is planned, not a crash');

const humanReply = planBulkRun({ script, run_id, operations: [{ application_id: '900105', field: 'status', to: 'Passed', evidence_ref: 'msg-900005' }], applications: { '900105': { status: 'Applied', employer_messages: [{ message_id: 'msg-900005', kind: 'human_reply' }] } } });
check(humanReply.planned.length === 0 && humanReply.refused[0].reason === 'employer_evidence_exists', 'a human reply counts as employer evidence and blocks a status change');
const sameStatusWithEvidence = planBulkRun({ script, run_id, operations: [{ application_id: '900101', field: 'status', to: 'Applied', evidence_ref: 'msg-900001' }], applications });
check(sameStatusWithEvidence.refused[0].reason === 'employer_evidence_exists', 'employer evidence blocks even a change to the same status');

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
