#!/usr/bin/env node
// Read-only review of what the tracker says against what the data already holds. Changes nothing.
//   node report-data-review.mjs          human readable
//   node report-data-review.mjs --all    also list replies that are not rejections
//   node report-data-review.mjs --json   machine readable
// D-5: applications set to No Response although a logged employer reply is on record.
// D-9: interview overrides in the Work Search overrides file that cite no evidence.
import fs from 'node:fs';
import path from 'node:path';
import { parseApplicationsMd } from './dashboard-web/server/lib/applications.mjs';
import { readAppNotes } from './dashboard-web/server/lib/notes.mjs';
import { DATA_DIR, TWC_OVERRIDES_PATH } from './dashboard-web/server/config.mjs';
import { statusMismatchReport, overrideEvidenceGaps } from './lib/data-review.mjs';

function readOverrides() {
  try {
    const raw = JSON.parse(fs.readFileSync(TWC_OVERRIDES_PATH, 'utf8'));
    return Array.isArray(raw?.interviews) ? raw.interviews : [];
  } catch {
    return [];
  }
}

// Only a file reference can be checked here. A message id or calendar event id is trusted as written
// because checking it needs Gmail or Calendar; the report says so.
function resolveReference(kind, id) {
  if (kind !== 'file') return true;
  return fs.existsSync(path.resolve(DATA_DIR, '..', String(id))) || fs.existsSync(path.resolve(DATA_DIR, String(id)));
}

export function buildReview() {
  const applications = parseApplicationsMd();
  const byId = new Map(applications.map(app => [String(app.id), app]));
  const status = statusMismatchReport(applications.map(app => ({ id: app.id, status: app.status })), readAppNotes());
  const overrides = overrideEvidenceGaps(readOverrides(), resolveReference);
  return {
    status_mismatches: {
      checked: status.checked,
      with_messages: status.with_messages,
      items: status.mismatches.map(item => ({
        ...item,
        company: byId.get(String(item.application_id))?.company ?? '',
        role: byId.get(String(item.application_id))?.role ?? '',
      })),
    },
    override_evidence: overrides,
  };
}

function printReview(review, listAll = false) {
  const { status_mismatches: status, override_evidence: overrides } = review;
  console.log('Status check (No Response with an employer reply on record)');
  console.log(`  ${status.checked} applications are No Response; ${status.with_messages} of them have a logged reply.`);
  const rejections = status.items.filter(item => item.type === 'rejection_after_no_response');
  const replies = status.items.length - rejections.length;
  if (!status.items.length) console.log('  Nothing to review.');
  for (const item of listAll ? status.items : rejections) {
    const proposal = item.proposed ? `propose ${item.proposed.status} dated ${item.proposed.dated_on}` : 'no proposal, a person should read it';
    console.log(`  #${item.application_id} ${item.company} | ${item.role} | ${item.type} | ${proposal}`);
  }
  if (!listAll && replies) console.log(`  ${replies} more have a human reply that is not a rejection (most are receipts and acknowledgements). Run with --all to list them.`);
  console.log('  Dates are the day the reply was logged, which can be later than the day it arrived. Check the email.');
  console.log('');
  console.log('Override evidence (Work Search interview overrides)');
  console.log(`  ${overrides.ok} of ${overrides.total} cite evidence that resolves.`);
  for (const gap of overrides.gaps) {
    console.log(`  #${gap.appId} ${gap.stage} ${gap.date}: ${gap.reason}`);
  }
  console.log('  Message and calendar references are not checked against Gmail or Calendar here.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const review = buildReview();
  if (process.argv.includes('--json')) console.log(JSON.stringify(review, null, 2));
  else printReview(review, process.argv.includes('--all'));
}
