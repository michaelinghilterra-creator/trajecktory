import fs from 'fs';
import path from 'path';
import { ROOT_DIR, DEMO } from '../config.mjs';

const SETUP_ROOT = ROOT_DIR;
const SETUP_FILES = {
  cv:          'cv.md',
  profile:     'config/profile.yml',
  portals:     'portals.yml',
  modeProfile: 'modes/_profile.md',
  cvMaster:    'templates/cv-master.docx',
  pipeline:    'data/pipeline.md',
};

function setupFileMeta(rel) {
  try {
    const st = fs.statSync(path.join(SETUP_ROOT, rel));
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { exists: false, mtimeMs: 0, size: 0 };
  }
}
function setupReadText(rel) {
  try { return fs.readFileSync(path.join(SETUP_ROOT, rel), 'utf8'); }
  catch { return null; }
}

// Minimal YAML scalar reader — handles top-level `key:` and one level of
// nesting (`section:` then 2-space `key:`). Strips quotes and trailing inline
// comments. Intentionally tiny: we never parse the whole document, only the
// specific fields the forms read/write, which keeps comments untouched.
function setupGetScalar(text, section, key) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const stripVal = (raw) => {
    let v = raw.trim();
    if (v.startsWith('"') || v.startsWith("'")) {
      const q = v[0]; const end = v.indexOf(q, 1);
      if (end > 0) return v.slice(1, end);
    }
    const hash = v.indexOf(' #');
    if (hash >= 0) v = v.slice(0, hash).trim();
    return v;
  };
  if (!section) {
    for (const ln of lines) {
      const m = ln.match(new RegExp('^' + key + ':\\s*(.*)$'));
      if (m) return stripVal(m[1]);
    }
    return '';
  }
  let inSection = false;
  for (const ln of lines) {
    if (new RegExp('^' + section + ':\\s*$').test(ln)) { inSection = true; continue; }
    if (inSection) {
      if (/^\S/.test(ln)) break; // dedented to a new top-level block
      const m = ln.match(new RegExp('^\\s+' + key + ':\\s*(.*)$'));
      if (m) return stripVal(m[1]);
    }
  }
  return '';
}

// Does a `section:` then `key:` introduce a non-empty list (`- item`)?
function setupHasListItems(text, section, key) {
  if (!text) return false;
  const lines = text.split(/\r?\n/);
  let inSection = false, atKey = false, keyIndent = -1;
  for (const ln of lines) {
    if (!inSection) {
      if (new RegExp('^' + section + ':\\s*$').test(ln)) inSection = true;
      continue;
    }
    if (/^\S/.test(ln)) break;
    if (!atKey) {
      const m = ln.match(new RegExp('^(\\s+)' + key + ':\\s*$'));
      if (m) { atKey = true; keyIndent = m[1].length; }
      continue;
    }
    if (ln.trim() === '') continue;
    const indent = (ln.match(/^(\s*)/) || ['', ''])[1].length;
    if (indent <= keyIndent) break;
    if (/^\s*-\s+\S/.test(ln)) return true;
  }
  return false;
}

// Return the `- item` strings under a `section:` then nested `key:` (the values
// behind setupHasListItems). Used to show the user what's already configured
// (target roles, scanner titles) so a step never looks empty-but-done.
function setupGetList(text, section, key) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  let inSection = false, atKey = false, keyIndent = -1;
  const out = [];
  for (const ln of lines) {
    if (!inSection) {
      if (new RegExp('^' + section + ':\\s*$').test(ln)) inSection = true;
      continue;
    }
    if (/^\S/.test(ln)) break;
    if (!atKey) {
      const m = ln.match(new RegExp('^(\\s+)' + key + ':\\s*$'));
      if (m) { atKey = true; keyIndent = m[1].length; }
      continue;
    }
    if (ln.trim() === '') continue;
    const indent = (ln.match(/^(\s*)/) || ['', ''])[1].length;
    if (indent <= keyIndent) break;
    const im = ln.match(/^\s*-\s+(.*\S)\s*$/);
    if (im) {
      let v = im[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out.push(v);
    }
  }
  return out;
}

// Surgical scalar write: replace the value on an existing `key:` line (preserving
// its indentation), insert under an existing `section:`, or append a new section.
// Comment-safe for every line except the one value being changed.
function setupSetScalar(text, section, key, value) {
  const src = text == null ? '' : text;
  const eol = src.includes('\r\n') ? '\r\n' : '\n';   // preserve the file's EOL style
  const esc = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const quoted = `"${esc}"`;
  const lines = src.split(/\r?\n/);
  const out = () => lines.join(eol);

  if (!section) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp('^(' + key + ':)(.*)$'));
      if (m) { lines[i] = `${key}: ${quoted}`; return out(); }
    }
    lines.push(`${key}: ${quoted}`);
    return out();
  }

  let secStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^' + section + ':\\s*$').test(lines[i])) { secStart = i; break; }
  }
  if (secStart === -1) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`${section}:`, `  ${key}: ${quoted}`);
    return out();
  }
  let secEnd = lines.length;
  for (let i = secStart + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { secEnd = i; break; }
  }
  for (let i = secStart + 1; i < secEnd; i++) {
    const m = lines[i].match(new RegExp('^(\\s+)' + key + ':(.*)$'));
    if (m) { lines[i] = `${m[1]}${key}: ${quoted}`; return out(); }
  }
  lines.splice(secStart + 1, 0, `  ${key}: ${quoted}`);
  return out();
}

// Per-section structured-scalar field maps (profile.yml). Anything not here is
// captured generatively via a handoff prompt instead.
const SETUP_SCALAR_FIELDS = {
  identity: [
    ['candidate', 'full_name'], ['candidate', 'email'], ['candidate', 'phone'],
    ['candidate', 'location'], ['candidate', 'linkedin'], ['candidate', 'portfolio_url'],
    ['candidate', 'github'], ['candidate', 'twitter'],
  ],
  comp: [
    ['compensation', 'target_range'], ['compensation', 'minimum'], ['compensation', 'currency'],
  ],
  location: [
    ['location', 'country'], ['location', 'city'], ['location', 'timezone'], ['location', 'visa_status'],
  ],
  outputs: [
    ['outputs', 'resume_dir'], ['outputs', 'interview_prep_dir'],
  ],
};

function setupComputeState() {
  const meta = {};
  for (const [k, rel] of Object.entries(SETUP_FILES)) meta[k] = setupFileMeta(rel);
  const profile = setupReadText(SETUP_FILES.profile);
  const portals = setupReadText(SETUP_FILES.portals);
  const modeProfile = setupReadText(SETUP_FILES.modeProfile);
  const cv = setupReadText(SETUP_FILES.cv);

  // "You've seen it work" — at least one evaluation report exists in reports/.
  // (Top-level *.md only; reports/demo/ is a sample dir, not a real run.)
  const hasReport = (() => {
    try { return fs.readdirSync(path.join(SETUP_ROOT, 'reports')).some(f => /\.md$/i.test(f)); }
    catch { return false; }
  })();

  const PLACEHOLDERS = new Set(['', 'Jane Smith', 'jane@example.com']);
  const filled = (section, key) => {
    const v = setupGetScalar(profile, section, key);
    return v && !PLACEHOLDERS.has(v);
  };

  const sections = {
    preflight:  { kind: 'action' },
    cv:         { kind: 'file', status: (meta.cv.exists && meta.cv.size > 20) ? 'complete' : 'empty' },
    identity:   { kind: 'form', status: (filled('candidate', 'full_name') && filled('candidate', 'email')) ? 'complete' : 'empty' },
    roles:      { kind: 'gen',  status: setupHasListItems(profile, 'target_roles', 'primary') ? 'complete' : 'empty' },
    edge:       { kind: 'gen',  status: setupHasListItems(profile, 'narrative', 'superpowers') ? 'complete' : 'empty' },
    comp:       { kind: 'form', status: filled('compensation', 'target_range') ? 'complete' : 'empty' },
    location:   { kind: 'form', status: filled('location', 'city') ? 'complete' : 'empty' },
    evaluation: { kind: 'gen',  status: (modeProfile && /evaluation tuning/i.test(modeProfile)) ? 'complete' : 'empty' },
    companies:  { kind: 'gen',  status: (portals && /^\s*-\s+name:/m.test(portals)) ? 'complete' : 'empty' },
    outputs:    { kind: 'form', status: setupGetScalar(profile, 'outputs', 'resume_dir') ? 'complete' : 'empty' },
    firstEval:  { kind: 'action', status: hasReport ? 'complete' : 'empty' },
    health:     { kind: 'action' },
  };

  // The CV exists but no Word master was provided → tailored .docx resumes
  // can't be generated yet. Surface it so the UI can nudge a .docx upload.
  if (meta.cv.exists && !meta.cvMaster.exists) sections.cv.warning = 'no-master-docx';

  const values = {
    candidate: {
      full_name: setupGetScalar(profile, 'candidate', 'full_name'),
      email: setupGetScalar(profile, 'candidate', 'email'),
      phone: setupGetScalar(profile, 'candidate', 'phone'),
      location: setupGetScalar(profile, 'candidate', 'location'),
      linkedin: setupGetScalar(profile, 'candidate', 'linkedin'),
      portfolio_url: setupGetScalar(profile, 'candidate', 'portfolio_url'),
      github: setupGetScalar(profile, 'candidate', 'github'),
      twitter: setupGetScalar(profile, 'candidate', 'twitter'),
    },
    compensation: {
      target_range: setupGetScalar(profile, 'compensation', 'target_range'),
      minimum: setupGetScalar(profile, 'compensation', 'minimum'),
      currency: setupGetScalar(profile, 'compensation', 'currency'),
    },
    location: {
      country: setupGetScalar(profile, 'location', 'country'),
      city: setupGetScalar(profile, 'location', 'city'),
      timezone: setupGetScalar(profile, 'location', 'timezone'),
      visa_status: setupGetScalar(profile, 'location', 'visa_status'),
    },
    outputs: {
      resume_dir: setupGetScalar(profile, 'outputs', 'resume_dir') || 'output',
      interview_prep_dir: setupGetScalar(profile, 'outputs', 'interview_prep_dir') || 'interview-prep',
    },
    // Read-backs so the Launchpad can SHOW what's configured (not just "Done").
    configured: {
      targetRoles: [
        ...setupGetList(profile, 'target_roles', 'primary'),
        ...setupGetList(profile, 'target_roles', 'secondary'),
      ],
      scannerTitles: setupGetList(portals, 'title_filter', 'positive').length,
      locationPolicy: !!(portals && /^location_policy:/m.test(portals)),
      evalTuning: !!(modeProfile && /evaluation tuning/i.test(modeProfile)),
    },
  };

  const coreReady = meta.cv.exists && meta.profile.exists && meta.portals.exists && meta.modeProfile.exists;
  return { firstRun: !coreReady, demo: DEMO, files: meta, sections, values };
}

// Handoff prompt templates. Each returns a self-contained instruction the user
// pastes into their own Claude Code. They align with the AGENTS.md "First Run"
// steps and always restate the no-touch guardrail.
const SETUP_GUARDRAIL =
  'IMPORTANT: only edit config files (cv.md, config/profile.yml, portals.yml, modes/_profile.md, templates/cv-master.docx). ' +
  'Never modify data/applications.md, anything under reports/, or scan history.';

// Appended to every CV-entry prompt. The CV already contains identity, history,
// and skills, so one paste should set up the whole profile (as editable drafts)
// and get the user straight to evaluating jobs. The deterministic Launchpad forms
// then read these back, so the steps light up green without re-typing.
const SETUP_CV_FULL =
  ' Then, so I can start evaluating jobs right away, set up the rest of my profile FROM the CV as editable drafts I can refine later in the dashboard:' +
  ' (1) Identity — if config/profile.yml does not exist, create it from config/profile.example.yml, then fill candidate.full_name, email, phone, location, linkedin, github, and portfolio_url from the CV (leave blank anything the CV does not show).' +
  ' (2) Target roles — from my recent titles and trajectory, set target_roles.primary and target_roles.secondary to the roles I am most likely targeting next (a best guess I can adjust), and add archetypes with title_variants and resume_framing (summary_lead, aoe_priority).' +
  ' (3) Edge — draft narrative in config/profile.yml: a one-line headline, my top 3 superpowers, and 3 to 5 proof_points each with a hero metric, all drawn from the CV.' +
  ' (4) Location — fill location.country and location.city from the CV.' +
  ' (5) Scanner — if portals.yml does not exist, create it from templates/portals.example.yml, then set title_filter.positive and search_queries to match the target roles above; if modes/_profile.md does not exist, create it from modes/_profile.template.md.' +
  ' Leave compensation, visa status, and specific company picks for me to set later. Finish with a short summary of what you filled in so I can review it in the dashboard.';

// The CV step's friendly recap was a hit in testing, so end every paste-into-Claude
// step the same way — the user gets a clear "here's what changed" without guessing.
const SETUP_SUMMARY =
  ' When done, finish with a short, friendly summary of exactly what you changed and where, so I can review it in the dashboard.';

function setupHandoffPrompt(section) {
  switch (section) {
    case 'cv':
      return `Help me set up trajecktory from my CV. I will paste my resume text, share a LinkedIn URL, or have uploaded a .docx/.pdf into the project (check data/setup/ for the uploaded file). Convert it into a clean cv.md (Summary, Experience, Projects, Education, Skills). If I provided a .docx, also save it as templates/cv-master.docx so tailored Word resumes can be generated.${SETUP_CV_FULL} ${SETUP_GUARDRAIL}`;
    case 'cv-paste':
      return `I'm going to paste my CV text. Convert it into a clean cv.md with standard sections (Summary, Experience, Projects, Education, Skills).${SETUP_CV_FULL} ${SETUP_GUARDRAIL}`;
    case 'cv-linkedin':
      return `Here is my LinkedIn profile URL (pasted next). Extract my experience, skills, and education and draft a clean cv.md from it for me to review.${SETUP_CV_FULL} ${SETUP_GUARDRAIL}`;
    case 'cv-talk':
      return `Let's build my CV by talking it through. Ask me about my roles, scope, and biggest results, then draft a clean cv.md (Summary, Experience, Projects, Education, Skills).${SETUP_CV_FULL} ${SETUP_GUARDRAIL}`;
    case 'identity-certs':
      return `Read my cv.md and detect certifications / completed coursework. Write what you find into data/setup/certs.json under a "detected" array (each {name, issuer}) so the Launchpad can show them. Then merge any entries in that file's "items" array into config/profile.yml under credentials.certifications.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'roles':
      return `Read my picks in data/setup/roles.json (the "seniority" levels and "titles" I chose in the Launchpad). Populate config/profile.yml target_roles (primary/secondary) and archetypes (with title_variants and resume_framing), and regenerate portals.yml title_filter.positive, seniority_boost, and search_queries to match. Then suggest a few adjacent roles that widen my funnel and write them back into data/setup/roles.json under a "suggestions" array (each {title, why}) so I can pick them in the Launchpad.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'edge':
      return `Read my cv.md and draft my narrative for config/profile.yml: a one-line headline, my top 3 superpowers, and 3 to 5 proof points (each with a hero metric). Also fill resume_framing summary_lead and aoe_priority per archetype. Show me drafts to confirm.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'location':
      return `Help me build my scanner geo filter. FIRST, unless config/profile.yml already records my location preferences, ASK me (do not assume): am I after remote, hybrid, or on-site roles (or a mix), how far am I willing to commute, and are there any cities I will not work in? Save my answers to config/profile.yml location.policy. THEN geocode my home city and build portals.yml location_policy (home lat/lon, commute radius, metro_allow list) from those preferences.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'evaluation':
      return `Capture my evaluation priorities and deal-breakers into modes/_profile.md under an "Evaluation Tuning" section (what I optimize for, ranked; hard deal-breakers like company stage, excluded industries). If you are unsure of my priorities, ask me a couple of quick questions first rather than guessing. Mirror the deal-breakers into portals.yml title_filter.negative where they map to title/keyword exclusions.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'companies':
      return `Read data/setup/companies.json (my "radiusMiles" and any companies I added under "picks"). Suggest companies to track: (a) employers within my commute radius of home (use portals.yml location_policy.home lat/lon) and (b) companies in industries matching my target roles. Write suggestions back into data/setup/companies.json under a "suggestions" array (each {name, kind:"local"|"industry", meta, api:true|false}) so I can pick them in the Launchpad. For every company in "picks", resolve the careers_url and detect the ATS (Greenhouse/Ashby/Lever for free API scans) and APPEND to portals.yml tracked_companies. CRITICAL: merge only — preserve every existing entry, all "enabled: false # auto-disabled" states and their comments, retest-policy comments, notes, and scan_query tuning byte-for-byte.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    default:
      return `Continue trajecktory onboarding for the "${section}" step. ${SETUP_GUARDRAIL}`;
  }
}

// GET /api/setup/state — deterministic config-file state for the Launchpad.

export {
  SETUP_ROOT, SETUP_FILES, setupFileMeta, setupReadText,
  setupGetScalar, setupHasListItems, setupSetScalar, SETUP_SCALAR_FIELDS,
  setupComputeState, SETUP_GUARDRAIL, SETUP_CV_FULL, setupHandoffPrompt,
};

