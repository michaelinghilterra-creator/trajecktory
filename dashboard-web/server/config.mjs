// Central configuration for the dashboard server: loads dashboard-web/.env and
// exports every filesystem path the route and lib modules need. Extracted from
// index.mjs (M2-4) so the path logic lives in exactly one place.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the dashboard-web directory (one level up from server/).
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// Repo root (dashboard-web/server -> dashboard-web -> repo root).
export const ROOT_DIR = path.resolve(__dirname, '../..');

// Every user-layer data file lives under one directory, overridable with
// TJK_DATA_DIR. The override exists so tests can exercise the write paths
// (status events, apply dates, todos) against a temp dir instead of the user's
// real job search: data/ is gitignored end to end, so a test that wrote there
// would have no way back. Deliberately NOT mkdir'd — a typo in the env var
// should fail loudly on first read, not silently create a stray directory.
export const DATA_DIR = process.env.TJK_DATA_DIR
  ? path.resolve(process.env.TJK_DATA_DIR)
  : path.resolve(__dirname, '../../data');

export const APPS_MD = path.join(DATA_DIR, 'applications.md');
export const REPORTS_DIR = path.resolve(__dirname, '../../reports');
export const STATIC = path.resolve(__dirname, '../src');
export const OUTPUT_DIR = path.resolve(__dirname, '../../output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

export const FOLLOWUPS_MD = path.join(DATA_DIR, 'follow-ups.md');
export const SNOOZE_PATH = path.join(DATA_DIR, 'followup-snooze.json');
export const APPLY_DATES_PATH = path.join(DATA_DIR, 'apply-dates.json');
export const MUTE_PATH = path.join(DATA_DIR, 'followup-mute.json');
export const APP_NOTES_PATH = path.join(DATA_DIR, 'app-notes.json');
export const STATUS_EVENTS_PATH = path.join(DATA_DIR, 'status-events.tsv');
// Google OAuth tokens (refresh/access token, granted scopes, connected email) and
// the Gmail read-scan cursor (which message ids have already been processed, so a
// re-scan is idempotent). Both are gitignored personal data under DATA_DIR.
export const GOOGLE_TOKENS_PATH = path.join(DATA_DIR, 'google-tokens.json');
export const GOOGLE_SYNC_PATH = path.join(DATA_DIR, 'google-sync.json');
// Weekly review with teeth: the append-only review log, the build-lock state it
// can engage, and a manual LinkedIn-connects tally (connections are sent by hand,
// so the count is logged here). All gitignored personal data under DATA_DIR.
export const REVIEW_LOG_PATH = path.join(DATA_DIR, 'review-log.json');
export const BUILD_LOCK_PATH = path.join(DATA_DIR, 'build-lock.json');
export const CONNECTS_PATH = path.join(DATA_DIR, 'linkedin-connects.json');
// Activation log: how long setup took and whether the first scan and first apply
// actually produced anything. Opt-in, local, and shape-only (see lib/activation.mjs).
export const ACTIVATION_PATH = path.join(DATA_DIR, 'activation-log.tsv');
export const RECRUITERS_MD = path.join(DATA_DIR, 'recruiters.md');
export const RECRUITER_CORR_DIR = path.join(DATA_DIR, 'recruiter-correspondence');
export const TARGET_TALENT_MD = path.join(DATA_DIR, 'target-talent.md');
export const TT_CORR_DIR = path.join(DATA_DIR, 'target-talent-correspondence');
export const LINKEDIN_SSI_DIR = path.join(DATA_DIR, 'linkedin-ssi');

// "Interview" tab: the per-company prep folders (and their .run.md board
// sidecars). NOT a fixed path — the Launchpad writes outputs.interview_prep_dir
// into config/profile.yml, so a user who redirected their prep folder (commonly
// to Documents\trajecktory interview prep) would otherwise get an empty tab
// while their files sit somewhere else. Resolution mirrors resolveDir() in
// organize-interview-prep.mjs exactly: same regex, same first-match-wins scan,
// same relative-to-repo-root join, same interview-prep/ fallback. Read with a
// line regex rather than a YAML parse so a profile that is mid-edit (and not
// valid YAML) still boots the server on the default.
function resolveInterviewPrepDir() {
  // TJK_INTERVIEW_PREP_DIR mirrors TJK_DATA_DIR and exists for the same reason:
  // interview-prep/ is gitignored user data, so a test that wrote there would
  // corrupt real interview notes with no way back. Checked before profile.yml so
  // a test can redirect regardless of what the user has configured.
  const override = process.env.TJK_INTERVIEW_PREP_DIR;
  if (override) return path.isAbsolute(override) ? override : path.join(ROOT_DIR, override);
  try {
    const profile = path.join(ROOT_DIR, 'config', 'profile.yml');
    if (fs.existsSync(profile)) {
      for (const line of fs.readFileSync(profile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*interview_prep_dir:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
        if (m) {
          const v = m[1].trim();
          if (v) return path.isAbsolute(v) ? v : path.join(ROOT_DIR, v);
        }
      }
    }
  } catch { /* unreadable or half-written profile — fall through to the default */ }
  return path.join(ROOT_DIR, 'interview-prep');
}
// Never mkdir'd: this is a read-only surface, and "the folder does not exist
// yet" is a legitimate empty state, not something to paper over on boot.
export const INTERVIEW_PREP_DIR = resolveInterviewPrepDir();

// "Today" tab: weekly cadence template, its per-day completion log, and the to-do list.
export const CADENCE_PATH = path.join(DATA_DIR, 'cadence.json');
export const CADENCE_LOG_PATH = path.join(DATA_DIR, 'cadence-log.json');
export const TODOS_PATH = path.join(DATA_DIR, 'todos.json');

export const PORT = process.env.PORT || 3333;
// Bind to loopback by default so the dashboard (no auth, can spawn agents and
// read/write files) is not reachable from the local network. Set HOST=0.0.0.0
// to expose it on the LAN.
export const HOST = process.env.HOST || '127.0.0.1';
