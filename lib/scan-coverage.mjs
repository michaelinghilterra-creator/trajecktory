// scan-coverage.mjs — durable per-company scan-outcome tracking.
//
// WHY THIS EXISTS
// To the scanner, a dead/migrated ATS board and a live board with no matching
// openings are byte-identical: both return zero rows and leave no trace. So a
// company whose slug quietly 404s (a common outcome when it migrates Greenhouse
// -> Ashby) scans forever, returning nothing, and looks exactly like a healthy
// board that simply has no opening today. Coverage rot is invisible.
//
// This module keeps a company-keyed log of what each scan actually produced
// (found N / zero / http_404 / error / skipped_no_api) plus a consecutive-zero
// counter, mirroring the resolve-fail-counts.json pattern in resolve-jds.mjs. A
// definitive 404 is unambiguous and alerts immediately; a board that returns zero
// for GONE_QUIET_THRESHOLD consecutive scans is flagged "gone quiet" for human
// review. That converts silent coverage loss into a visible list.
//
// updateCoverage is pure (no fs) so it is unit-testable; scan.mjs owns the file
// read/write.

// Consecutive zero-result scans before a still-enabled board is flagged as
// possibly dead/migrated. A single zero is normal (no opening today); a long run
// of them is the signal that the slug, not the market, went quiet.
export const GONE_QUIET_THRESHOLD = 5;

/**
 * Fold this scan's per-company outcomes into the prior coverage map.
 *
 * @param {object} prev     coverage map from the last scan, keyed by board id
 * @param {Array}  outcomes [{ key, name, ats, result, found? }] where result is
 *                          'found' | 'zero' | 'http_404' | 'error' | 'skipped_no_api'
 * @param {string} date     YYYY-MM-DD of this scan
 * @returns {{ coverage: object, alerts: Array }}
 *          coverage: the updated map (companies absent from `outcomes` are carried
 *                    through untouched, so a --company run never skews the rest).
 *          alerts:   [{ key, name, ats, reason }] worth surfacing this run.
 */
export function updateCoverage(prev, outcomes, date) {
  const coverage = { ...(prev || {}) };
  const alerts = [];

  for (const o of outcomes || []) {
    const p = coverage[o.key] || {
      name: o.name, ats: o.ats, consecutiveZero: 0,
      lastFound: null, last404: null, lastOutcome: null, updated: null,
    };
    const rec = { ...p, name: o.name, ats: o.ats, lastOutcome: o.result, updated: date };

    switch (o.result) {
      case 'found':
        rec.consecutiveZero = 0;
        rec.lastFound = date;
        rec.found = o.found ?? 0;
        break;
      case 'zero':
        rec.consecutiveZero = (p.consecutiveZero || 0) + 1;
        rec.found = 0;
        if (rec.consecutiveZero >= GONE_QUIET_THRESHOLD) {
          alerts.push({
            key: o.key, name: o.name, ats: o.ats,
            reason: `gone quiet: ${rec.consecutiveZero} consecutive scans returned zero`,
          });
        }
        break;
      case 'http_404':
        // Unambiguous: the board is gone. Alert on the first occurrence.
        rec.last404 = date;
        alerts.push({
          key: o.key, name: o.name, ats: o.ats,
          reason: 'board returns HTTP 404 (dead or migrated slug)',
        });
        break;
      case 'error':
        // Transient (network / rate limit). Do NOT count it as a zero — a blip
        // must not accumulate toward "gone quiet" and mask a genuinely live board.
        break;
      case 'skipped_no_api':
        // Tracked but never scanned (bespoke page / unsupported ATS). Recorded so
        // the roster is complete; not alerted per-company (scan.mjs prints the
        // aggregate), because there can be dozens and they are a known backlog.
        break;
      default:
        break;
    }

    coverage[o.key] = rec;
  }

  return { coverage, alerts };
}
