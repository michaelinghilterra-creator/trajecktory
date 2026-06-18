// The workflow command manifest: the dashboard's morning-workflow buttons and
// the headless agent runner both shell out to these exact node commands.
const WORKFLOW_STEPS = {
  'discover':   { cmd: 'node discover.mjs',                   label: 'Expand Coverage',  summarize: discoverSummary },
  'api-scan':   { cmd: 'node scan.mjs',                       label: 'API Scan',         summarize: tailLines },
  'gate':       { cmd: 'node gate-pipeline.mjs',              label: 'Liveness Gate',    summarize: gateSummary },
  'merge':      { cmd: 'node merge-tracker.mjs',              label: 'Merge Tracker',    summarize: tailLines },
  'verify':     { cmd: 'node verify-actionable.mjs --apply',  label: 'Verify Actionable',summarize: verifySummary },
  'health':     { cmd: 'node verify-reports.mjs',             label: 'Health Check',     summarize: tailLines },
};

function discoverSummary(output) {
  const co   = (output.match(/New companies[^:]*:\s*(\d+)/i) || [])[1];
  const jobs = (output.match(/New job URLs[^:]*:\s*(\d+)/i) || [])[1];
  if (co == null && jobs == null) return tailLines(output);
  return `${co ?? '?'} new companies · ${jobs ?? '?'} new URLs`;
}

function tailLines(output) {
  return output.trim().split('\n').slice(-3).join('\n');
}

function gateSummary(output) {
  // No-work case: gate-pipeline exits early with this exact message
  if (/No pending .* items in pipeline\.md/i.test(output)) return 'Pipeline already empty — nothing to gate';
  // gate-pipeline prints "Live: N", "Dead: N", "Uncertain: N"
  const live = (output.match(/Live:\s+(\d+)/) || [])[1] || '?';
  const dead = (output.match(/Dead:\s+(\d+)/) || [])[1] || '?';
  const unc  = (output.match(/Uncertain:\s+(\d+)/) || [])[1] || '?';
  return `${live} live · ${dead} dead · ${unc} uncertain`;
}

function verifySummary(output) {
  if (/All checked entries are still live/i.test(output)) return 'All Evaluated entries still live';
  const m = output.match(/Flipped (\d+) entries/);
  return m ? `Discarded ${m[1]} dead links` : tailLines(output);
}


export { WORKFLOW_STEPS, discoverSummary, tailLines, gateSummary, verifySummary };

