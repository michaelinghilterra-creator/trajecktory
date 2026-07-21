import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ROOT_DIR } from '../config.mjs';

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

// Best-effort YAML parse for the read-back summaries (never throws — a malformed
// file just falls back to the boolean/regex completion checks).
function setupParseYaml(text) {
  try { return text ? yaml.load(text) : null; } catch { return null; }
}

// Pull the "Evaluation Tuning" markdown section out of modes/_profile.md and split
// it into the ranked priorities and the hard deal-breakers, so the Launchpad can
// show the user what their score is actually tuned for. Markdown, not YAML, so it
// gets its own tiny extractor. Returns null when the section is absent.
function setupParseEvalTuning(md) {
  if (!md) return null;
  const lines = md.split('\n');
  const start = lines.findIndex(l => /^#{1,6}\s.*evaluation tuning/i.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^#{1,6}\s/.test(lines[i])) { end = i; break; } }
  const priorities = [], dealBreakers = [];
  let bucket = null;
  for (const l of lines.slice(start + 1, end)) {
    if (/\*\*/.test(l) && /priorit/i.test(l)) { bucket = priorities; continue; }
    if (/\*\*/.test(l) && /(deal.?breaker|hard no)/i.test(l)) { bucket = dealBreakers; continue; }
    const m = l.match(/^\s*(?:\d+\.|[-*])\s+(.*\S)/);
    if (m && bucket) bucket.push(m[1].replace(/\([^)]*\)/g, '').replace(/`/g, '').trim());
  }
  return (priorities.length || dealBreakers.length) ? { priorities, dealBreakers } : null;
}

// Suggested default output folder under the user's Documents (e.g.
// C:\Users\me\Documents\trajecktory resumes). Falls back to a relative dir when
// the home path can't be resolved (headless/odd environments).
function setupDefaultOutputDir(name, fallback) {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return home ? path.join(home, 'Documents', name) : fallback;
}

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
      // Default the two output folders to the user's Documents so a non-technical
      // user gets sensible, findable locations out of the box (they can still
      // change them). Falls back to relative dirs if the home path is unknown.
      resume_dir: setupGetScalar(profile, 'outputs', 'resume_dir') || setupDefaultOutputDir('trajecktory resumes', 'output'),
      interview_prep_dir: setupGetScalar(profile, 'outputs', 'interview_prep_dir') || setupDefaultOutputDir('trajecktory interview prep', 'interview-prep'),
    },
    // Read-backs so the Launchpad can SHOW what each customizable section
    // actually configured (not just "Done"), so the user can review and tweak
    // with confidence. Nested structures are read via a best-effort YAML parse;
    // the booleans below stay as a fallback for malformed files.
    configured: (() => {
      const P = setupParseYaml(portals) || {};
      const Pr = setupParseYaml(profile) || {};
      // location_policy lives nested under title_filter in portals.yml (the scanner
      // reads it from there); fall back to a top-level key just in case.
      const lp = (P.title_filter && P.title_filter.location_policy) || P.location_policy || {};
      const tr = Pr.target_roles || {};
      const nar = Pr.narrative || {};
      const cos = Array.isArray(P.tracked_companies) ? P.tracked_companies : [];
      const arr = v => Array.isArray(v) ? v : [];
      return {
        targetRoles: [
          ...setupGetList(profile, 'target_roles', 'primary'),
          ...setupGetList(profile, 'target_roles', 'secondary'),
        ],
        // Two DIFFERENT quantities used to share one label, and the mismatch read
        // as a broken counter: the chip list above shows the titles the user
        // picked (from data/setup/roles.json), while this counts the keyword
        // variants the roles handoff generated from them into
        // portals.yml title_filter.positive. Seeing "8 titles" beside "23" with
        // no way to inspect the 23 cost a tester their trust in the whole
        // mechanism ("can't trust this b/c the numbers don't tie off").
        // Ship the keywords themselves, not just a count, so the relationship is
        // inspectable rather than asserted.
        scannerTitles: setupGetList(portals, 'title_filter', 'positive').length,
        scannerKeywords: setupGetList(portals, 'title_filter', 'positive'),
        locationPolicy: !!(lp.home || (Array.isArray(lp.hard_no) && lp.hard_no.length)),
        evalTuning: !!(modeProfile && /evaluation tuning/i.test(modeProfile)),
        // Rich read-backs (best-effort; null when absent/unparseable):
        archetypes: arr(tr.archetypes).map(a => a && a.name).filter(Boolean),
        edge: (nar.headline || arr(nar.superpowers).length || arr(nar.proof_points).length) ? {
          headline: nar.headline || null,
          superpowers: arr(nar.superpowers).length,
          proofPoints: arr(nar.proof_points).length,
        } : null,
        location: (lp.home || arr(lp.hard_no).length || arr(lp.metro_allow).length) ? {
          home: (lp.home && lp.home.city) || null,
          radiusMiles: (lp.home && lp.home.commute_radius_miles) != null ? lp.home.commute_radius_miles : null,
          allow: [...arr(lp.dfw_core), ...arr(lp.metro_allow)],
          hybridRemoteOnly: arr(lp.hybrid_remote_only),
          hardNo: arr(lp.hard_no),
        } : null,
        evaluation: setupParseEvalTuning(modeProfile),
        companies: cos.length ? {
          count: cos.length,
          names: cos.map(c => c && c.name).filter(Boolean).slice(0, 8),
        } : null,
      };
    })(),
  };

  const coreReady = meta.cv.exists && meta.profile.exists && meta.portals.exists && meta.modeProfile.exists;
  return { firstRun: !coreReady, demo: false, files: meta, sections, values };
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
  ' Leave compensation, visa status, and specific company picks blank for now. Finish with a short, friendly summary of what you filled in. IMPORTANT for that summary: do NOT tell me to hand-edit config/profile.yml or any file. Every remaining field (compensation, visa, GitHub, company picks) is editable right in the dashboard Setup tab, so just note which are still blank and that I can fill them there. Do NOT end with a "Next Steps" list and do NOT tell me to run any terminal or CLI commands (no npm start, no /trajecktory scan, no pasting a URL into the CLI). My trajecktory dashboard is already open in my browser, so just give the friendly summary and point me back to the dashboard itself (the Setup tab to refine anything, then the Pipeline to start evaluating roles) to continue.';

// The CV step's friendly recap was a hit in testing, so end every paste-into-Claude
// step the same way — the user gets a clear "here's what changed" without guessing.
const SETUP_SUMMARY =
  ' When done, finish with a short, friendly summary of exactly what you changed and where, so I can review it in the dashboard.';

// Appended to every step that asks the user to choose something. Nudges the agent
// (Claude Desktop / Claude Code) to use the interactive option picker (the
// AskUserQuestion tool) so the user clicks selectable choices instead of typing
// free text — the "little pop-up box" testers liked and missed when an agent
// fell back to prose. It's a strong nudge, not a guarantee (the model still
// decides), but it makes the structured UI the default for known-answer questions.
const SETUP_ASK_UI =
  ' When you need a decision from me, ASK with a structured multiple-choice question: use the AskUserQuestion tool (the option picker) and present the likely answers as selectable options I can click, rather than asking in plain prose. Use it for every question that has a small, known set of answers (e.g. remote/hybrid/on-site, yes/no, pick-from-a-list); fall back to free text only for genuinely open-ended ones.';

function setupHandoffPrompt(section) {
  switch (section) {
    case 'cv':
      return `Help me set up trajecktory from my CV. I will paste my resume text, share a LinkedIn URL, or have uploaded a .docx/.pdf into the project (check data/setup/ for the uploaded file). Convert it into a clean cv.md (Summary, Experience, Projects, Education, Skills). If I provided a .docx, also save it as templates/cv-master.docx so tailored Word resumes can be generated.${SETUP_CV_FULL} ${SETUP_GUARDRAIL}`;
    case 'cv-paste':
      return `I'm going to paste my CV text. Convert it into a clean cv.md with standard sections (Summary, Experience, Projects, Education, Skills).${SETUP_CV_FULL} ${SETUP_GUARDRAIL}`;
    case 'cv-linkedin':
      return `Here is my LinkedIn profile URL (pasted next). Extract my experience, skills, and education and draft a clean cv.md from it for me to review.${SETUP_CV_FULL} ${SETUP_GUARDRAIL}`;
    case 'cv-talk':
      return `Let's build my CV by talking it through. Ask me about my roles, scope, and biggest results, then draft a clean cv.md (Summary, Experience, Projects, Education, Skills).${SETUP_CV_FULL}${SETUP_ASK_UI} ${SETUP_GUARDRAIL}`;
    case 'identity-certs':
      return `Read my cv.md and detect certifications / completed coursework. Write what you find into data/setup/certs.json under a "detected" array (each {name, issuer}) so the Launchpad can show them. Then merge any entries in that file's "items" array into config/profile.yml under credentials.certifications.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'roles':
      return `Read my picks in data/setup/roles.json (the "seniority" levels and "titles" I chose in the Launchpad). Populate config/profile.yml target_roles (primary/secondary) and archetypes (with title_variants and resume_framing), and regenerate portals.yml title_filter.positive, seniority_boost, and search_queries to match. Then suggest AT LEAST 15 adjacent roles that widen my funnel and write them back into data/setup/roles.json under a "suggestions" array (each {title, why}) so I can pick them in the Launchpad. Aim wide, not safe: include the different names employers give the SAME job (a title that varies by company is the most common reason a scanner misses a good posting), one level up and one level down, and adjacent functions I could credibly move into. I would rather reject 10 of your suggestions than never see the one that was worded differently.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'edge':
      return `Read my cv.md and draft my narrative for config/profile.yml: a one-line headline, my top 3 superpowers, and 3 to 5 proof points (each with a hero metric). Also fill resume_framing summary_lead and aoe_priority per archetype. Show me drafts to confirm.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'location':
      return `Help me build my scanner geo filter. FIRST, unless config/profile.yml already records my location preferences, ASK me (do not assume): am I after remote, hybrid, or on-site roles (or a mix), how far am I willing to commute, and are there any cities I will not work in? Save my answers to config/profile.yml location.policy. THEN geocode my home city and build portals.yml location_policy from those preferences, using these keys exactly:` +
        ' home (lat, lon, commute_radius_miles);' +
        ' home_region — the tokens that mark a posting as being in my home state or region, lowercase, including the abbreviation forms an ATS actually prints (for Ohio: ["ohio", " oh", ", oh"]);' +
        ' home_core — my home city and any city I would commute to without hesitation;' +
        ' metro_allow — the suburbs and satellite towns in my metro;' +
        ' flexible_only — cities I would take ONLY as remote or hybrid, never fully onsite;' +
        ' region_city_coords — {name, lat, lon} for the notable cities in my region, so the commute radius can actually be measured;' +
        ' hard_no — cities or metros I will never work in.' +
        ' home_region is the one that matters most and is easy to skip: without it the commute radius can never be applied and every onsite role outside the named lists is dropped, so set it even if the rest are short.' +
        ' Do NOT use the older Texas-specific key names (dfw_core, hybrid_remote_only, tx_city_coords) for a new policy; they are read only as legacy aliases.' +
        `${SETUP_ASK_UI}${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'evaluation':
      return `Capture my evaluation priorities and deal-breakers into modes/_profile.md under an "Evaluation Tuning" section (what I optimize for, ranked; hard deal-breakers like company stage, excluded industries). If you are unsure of my priorities, ask me a couple of quick questions first rather than guessing. Mirror the deal-breakers into portals.yml title_filter.negative where they map to title/keyword exclusions.${SETUP_ASK_UI}${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
    case 'companies':
      return `Read data/setup/companies.json (my "radiusMiles" and any companies I added under "picks"). Suggest AT LEAST 30 companies to track: (a) employers within my commute radius of home (use portals.yml location_policy.home lat/lon) and (b) companies in industries matching my target roles. Spread them across employer TYPES, not just the famous names — established large employers, mid-size firms, regional employers, and the non-tech companies that still hire my target role (hospitals, banks, insurers, retailers, manufacturers, universities, government and utilities all employ the same functions). A list that is all one sector is a failed list: it produces a scan with almost no results, which is the single most common bad first experience with this product. Write suggestions back into data/setup/companies.json under a "suggestions" array (each {name, kind:"local"|"industry", meta, api:true|false}) so I can pick them in the Launchpad. For every company in "picks", resolve the careers_url and detect the ATS (Greenhouse/Ashby/Lever for free API scans) and APPEND to portals.yml tracked_companies. CRITICAL: merge only — preserve every existing entry, all "enabled: false # auto-disabled" states and their comments, retest-policy comments, notes, and scan_query tuning byte-for-byte. CRITICAL: before appending, check whether the company is ALREADY tracked and skip it if so — match on company name as well as ATS slug, not on the careers_url, because a company that migrated ATS (Greenhouse "meetelise" to Ashby "eliseai") is already tracked under a different host and re-adding it creates a second row pointing at a dead board. Entries with "enabled: false" still count as tracked; they are tombstones and must not be re-added.${SETUP_SUMMARY} ${SETUP_GUARDRAIL}`;
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

