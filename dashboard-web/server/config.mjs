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

export const APPS_MD = path.resolve(__dirname, '../../data/applications.md');
export const REPORTS_DIR = path.resolve(__dirname, '../../reports');
export const STATIC = path.resolve(__dirname, '../src');
export const OUTPUT_DIR = path.resolve(__dirname, '../../output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

export const FOLLOWUPS_MD = path.resolve(__dirname, '../../data/follow-ups.md');
export const SNOOZE_PATH = path.resolve(__dirname, '../../data/followup-snooze.json');
export const APPLY_DATES_PATH = path.resolve(__dirname, '../../data/apply-dates.json');
export const MUTE_PATH = path.resolve(__dirname, '../../data/followup-mute.json');
export const APP_NOTES_PATH = path.resolve(__dirname, '../../data/app-notes.json');
export const STATUS_EVENTS_PATH = path.resolve(__dirname, '../../data/status-events.tsv');
export const RECRUITERS_MD = path.resolve(__dirname, '../../data/recruiters.md');
export const RECRUITER_CORR_DIR = path.resolve(__dirname, '../../data/recruiter-correspondence');
export const TARGET_TALENT_MD = path.resolve(__dirname, '../../data/target-talent.md');
export const TT_CORR_DIR = path.resolve(__dirname, '../../data/target-talent-correspondence');
export const LINKEDIN_SSI_DIR = path.resolve(__dirname, '../../data/linkedin-ssi');

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
export const CADENCE_PATH = path.resolve(__dirname, '../../data/cadence.json');
export const CADENCE_LOG_PATH = path.resolve(__dirname, '../../data/cadence-log.json');
export const TODOS_PATH = path.resolve(__dirname, '../../data/todos.json');

export const PORT = process.env.PORT || 3333;
// Bind to loopback by default so the dashboard (no auth, can spawn agents and
// read/write files) is not reachable from the local network. Set HOST=0.0.0.0
// to expose it on the LAN.
export const HOST = process.env.HOST || '127.0.0.1';
