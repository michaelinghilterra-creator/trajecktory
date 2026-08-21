#!/usr/bin/env node
// backfill-linkedin-status.mjs — one-shot repair that advances the LinkedIn status
// axis (tt-linkedin.json) to 'Invite Pending' for any contact with an invite already
// recorded in correspondence but a stale 'Not Connected' status. The same logic now
// self-heals on every Follow-Ups queue load (see lib/invite-status-reconcile.mjs); this
// CLI is the manual/first-run entry point. Dry-run by default; --apply writes.
import { reconcileInviteStatus } from './dashboard-web/server/lib/invite-status-reconcile.mjs';

const APPLY = process.argv.includes('--apply');
const r = reconcileInviteStatus({ apply: APPLY });

console.log(`Not-Connected contacts scanned:              ${r.scanned}`);
console.log(`advanced Not Connected -> Invite Pending:    ${r.advanced}`);
if (r.ids.length) console.log(`ids: ${r.ids.slice(0, 15).join(', ')}${r.ids.length > 15 ? ` … (+${r.ids.length - 15})` : ''}`);
console.log(APPLY ? '\nAPPLIED (data/tt-linkedin.json updated).' : '\nDRY RUN — pass --apply to write.');
