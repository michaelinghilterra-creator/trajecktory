// Central configuration for the dashboard server: loads dashboard-web/.env,
// resolves the DEMO switch once, and exports every filesystem path the route
// and lib modules need. Extracted from index.mjs (M2-4) so the DEMO/path logic
// lives in exactly one place.
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

export const DEMO = process.env.DEMO === '1' || process.env.DEMO === 'true';
// Repo root (dashboard-web/server -> dashboard-web -> repo root).
export const ROOT_DIR = path.resolve(__dirname, '../..');

export const APPS_MD = DEMO
  ? path.resolve(__dirname, '../../data/demo/applications.md')
  : path.resolve(__dirname, '../../data/applications.md');
export const REPORTS_DIR = DEMO
  ? path.resolve(__dirname, '../../reports/demo')
  : path.resolve(__dirname, '../../reports');
if (DEMO) console.log('[trajecktory] DEMO mode — serving synthetic data');
export const STATIC = path.resolve(__dirname, '../src');
export const OUTPUT_DIR = path.resolve(__dirname, '../../output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

export const FOLLOWUPS_MD = DEMO
  ? path.resolve(__dirname, '../../data/demo/follow-ups.md')
  : path.resolve(__dirname, '../../data/follow-ups.md');
export const SNOOZE_PATH = DEMO
  ? path.resolve(__dirname, '../../data/demo/followup-snooze.json')
  : path.resolve(__dirname, '../../data/followup-snooze.json');
export const APPLY_DATES_PATH = DEMO
  ? path.resolve(__dirname, '../../data/demo/apply-dates.json')
  : path.resolve(__dirname, '../../data/apply-dates.json');
export const APP_NOTES_PATH = DEMO
  ? path.resolve(__dirname, '../../data/demo/app-notes.json')
  : path.resolve(__dirname, '../../data/app-notes.json');
export const STATUS_EVENTS_PATH = DEMO
  ? path.resolve(__dirname, '../../data/demo/status-events.tsv')
  : path.resolve(__dirname, '../../data/status-events.tsv');
export const RECRUITERS_MD = DEMO
  ? path.resolve(__dirname, '../../data/demo/recruiters.md')
  : path.resolve(__dirname, '../../data/recruiters.md');
export const RECRUITER_CORR_DIR = DEMO
  ? path.resolve(__dirname, '../../data/demo/recruiter-correspondence')
  : path.resolve(__dirname, '../../data/recruiter-correspondence');
export const TARGET_TALENT_MD = DEMO
  ? path.resolve(__dirname, '../../data/demo/target-talent.md')
  : path.resolve(__dirname, '../../data/target-talent.md');
export const TT_CORR_DIR = DEMO
  ? path.resolve(__dirname, '../../data/demo/target-talent-correspondence')
  : path.resolve(__dirname, '../../data/target-talent-correspondence');
export const LINKEDIN_SSI_DIR = DEMO
  ? path.resolve(__dirname, '../../data/demo/linkedin-ssi')
  : path.resolve(__dirname, '../../data/linkedin-ssi');

export const PORT = process.env.PORT || 3333;
// Bind to loopback by default so the dashboard (no auth, can spawn agents and
// read/write files) is not reachable from the local network. Set HOST=0.0.0.0
// to expose it on the LAN.
export const HOST = process.env.HOST || '127.0.0.1';
