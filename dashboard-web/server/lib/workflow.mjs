// The workflow command manifest: the dashboard's morning-workflow buttons and
// the headless agent runner both shell out to these exact node commands.
const WORKFLOW_STEPS = {
  'discover':   { cmd: 'node discover.mjs',                   label: 'Expand Coverage',  summarize: discoverSummary },
  'api-scan':   { cmd: 'node scan.mjs',                       label: 'API Scan',         summarize: scanSummary },
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

// scan.mjs prints a funnel (Total jobs found / Filtered by title / Geo-blocked /
// Stale / Duplicates / New offers added). tailLines only showed the last lines,
// so a healthy scan that adds 0 new looked broken. Surface the whole funnel so
// "0 new" reads as "found thousands, filtered down" instead of "nothing worked".
function scanSummary(output) {
  const grab = (re) => { const m = output.match(re); return m ? Number(m[1]) : null; };
  const found    = grab(/Total jobs found:\s*(\d+)/i);
  const offTitle = grab(/Filtered by title:\s*(\d+)/i);
  const geo      = grab(/Geo-blocked:\s*(\d+)/i);
  const stale    = grab(/Stale[^:]*:\s*(\d+)/i);
  const dupes    = grab(/Duplicates:\s*(\d+)/i);
  const added    = grab(/New offers added:\s*(\d+)/i);

  // GUARD: nothing was even queried because no ENABLED company has a scannable
  // ATS API. Without this the summary read "0 new (of 0 found)", which looks like
  // a scan that ran and found nothing — indistinguishable from a config problem.
  // An agent that disables the Greenhouse/Ashby/Lever companies (leaving only
  // Workday/websearch ones) silently neuters the free API Scan, exactly the case
  // that stumped a beta tester. Name the cause and the two fixes.
  const scanned  = grab(/Companies scanned:\s*(\d+)/i);
  const hdr      = output.match(/Scanning\s+(\d+)\s+companies via API\s*\((\d+)\s+skipped/i);
  const scannedN = scanned != null ? scanned : (hdr ? Number(hdr[1]) : null);
  const skippedNoApi = hdr ? Number(hdr[2]) : null;
  if (scannedN === 0) {
    const why = skippedNoApi
      ? `all ${skippedNoApi} enabled ${skippedNoApi === 1 ? 'company has' : 'companies have'} no scannable ATS API`
      : 'no enabled company has a scannable ATS API';
    return `⚠ 0 companies scanned — ${why}. Enable Greenhouse/Ashby/Lever companies in portals.yml, or run Agent Scan.`;
  }

  if (found == null && added == null) return tailLines(output);
  const n = (x) => (x == null ? '?' : x.toLocaleString('en-US'));

  // Scanned real companies but every board came back empty — dead slugs, empty
  // boards, or blocked fetches. Distinct from "0 companies scanned" above: here
  // the config is fine, the fetches are not, so point at the per-company errors.
  if (found === 0) {
    return `⚠ 0 jobs found across ${n(scannedN)} ${scannedN === 1 ? 'company' : 'companies'} — boards may be empty, ATS slugs dead, or fetches blocked. Check the per-company errors.`;
  }

  const filtered = [];
  if (offTitle) filtered.push(`${n(offTitle)} off-title`);
  if (dupes)    filtered.push(`${n(dupes)} duplicates`);
  if (geo)      filtered.push(`${n(geo)} geo-blocked`);
  if (stale)    filtered.push(`${n(stale)} stale`);
  const funnel = filtered.length
    ? ` (of ${n(found)} found: ${filtered.join(', ')})`
    : (found != null ? ` (of ${n(found)} found)` : '');
  return `${n(added)} new${funnel}`;
}

function gateSummary(output) {
  // No-work case: gate-pipeline exits early with this exact message
  if (/No pending .* items in pipeline\.md/i.test(output)) return 'Pipeline already empty, nothing to gate';
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


export { WORKFLOW_STEPS, discoverSummary, tailLines, scanSummary, gateSummary, verifySummary };

