#!/usr/bin/env node
// backfill-linkedin-status.mjs — heal the LinkedIn status axis from our OWN saved
// correspondence. A "Mark sent" on a LinkedIn invite writes a `Sent | LinkedIn`
// entry to data/target-talent-correspondence/{id}.md, but some send paths did NOT
// also advance data/tt-linkedin.json to 'Invite Pending'. Result: 163 contacts we
// demonstrably invited (the invite is in our files) still read as 'Not Connected'
// in the follow-up queue, so it offers to invite them again.
//
// This reconciles the two: for every contact whose correspondence contains a
// Sent LinkedIn invite, advance the LinkedIn axis to at least 'Invite Pending',
// dated from the earliest such invite. Forward-only (markInvitePending never
// downgrades, so 'Connected' is preserved), idempotent, reads only our own files.
//
// Dry-run by default; pass --apply to write.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readTTCorrespondence } from './dashboard-web/server/lib/target-talent.mjs';
import { readLinkedInMap, markInvitePending } from './dashboard-web/server/lib/tt-linkedin.mjs';
import { isLinkedInInvite } from './dashboard-web/server/lib/channels.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CORR_DIR = path.join(ROOT, 'data', 'target-talent-correspondence');
const APPLY = process.argv.includes('--apply');

const li = readLinkedInMap();
const ids = fs.existsSync(CORR_DIR)
  ? fs.readdirSync(CORR_DIR).filter(f => /^\d+\.md$/.test(f)).map(f => f.replace('.md', ''))
  : [];

let sawInvite = 0, advanced = 0, alreadyOk = 0;
const samples = [];
for (const id of ids) {
  const msgs = readTTCorrespondence(id);
  // Earliest SENT LinkedIn INVITE = the invite date. Detect via the canonical
  // channels.mjs signal (subject "LinkedIn connection request…" OR an explicit
  // LinkedIn channel token), NOT the parser's channel field — most legacy invites
  // were saved with the channel in the SUBJECT and read back as 'Email'.
  const sentLI = msgs
    .filter(m => m.direction === 'Sent' && isLinkedInInvite(m.subject))
    .map(m => (m.timestamp || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  if (!sentLI.length) continue;
  sawInvite++;
  const cur = (li[String(id)] && li[String(id)].state) || 'Not Connected';
  if (cur !== 'Not Connected') { alreadyOk++; continue; }
  advanced++;
  if (samples.length < 10) samples.push(`${id} → Invite Pending (${sentLI[0]})`);
  if (APPLY) markInvitePending(id, sentLI[0]);
}

console.log(`contacts with a saved Sent|LinkedIn invite: ${sawInvite}`);
console.log(`already Invite Pending / Connected:         ${alreadyOk}`);
console.log(`advanced Not Connected → Invite Pending:    ${advanced}`);
if (samples.length) console.log('examples:\n  ' + samples.join('\n  '));
console.log(APPLY ? '\nAPPLIED (data/tt-linkedin.json updated).' : '\nDRY RUN — pass --apply to write.');
