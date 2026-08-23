#!/usr/bin/env node
/**
 * tt-linkedin.test.mjs — unit tests for the TA-contact LinkedIn connection axis.
 *
 * The LinkedIn accept/pending state is a SEPARATE axis from the outreach pipeline
 * (Not Contacted → … → Connected). It lives in a sidecar (tt-linkedin.json), so
 * these tests exercise the sidecar reader/writer directly against a temp
 * TJK_DATA_DIR. Covers: default is 'Not Connected', explicit set round-trips,
 * setting back to 'Not Connected' clears the entry (file stays sparse), an invalid
 * state throws, and markInvitePending advances only from 'Not Connected' and never
 * regresses a 'Connected' contact.
 *
 * Run: node tests/tt-linkedin.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

// Point config at a throwaway data dir BEFORE importing anything that reads it.
const tmp = makeSandbox("tt-linkedin");
process.env.TJK_DATA_DIR = tmp;

const {
  LINKEDIN_STATES, isLinkedInState, linkedInRank,
  getLinkedInStatus, setLinkedInStatus, markInvitePending, readLinkedInMap,
} = await import('../dashboard-web/server/lib/tt-linkedin.mjs');
const { TT_LINKEDIN_PATH } = await import('../dashboard-web/server/config.mjs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('tt-linkedin.test.mjs');

// ── States + helpers ──────────────────────────────────────────────────────────
check(LINKEDIN_STATES.length === 3, 'three states');
check(isLinkedInState('Invite Pending') && !isLinkedInState('Bogus'), 'isLinkedInState validates');
check(linkedInRank('Not Connected') < linkedInRank('Invite Pending')
   && linkedInRank('Invite Pending') < linkedInRank('Connected'), 'rank is strictly increasing');
check(linkedInRank('Bogus') === 0, 'unknown state ranks as Not Connected');

// ── Default ───────────────────────────────────────────────────────────────────
check(getLinkedInStatus(1) === 'Not Connected', 'default is Not Connected when no entry');
check(!fs.existsSync(TT_LINKEDIN_PATH) || Object.keys(readLinkedInMap()).length === 0,
  'no sidecar entries yet');

// ── Explicit set round-trips ──────────────────────────────────────────────────
setLinkedInStatus(1, 'Connected');
check(getLinkedInStatus(1) === 'Connected', 'explicit set to Connected persists');
setLinkedInStatus(1, 'Invite Pending');
check(getLinkedInStatus(1) === 'Invite Pending', 'can move Connected → Invite Pending (user override)');

// ── Setting back to Not Connected clears the entry ────────────────────────────
setLinkedInStatus(1, 'Not Connected');
check(getLinkedInStatus(1) === 'Not Connected', 'set back to Not Connected reads as default');
check(readLinkedInMap()['1'] === undefined, 'Not Connected clears the sidecar entry (stays sparse)');

// ── Invalid state throws ──────────────────────────────────────────────────────
let threw = false;
try { setLinkedInStatus(2, 'Accepted'); } catch { threw = true; }
check(threw, 'invalid state throws');

// ── markInvitePending advances only from Not Connected ────────────────────────
check(markInvitePending(3) === 'Invite Pending', 'invite advances Not Connected → Invite Pending');
check(getLinkedInStatus(3) === 'Invite Pending', 'Invite Pending persisted');

setLinkedInStatus(4, 'Connected');
check(markInvitePending(4) === 'Connected', 'invite does NOT regress a Connected contact');
check(getLinkedInStatus(4) === 'Connected', 'Connected preserved after a later invite');

// A second invite to a pending contact is a no-op (keeps existing state).
check(markInvitePending(3) === 'Invite Pending', 'second invite keeps Invite Pending (idempotent)');

// ── Independent contacts don't bleed into each other ──────────────────────────
check(getLinkedInStatus(999) === 'Not Connected', 'untouched contact still defaults');

// Cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
