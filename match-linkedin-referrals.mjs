#!/usr/bin/env node
// match-linkedin-referrals.mjs — CLI for the LinkedIn warm-channel motion.
//
//   node match-linkedin-referrals.mjs import <path/to/Connections.csv>
//        Parse the export, store it as the haystack (data/linkedin-connections.json),
//        then reconcile with the Stage-2 referrer pool seeded (the initial big load).
//
//   node match-linkedin-referrals.mjs reconcile [--seed-pool]
//        Re-scan the stored haystack against the CURRENT active pipeline and
//        promote new warm paths. Run this after sourcing new JDs. Stage 1 only
//        unless --seed-pool. Idempotent: already-tracked contacts are skipped.
//
//   node match-linkedin-referrals.mjs status
//        Show what is stored.
//
// Same engine the dashboard's Reconcile button uses (server/lib/linkedin-referrals.mjs).
import { readFileSync } from 'node:fs';
import {
  parseConnectionsCsv, saveConnections, reconcile, linkedinStatus,
} from './dashboard-web/server/lib/linkedin-referrals.mjs';

const [cmd, ...rest] = process.argv.slice(2);

function printResult(r) {
  console.log(`  connections in haystack: ${r.connections}`);
  console.log(`  active pipeline companies: ${r.activeCompanies}`);
  console.log(`  Stage 1 promoted (inside an active company): ${r.stage1Added}`);
  console.log(`  Stage 2 promoted (referrer pool): ${r.stage2Added}${r.stage2Added ? '' : ` (${r.stage2Available} available — pass --seed-pool to add)`}`);
}

if (cmd === 'import') {
  const p = rest.find((a) => !a.startsWith('--'));
  if (!p) { console.error('Usage: node match-linkedin-referrals.mjs import <path/to/Connections.csv>'); process.exit(1); }
  const connections = parseConnectionsCsv(readFileSync(p, 'utf8'));
  if (!connections.length) { console.error('No connections parsed — is this a LinkedIn Connections.csv?'); process.exit(1); }
  saveConnections(connections, `import:${p}`);
  console.log(`Imported ${connections.length} connections into the haystack.`);
  const r = reconcile({ seedPool: true });
  printResult(r);
} else if (cmd === 'reconcile') {
  const r = reconcile({ seedPool: rest.includes('--seed-pool') });
  console.log('Reconciled LinkedIn haystack against the active pipeline.');
  printResult(r);
} else if (cmd === 'status') {
  const s = linkedinStatus();
  console.log(`Haystack: ${s.count} connections`);
  console.log(`Imported: ${s.importedAt || '(never)'}`);
  console.log(`Source:   ${s.source || '(none)'}`);
} else {
  console.log('Usage:\n  import <csv>     store an export + seed\n  reconcile [--seed-pool]   re-scan vs current pipeline\n  status           show what is stored');
  process.exit(cmd ? 1 : 0);
}
