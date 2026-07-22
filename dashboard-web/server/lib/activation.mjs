import fs from 'fs';
import { ACTIVATION_PATH } from '../config.mjs';

// ── Activation log ────────────────────────────────────────────────────────────
// Everything fixed in the 1.18-1.20 releases came out of one maintainer sitting
// on a five-hour screenshare watching one person install the product. That found
// a great deal, and it cost a day, and it does not repeat: with a second tester
// there is no way to learn where they stalled, and the most expensive finding of
// that whole session (two hours lost believing setup was mandatory) was invisible
// from the outside. Nobody files a bug that says "I misread a progress bar".
//
// So: record where time goes and whether the two moments that matter actually
// produced anything. Local, opt-in, and exportable, so a tester can send it back
// without anyone building a telemetry pipeline.
//
// ── THE RULE THAT MAKES THIS SAFE ────────────────────────────────────────────
// SHAPES AND COUNTS ONLY. NEVER VALUES.
//
// Log that a step finished and how long it took. Never which titles were picked,
// which companies were added, what the comp band is, or where the user lives. The
// whole file is designed so that a user can open it, read every line, and hand it
// over without having to trust anyone's judgement about what is in it.
//
// This is the same rule that governs commit messages here, and it is written down
// for the same reason: the instinct when describing a problem is to include the
// specifics that make it concrete, and that instinct is exactly what leaks. A
// field that carries a company name is one edit away at all times.
//
// Enforced two ways rather than by care alone:
//   1. `record()` accepts a fixed set of keys and coerces every value to a number
//      or a short enum. A string that is not in the allowed set is dropped.
//   2. tests/activation.test.mjs asserts that an attempt to log a company name,
//      a job title or a comp figure does not reach the file.
//
// Opt-in: nothing is written until the user turns it on. An off switch that is
// also the default means the file simply does not exist for anyone who has not
// asked for it, which is a stronger guarantee than a flag checked at read time.

const HEADER = 'ts\tevent\tstep\tms\tcount\tdetail\n';

// The only events worth recording, and the only ones permitted. An unknown event
// is dropped rather than written, so adding a new one is a deliberate edit here
// rather than something a caller can do in passing.
export const ACTIVATION_EVENTS = new Set([
  'setup_opened',      // the Launchpad was opened
  'step_viewed',       // a setup step was selected
  'step_completed',    // a setup step reached "complete"
  'handoff_started',   // a Claude Code prompt was copied
  'handoff_verified',  // the artifact that handoff should write actually appeared
  'handoff_missing',   // the user checked and nothing had been written
  'preview_run',       // "preview what this finds" was used
  'ready_shown',       // the "you can start now" banner was displayed
  'started_using',     // the user left setup for the pipeline
  'scan_finished',     // a scan completed
  'evaluate_finished', // an evaluate run completed
  'apply_finished',    // an apply completed
]);

// `detail` is an ENUM, never free text. This is the field most likely to grow a
// company name if it were a string, so it cannot be one.
const DETAILS = new Set(['ok', 'empty', 'error', 'skipped', '']);

// Step ids are a closed set too: they name UI sections, not user content.
const STEPS = new Set([
  'preflight', 'cv', 'identity', 'roles', 'edge', 'comp', 'location',
  'evaluation', 'companies', 'outputs', 'health', '',
]);

export function activationEnabled() {
  try { return fs.existsSync(ACTIVATION_PATH); } catch { return false; }
}

// Turning it on creates the file; turning it off deletes it. Deleting is the
// point: "stop recording" should also mean "and take away what was recorded",
// otherwise opting out leaves the data sitting there anyway.
export function setActivationEnabled(on) {
  try {
    if (on) {
      if (!fs.existsSync(ACTIVATION_PATH)) fs.writeFileSync(ACTIVATION_PATH, HEADER);
      return { enabled: true };
    }
    if (fs.existsSync(ACTIVATION_PATH)) fs.unlinkSync(ACTIVATION_PATH);
    return { enabled: false };
  } catch (e) {
    return { enabled: activationEnabled(), error: e.message };
  }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : '';
};

// Best-effort throughout: instrumentation must never throw into a real workflow,
// and a failure to record is always less bad than a failure to do the work.
export function record(event, { step = '', ms, count, detail = '' } = {}) {
  try {
    if (!ACTIVATION_EVENTS.has(event)) return false;
    if (!activationEnabled()) return false;
    const row = [
      new Date().toISOString(),
      event,
      STEPS.has(step) ? step : '',          // unknown step -> dropped, not written
      num(ms),
      num(count),
      DETAILS.has(detail) ? detail : '',    // unknown detail -> dropped
    ].join('\t') + '\n';
    fs.appendFileSync(ACTIVATION_PATH, row);
    return true;
  } catch {
    return false;
  }
}

export function readActivation() {
  try {
    if (!fs.existsSync(ACTIVATION_PATH)) return { enabled: false, rows: [] };
    const lines = fs.readFileSync(ACTIVATION_PATH, 'utf8').split('\n').slice(1).filter(Boolean);
    const rows = lines.map(l => {
      const [ts, event, step, ms, count, detail] = l.split('\t');
      return { ts, event, step, ms: ms ? Number(ms) : null, count: count ? Number(count) : null, detail };
    });
    return { enabled: true, rows };
  } catch (e) {
    return { enabled: activationEnabled(), rows: [], error: e.message };
  }
}

// A plain-language summary, so the maintainer reads conclusions rather than rows,
// and so the user can see for themselves what they would be sending.
export function summarizeActivation() {
  const { enabled, rows } = readActivation();
  if (!enabled || !rows.length) return { enabled, summary: null };

  const first = (e) => rows.find(r => r.event === e);
  const all = (e) => rows.filter(r => r.event === e);
  const t = (r) => (r ? Date.parse(r.ts) : NaN);

  const opened = first('setup_opened');
  const ready = first('ready_shown');
  const started = first('started_using');
  const mins = (a, b) => (Number.isFinite(t(a)) && Number.isFinite(t(b)) ? Math.round((t(b) - t(a)) / 60000) : null);

  const scans = all('scan_finished');
  const applies = all('apply_finished');

  return {
    enabled: true,
    summary: {
      minutesToReady: mins(opened, ready),
      minutesToFirstUse: mins(opened, started),
      // The number that mattered most in the session this was built from: how
      // long someone spends in setup AFTER the product is already usable.
      minutesSpentAfterReady: mins(ready, started),
      stepsCompleted: new Set(all('step_completed').map(r => r.step)).size,
      handoffsStarted: all('handoff_started').length,
      handoffsMissing: all('handoff_missing').length,
      previewsRun: all('preview_run').length,
      scansRun: scans.length,
      firstScanResults: scans.length ? scans[0].count : null,
      emptyScans: scans.filter(r => r.detail === 'empty').length,
      appliesRun: applies.length,
      failedApplies: applies.filter(r => r.detail === 'error').length,
    },
  };
}
