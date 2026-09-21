#!/usr/bin/env node
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('sequence-tone');
process.env.TJK_DATA_DIR = sandbox;

const { toneForNextTouch, getTemplate } = await import('../dashboard-web/server/lib/sequences.mjs');

const cadence = getTemplate('application-day-0-1-5-12');
const legacy = getTemplate('cold-intro-principal');

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

// Case 1: Entry { step: 0 } (next touch is step 1, expected channel either)
check(
  toneForNextTouch({ step: 0 }, cadence, 'linkedin').includes('Under 300 characters'),
  'Case 1a: linkedin tone includes Under 300 characters'
);
check(
  toneForNextTouch({ step: 0 }, cadence, 'email').includes('Brief and professional'),
  'Case 1b: email tone includes Brief and professional'
);

// Case 2: Entry { step: 1, firstChannel: 'linkedin' } (touch 2 expects email)
check(
  toneForNextTouch({ step: 1, firstChannel: 'linkedin' }, cadence, 'email').includes('Mention the specific role'),
  'Case 2a: email returns non-empty with Mention the specific role'
);
check(
  toneForNextTouch({ step: 1, firstChannel: 'linkedin' }, cadence, 'linkedin') === '',
  'Case 2b: linkedin returns empty string'
);

// Case 3: Entry { step: 1, firstChannel: 'email' } (touch 2 expects LinkedIn)
check(
  toneForNextTouch({ step: 1, firstChannel: 'email' }, cadence, 'linkedin') !== '',
  'Case 3a: linkedin returns non-empty string'
);
check(
  toneForNextTouch({ step: 1, firstChannel: 'email' }, cadence, 'email') === '',
  'Case 3b: email returns empty string'
);

// Case 4: Entry { step: 2 } (touch 3, email only)
check(
  toneForNextTouch({ step: 2 }, cadence, 'email').includes('Short check-in'),
  'Case 4a: email includes Short check-in'
);
check(
  toneForNextTouch({ step: 2 }, cadence, 'linkedin') === '',
  'Case 4b: linkedin returns empty string'
);

// Case 5: Paused and completed entries return empty
check(
  toneForNextTouch({ step: 0, paused: true }, cadence, 'email') === '',
  'Case 5a: paused entry returns empty'
);
check(
  toneForNextTouch({ step: 0, completedAt: '2030-01-01' }, cadence, 'email') === '',
  'Case 5b: completed entry returns empty'
);

// Case 6: Past last touch, null entry, null template
check(
  toneForNextTouch({ step: 4 }, cadence, 'email') === '',
  'Case 6a: past last touch returns empty'
);
check(
  toneForNextTouch(null, cadence, 'email') === '',
  'Case 6b: null entry returns empty'
);
check(
  toneForNextTouch({ step: 0 }, null, 'email') === '',
  'Case 6c: null template returns empty'
);

// Case 7: Legacy single channel template
check(
  toneForNextTouch({ step: 0 }, legacy, 'email') !== '',
  'Case 7a: legacy email returns non-empty'
);
check(
  toneForNextTouch({ step: 0 }, legacy, 'linkedin') === '',
  'Case 7b: legacy linkedin returns empty'
);

// Case 8: Channel matching is case insensitive
check(
  toneForNextTouch({ step: 2 }, cadence, 'EMAIL').includes('Short check-in'),
  'Case 8: case insensitive channel matching'
);

console.log(`\nsequence-tone: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
