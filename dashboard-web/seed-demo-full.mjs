#!/usr/bin/env node
// Comprehensive demo data seeder for the trajecktory dashboard.
// Builds a "dedicated user, 3 months into a structured search" dataset
// across every tab:
//   - applications.md: 80+ entries spanning the full funnel and 90 days
//   - reports/demo/*.md: stub report per app
//   - follow-ups.md: ~40 logged touches driving the cadence engine
//   - target-talent.md: 35 contacts, balanced statuses + lastTouch
//   - target-talent-correspondence/*.md: ~22 contacts with real threads
//   - linkedin-ssi/*: 8 weeks of upward-trending engagement data
//   - recruiters.md + correspondence: left intact (seeded separately)
//
// Run: node seed-demo-full.mjs
// Then: DEMO=1 npm run dev   (or preview profile career-ops-demo)
//
// Deterministic — same seed → same output. Re-runnable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APPS_MD = path.join(ROOT, 'data', 'demo', 'applications.md');
const REPORTS_DIR = path.join(ROOT, 'reports', 'demo');
const FU_MD = path.join(ROOT, 'data', 'demo', 'follow-ups.md');
const TA_MD = path.join(ROOT, 'data', 'demo', 'target-talent.md');
const TA_CORR_DIR = path.join(ROOT, 'data', 'demo', 'target-talent-correspondence');
const SSI_DIR = path.join(ROOT, 'data', 'demo', 'linkedin-ssi');

// ─── Seeded RNG ────────────────────────────────────────────────────────────
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260607);
const pick = arr => arr[Math.floor(rand() * arr.length)];

// ─── Dates ─────────────────────────────────────────────────────────────────
const TODAY = new Date('2026-06-07T10:00:00Z');
function daysAgo(n) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function fmtDay(d) { return d.toISOString().slice(0, 10); }
function fmtTs(d) { return d.toISOString().replace('T', ' ').slice(0, 16); }

// ─── Existing apps 1-30 (keep these — well-written notes) ──────────────────
// We'll read these from the existing file. New apps start at 31.
function readExistingApps() {
  if (!fs.existsSync(APPS_MD)) return [];
  const text = fs.readFileSync(APPS_MD, 'utf8');
  const apps = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| #') || line.startsWith('|---')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 10) continue;
    const id = parseInt(parts[1], 10);
    if (isNaN(id)) continue;
    apps.push({
      id,
      date: parts[2],
      company: parts[3],
      role: parts[4],
      score: parts[5],
      status: parts[6],
      pdf: parts[7],
      resume: parts[8],
      report: parts[9],
      notes: parts[10] || '',
      _raw: line,
    });
  }
  return apps;
}

// ─── New apps to add (31-90) ───────────────────────────────────────────────
// Realistic distribution of a dedicated 3-month search:
//   ~25 Discarded   (triaged before applying — quality bar)
//   ~12 SKIP        (interesting but wrong fit/comp/location)
//   ~6 Closed       (posting expired before action)
//   ~8 Rejected     (made it into a cycle, got cut)
//   ~3 Evaluated    (review queue — hot leads waiting for decision)
//   ~6 newer Applied (recent submissions, in cycle)
const NEW_COMPANIES = [
  // Real-feel SaaS / RevOps-flavored companies (synthetic names)
  ['Veridian Robotics',     'Series C',  'Industrial AI'],
  ['Quill Insurance',       'Series D',  'InsurTech'],
  ['Tessellate Cloud',      'Series B',  'Data Infra'],
  ['Lumina Health',         'Series C',  'HealthTech'],
  ['Drayton Capital',       'Series D',  'FinTech'],
  ['Kestrel Logistics',     'Series B',  'Logistics SaaS'],
  ['Auralis Media',         'Series C',  'Adtech'],
  ['Anvil HR',              'Series A',  'HR Tech'],
  ['Cobalt Climate',        'Series B',  'ClimateTech'],
  ['Riftline Networks',     'Series C',  'Cybersecurity'],
  ['Northgate Education',   'Series B',  'EdTech'],
  ['Stratum Geo',           'Series C',  'Geospatial'],
  ['Embargo Defense',       'Series B',  'GovTech'],
  ['Fjord Retail',          'Series D',  'Commerce SaaS'],
  ['Polaris BioSciences',   'Series C',  'Biotech'],
  ['Cardinal Gaming',       'Series B',  'Gaming'],
  ['Topograph Travel',      'Series B',  'Travel SaaS'],
  ['Sundial Energy',        'Series C',  'EnergyTech'],
  ['Foundry Hospitality',   'Series B',  'Hospitality SaaS'],
  ['Ledgerline Crypto',     'Series B',  'Crypto'],
  ['Verdure AgriTech',      'Series A',  'AgTech'],
  ['Marble Marketplaces',   'Series D',  'Marketplaces'],
  ['Antarctic Streaming',   'Series C',  'Media SaaS'],
  ['Nimbus Pets',           'Series B',  'Consumer SaaS'],
  ['Bedrock Manufacturing', 'Series B',  'Industrial SaaS'],
  ['Catalyst Telecom',      'Series D',  'Telecom'],
  ['Halberd Sports',        'Series C',  'Sports Tech'],
  ['Bastion Capital',       'Series E',  'Asset Management'],
  ['Cartograph Mapping',    'Series B',  'Geospatial'],
  ['Dovetail Foods',        'Series A',  'CPG'],
  ['Elevation Construction','Series B',  'ConTech'],
  ['Felix Adtech',          'Series C',  'Adtech'],
  ['Gantry Robotics',       'Series B',  'Robotics'],
  ['Heron Imaging',         'Series C',  'MedTech'],
  ['Ivory Drift',           'Series B',  'Hospitality SaaS'],
  ['Junction Defense',      'Series C',  'GovTech'],
  ['Kelp Mobility',         'Series B',  'EV Charging'],
  ['Loom Fabric',           'Series A',  'Textile SaaS'],
  ['Magnolia Bio',          'Series B',  'Biotech'],
  ['Nexus Cloud',           'Series D',  'Cloud Infra'],
  ['Oakwood Education',     'Series B',  'EdTech'],
  ['Penumbra Sports',       'Series C',  'Sports Media'],
  ['Quartile Analytics',    'Series C',  'Analytics SaaS'],
  ['Ridgeline Networks',    'Series D',  'Cybersecurity'],
  ['Saltbox Retail',        'Series B',  'E-commerce'],
  ['Tidewater Insurance',   'Series C',  'InsurTech'],
  ['Umbra Crypto',          'Series A',  'Crypto'],
  ['Vellum Education',      'Series B',  'EdTech'],
  ['Whetstone Defense',     'Series C',  'GovTech'],
  ['Xenith Robotics',       'Series B',  'Robotics'],
  ['Yardline Travel',       'Series A',  'Travel SaaS'],
  ['Zephyr Energy',         'Series C',  'EnergyTech'],
  ['Aria Marketplaces',     'Series D',  'Marketplaces'],
  ['Blackstone Media',      'Series E',  'Media SaaS'],
  ['Coastline Logistics',   'Series B',  'Logistics SaaS'],
  ['Dunes BioSciences',     'Series B',  'Biotech'],
  ['Estuary Health',        'Series C',  'HealthTech'],
  ['Fluxion Gaming',        'Series B',  'Gaming'],
  ['Grove Manufacturing',   'Series B',  'Industrial SaaS'],
  ['Harbor Capital',        'Series D',  'FinTech'],
];

const ROLES = [
  'Director, Revenue Operations',
  'Senior Director, Revenue Operations',
  'Director, Sales Operations',
  'Director, GTM Operations',
  'Director, Sales Strategy & Operations',
  'Director, Business Intelligence',
  'Sr. Director, GTM Analytics',
  'Director, Commercial Operations',
  'Director, Revenue Analytics',
  'Head of Revenue Operations',
];

// Status mix for the 60 new entries (id 31-90)
//   Discarded: 25 (triaged out before applying)
//   SKIP:      12 (wrong fit, comp below floor, location)
//   Closed:     6 (posting expired)
//   Rejected:   8 (in cycle, got cut)
//   Evaluated:  3 (hot review queue, decisions pending)
//   Applied:    6 (recent active submissions)
const STATUS_PLAN = [
  ...Array(25).fill('Discarded'),
  ...Array(12).fill('SKIP'),
  ...Array(6).fill('Closed'),
  ...Array(8).fill('Rejected'),
  ...Array(3).fill('Evaluated'),
  ...Array(6).fill('Applied'),
];
// shuffle plan deterministically
STATUS_PLAN.sort(() => rand() - 0.5);

// Score by status (realistic — Evaluated/Applied tend to score higher)
function scoreFor(status) {
  if (status === 'Evaluated') return 3.8 + rand() * 0.6;       // 3.8-4.4
  if (status === 'Applied')   return 3.7 + rand() * 0.7;       // 3.7-4.4
  if (status === 'Rejected')  return 3.6 + rand() * 0.6;       // 3.6-4.2
  if (status === 'Closed')    return 3.4 + rand() * 0.6;       // 3.4-4.0
  if (status === 'SKIP')      return 3.1 + rand() * 0.7;       // 3.1-3.8
  return 2.8 + rand() * 0.8;                                    // Discarded 2.8-3.6
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const DISCARD_NOTES = [
  'Comp below floor; pass.',
  'In-office only; location skip.',
  'Recent layoffs; org chart unclear.',
  'Archetype drift; not a fit.',
  'Below floor on base; soft skip.',
  'Industry vertical too narrow; pass.',
  'Leadership turnover; stability concern.',
  'Below floor; comp transparency low; pass.',
  'Cleared the no-go list (in-office); skip.',
  'Pre-Series A; too early.',
];
const SKIP_NOTES = [
  '[manual] Interesting but role title is Manager not Director; over-leveled for me.',
  '[manual] Strong company but East-coast only; declined.',
  '[manual] Wrong archetype — Marketing Ops, not RevOps.',
  '[manual] Hiring manager just left; tabled.',
  '[manual] Series A; building from zero — high risk this quarter.',
  '[manual] No remote-first option; skip.',
];
const CLOSED_NOTES = [
  'Posting expired before action; closed.',
  'Hired before I applied; closed.',
  'Backfilled internally; closed.',
];
const REJECTED_NOTES = [
  'Final round; lost to internal candidate; positive feedback. [reached: Interview]',
  'Phone screen; not enough industry-vertical depth. [reached: Responded]',
  'Hiring manager round; mutual decline on comp band. [reached: Interview]',
  'Final round; lost on Salesforce vs. HubSpot stack mismatch. [reached: Interview]',
  'Round 3 of 4; cut before final; nice feedback. [reached: Interview]',
];
const APPLIED_NOTES = [
  'Self-sourced via LinkedIn; recruiter response within 48h expected.',
  'Recruiter intro from network; warm intro letter included.',
  'API scan find; clean comp + clear archetype; submitted.',
  'CoWork pipeline; SDR funnel maturity is on; submitted.',
  'Reapplied after role re-opened; updated CV with InsurTech proof point.',
];
const EVALUATED_NOTES = [
  'Strong fit; awaiting decision before applying. Comp transparency confirmed; remote-first.',
  'High score; need to confirm equity band before submit.',
  'Excellent archetype match; need to draft cover before submitting.',
];

// ─── Build new apps ────────────────────────────────────────────────────────
const existing = readExistingApps();
const newApps = [];
const maxExisting = Math.max(...existing.map(a => a.id), 0);

for (let i = 0; i < STATUS_PLAN.length; i++) {
  const id = maxExisting + 1 + i;
  const status = STATUS_PLAN[i];
  // Push these older — start at day 30 (just after existing apps), go back to day 110
  const daysBack = 30 + Math.floor((i / STATUS_PLAN.length) * 80) + Math.floor(rand() * 4);
  const date = fmtDay(daysAgo(daysBack));
  const [company, _stage, sector] = pick(NEW_COMPANIES);
  const role = pick(ROLES);
  const score = scoreFor(status).toFixed(1);
  const pdf = ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(status) ? '✅' : (rand() < 0.3 ? '✅' : '❌');
  const resume = ['Interview', 'Offer', 'Rejected'].includes(status) ? '✅' : (status === 'Applied' && rand() < 0.5 ? '✅' : '—');
  const notes =
    status === 'Discarded' ? pick(DISCARD_NOTES) :
    status === 'SKIP'      ? pick(SKIP_NOTES) :
    status === 'Closed'    ? pick(CLOSED_NOTES) :
    status === 'Rejected'  ? pick(REJECTED_NOTES) :
    status === 'Evaluated' ? pick(EVALUATED_NOTES) :
                             pick(APPLIED_NOTES);
  const reportFile = `${String(id).padStart(3, '0')}-${slug(company)}-${date}.md`;
  newApps.push({
    id, date, company, role, score: `${score}/5`, status, pdf, resume,
    report: `[${id}](reports/demo/${reportFile})`,
    notes,
    _new: true,
    _sector: sector,
    _reportFile: reportFile,
  });
}

// ─── Write applications.md ────────────────────────────────────────────────
console.log(`Read ${existing.length} existing apps. Adding ${newApps.length} new entries (id ${maxExisting + 1}-${maxExisting + newApps.length}).`);

const allApps = [...existing, ...newApps].sort((a, b) => b.id - a.id);
const appsHeader = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|--------|-------|
`;
const appsBody = allApps.map(a =>
  `| ${a.id} | ${a.date} | ${a.company} | ${a.role} | ${a.score} | ${a.status} | ${a.pdf} | ${a.resume} | ${a.report} | ${a.notes} |`
).join('\n');
fs.writeFileSync(APPS_MD, appsHeader + appsBody + '\n');
console.log(`Wrote ${APPS_MD} (${allApps.length} entries).`);

// ─── Stub reports for new apps ────────────────────────────────────────────
fs.mkdirSync(REPORTS_DIR, { recursive: true });
let reportsWritten = 0;
for (const a of newApps) {
  const p = path.join(REPORTS_DIR, a._reportFile);
  if (fs.existsSync(p)) continue;
  const stub = `# Evaluation: ${a.company} — ${a.role}

**Date:** ${a.date}
**URL:** https://example.com/demo/${slug(a.company)}/${a.role.replace(/, /g, '-').replace(/ /g, '-')}
**Domain:** ${slug(a.company)}.example
**Archetype:** Revenue Operations / Sales Strategy
**Score:** ${a.score}
**Legitimacy:** Proceed with Caution
**PDF:** ${a.pdf}
**Compensation:** $170K-$210K base + 20-25% bonus
**Company Website:** ${slug(a.company)}.example

---

## A) Role Summary

| Attribute | Detail |
|-----------|--------|
| Domain | ${a._sector} |
| Seniority | Director |
| TL;DR | ${a.role} at ${a.company}. Demo-mode stub — full eval omitted. |

*(Demo-mode stub. Full Block B-G content omitted for the portfolio showcase.)*
`;
  fs.writeFileSync(p, stub);
  reportsWritten++;
}
console.log(`Wrote ${reportsWritten} stub reports to ${REPORTS_DIR}.`);

// ─── Follow-ups log ───────────────────────────────────────────────────────
// Build a meaningful touch history for Applied/Responded/Interview entries.
// Strategy: pick ~25 active apps (Applied/Responded/Interview) and log 1-3
// follow-ups each. Skew older apps to have more touches (they've been
// nudged more times).
const trackedForFU = allApps.filter(a => ['Applied', 'Responded', 'Interview'].includes(a.status));
const fuRows = [];
let fuId = 0;
for (const a of trackedForFU) {
  const appDay = (TODAY - new Date(a.date)) / 86400000;
  // How many follow-ups? Older apps get more
  let nTouches;
  if (appDay > 60) nTouches = pick([1, 2, 2]);
  else if (appDay > 30) nTouches = pick([1, 1, 2]);
  else if (appDay > 14) nTouches = pick([0, 1, 1]);
  else nTouches = 0;
  // Skip ~30% so we leave some stale-actionable
  if (rand() < 0.3) nTouches = Math.max(0, nTouches - 1);
  for (let t = 0; t < nTouches; t++) {
    fuId++;
    // Space follow-ups: first at apply + 10d, second at apply + 24d, third at apply + 42d
    const offset = [10, 24, 42][t] || 50;
    const dayOfFU = (new Date(a.date).getTime() / 86400000) + offset;
    const fuDate = fmtDay(new Date(dayOfFU * 86400000));
    if (new Date(fuDate) > TODAY) continue;
    const channel = pick(['Email', 'Email', 'LinkedIn', 'Email', 'Phone']);
    const verb = t === 0 ? 'Sent follow-up' : t === 1 ? 'Second touch' : 'Third nudge';
    const note = `${verb}. Subject: ${t === 0 ? 'Following up' : t === 1 ? 'Circling back' : 'Final check-in'}: ${a.role} application`;
    fuRows.push({ id: fuId, appNum: a.id, date: fuDate, company: a.company, role: a.role, channel, contact: '', notes: note });
  }
}

const fuHeader = `# Follow-Ups

Per-application follow-up touch log. Each row records one outreach attempt
(initial follow-up, second touch, recruiter ping, etc.) after the initial
application was sent.

| # | app# | date | company | role | channel | contact | notes |
|---|------|------|---------|------|---------|---------|-------|
`;
const fuBody = fuRows
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  .map(f => `| ${f.id} | ${f.appNum} | ${f.date} | ${f.company} | ${f.role} | ${f.channel} | ${f.contact} | ${f.notes} |`)
  .join('\n');
fs.writeFileSync(FU_MD, fuHeader + fuBody + '\n');
console.log(`Wrote ${FU_MD} (${fuRows.length} follow-up touches).`);

// ─── TA contacts + correspondence ────────────────────────────────────────
// Use canonical TT_STATUSES from the server: Not Contacted / Drafted / Sent
// / Replied / Meeting Scheduled / Connected / Dormant / Archived.
// We'll generate 35 TA contacts (existing 22 left intact, +13 new) and
// generate correspondence files for ~22 of them.
//
// Strategy: Keep existing 22 entries as-is, but their lastTouch dates need
// to be backdated so 8-10 of them surface as stale (>14d). Then write
// correspondence files for the engaged ones.

function readTA() {
  if (!fs.existsSync(TA_MD)) return [];
  const text = fs.readFileSync(TA_MD, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| #')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 17) continue;
    const id = parseInt(parts[1], 10);
    if (isNaN(id)) continue;
    rows.push({
      id,
      company: parts[2], last: parts[3], first: parts[4], salute: parts[5],
      title: parts[6], city: parts[7], state: parts[8], zip: parts[9],
      phone: parts[10], email: parts[11], linkedin: parts[12],
      status: parts[13], lastTouch: parts[14], notes: parts[15],
    });
  }
  return rows;
}

const existingTA = readTA();
// Remap statuses: 'Engaged' → 'Sent', 'Responded' → 'Replied', 'New' → 'Not Contacted'.
// Backdate lastTouch on some so they surface as stale.
const STATUS_REMAP = { Engaged: 'Sent', Responded: 'Replied', New: 'Not Contacted' };
const remappedTA = existingTA.map((c, idx) => {
  const status = STATUS_REMAP[c.status] || c.status;
  let lastTouch = c.lastTouch;
  // For Sent / Replied, set lastTouch to vary stale-ness:
  // Half are stale (>14d), half fresh (<14d)
  if (['Sent', 'Replied', 'Meeting Scheduled'].includes(status)) {
    const daysBack = idx % 2 === 0 ? 18 + (idx % 12) : 5 + (idx % 8);
    lastTouch = fmtDay(daysAgo(daysBack));
  }
  return { ...c, status, lastTouch };
});

// New TA entries to pair with new applications
const NEW_TA_DEFS = [
  ['Tessellate Cloud', 'Park',     'Hannah', 'Director, Talent Acquisition', 'Boston',   'MA', 'hannah.park@tessellate-cloud.example',     'Sent', 22],
  ['Drayton Capital',  'Vance',    'Owen',   'Head of Executive Recruiting', 'New York', 'NY', 'ovance@drayton-capital.example',           'Replied', 8],
  ['Lumina Health',    'Okafor',   'Amaka',  'Sr. Talent Partner',           'Chicago',  'IL', 'aokafor@lumina-health.example',            'Sent', 27],
  ['Quill Insurance',  'Hartwell', 'Mason',  'Director of Recruiting',       'Hartford', 'CT', 'mhartwell@quill-insurance.example',        'Meeting Scheduled', 3],
  ['Kestrel Logistics','Brenner',  'Lila',   'Sr. Talent Acquisition Partner','Chicago', 'IL', 'lbrenner@kestrel-logistics.example',       'Sent', 14],
  ['Veridian Robotics','Sato',     'Naoki',  'Talent Acquisition Manager',   'Detroit',  'MI', 'naoki.sato@veridian-robotics.example',     'Replied', 11],
  ['Anvil HR',         'Reyes',    'Diana',  'Head of Talent',               'Austin',   'TX', 'dreyes@anvil-hr.example',                  'Sent', 19],
  ['Cobalt Climate',   'Marsh',    'Sage',   'Director of Recruiting',       'Denver',   'CO', 'smarsh@cobalt-climate.example',            'Replied', 4],
  ['Riftline Networks','Quinn',    'Theo',   'Sr. Recruiter, GTM',           'Boston',   'MA', 'tquinn@riftline-networks.example',         'Sent', 25],
  ['Northgate Education','Holt',  'Yara',   'Talent Acquisition Lead',      'Austin',   'TX', 'yholt@northgate-education.example',        'Sent', 16],
  ['Polaris BioSciences','Larkin','Conrad', 'Director, Talent',             'Boston',   'MA', 'clarkin@polaris-biosciences.example',      'Meeting Scheduled', 6],
  ['Bastion Capital',  'Whitfield','Iris',  'Head of Executive Recruiting', 'New York', 'NY', 'iwhitfield@bastion-capital.example',       'Replied', 9],
  ['Felix Adtech',     'Penrose',  'Jonah',  'Director, People & Talent',    'San Francisco', 'CA', 'jpenrose@felix-adtech.example',       'Sent', 31],
];

const newTAStart = Math.max(...existingTA.map(c => c.id), 0) + 1;
const newTA = NEW_TA_DEFS.map(([company, last, first, title, city, state, email, status, daysBack], i) => ({
  id: newTAStart + i,
  company, last, first, salute: '',
  title, city, state, zip: '', phone: '', email,
  linkedin: `https://www.linkedin.com/in/${slug(first + ' ' + last)}/`,
  status,
  lastTouch: fmtDay(daysAgo(daysBack)),
  notes: '',
}));

const allTA = [...remappedTA, ...newTA];
const taHeader = `# Target Talent Acquisition

Internal Hiring / Talent Acquisition contacts at Target Companies. (Demo data — synthetic contacts for portfolio showcase.)

Each row links to a Target Company. The drawer cross-references \`applications.md\` entries where Company matches Target Company.

| # | Target Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes |
|---|----------------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|
`;
const taBody = allTA.map(c =>
  `| ${c.id} | ${c.company} | ${c.last} | ${c.first} | ${c.salute} | ${c.title} | ${c.city} | ${c.state} | ${c.zip} | ${c.phone} | ${c.email} | ${c.linkedin} | ${c.status} | ${c.lastTouch} | ${c.notes} |`
).join('\n');
fs.writeFileSync(TA_MD, taHeader + taBody + '\n');
console.log(`Wrote ${TA_MD} (${allTA.length} contacts).`);

// ─── TA correspondence ───────────────────────────────────────────────────
fs.mkdirSync(TA_CORR_DIR, { recursive: true });
// Wipe existing TA corr (clean rebuild)
for (const f of fs.readdirSync(TA_CORR_DIR)) {
  fs.unlinkSync(path.join(TA_CORR_DIR, f));
}

function buildTACorr(c) {
  const intro = `Director / VP RevOps interest — Jordan Avery`;
  const msgs = [];
  const bodySent = `${c.salute || ''} ${c.last},

I noticed ${c.company} has been investing in RevOps leadership and wanted to introduce myself directly.

I lead revenue operations at a Series D SaaS today; previously stood up forecasting + GTM analytics from zero at two earlier-stage scale-ups. Strong fit signals for what I've seen of your stack.

Would 20 minutes next week be worthwhile? Happy to send a one-pager first.

Best,
Jordan Avery`;

  const bodyReplyIn = `Jordan —

Thanks for reaching out. Your background looks like a strong match for a couple of open mandates. Do you have time later this week for a short intro call?

— ${c.first}`;

  const bodyConfirm = `${c.first} — confirmed for Tuesday 10:30 AM PT. Looking forward to it.

Best,
Jordan`;

  const sentBack = parseInt((TODAY - new Date(c.lastTouch)) / 86400000, 10);

  if (c.status === 'Sent') {
    msgs.push({ ts: fmtTs(daysAgo(sentBack)), direction: 'Sent', subject: intro, body: bodySent });
  } else if (c.status === 'Replied') {
    msgs.push({ ts: fmtTs(daysAgo(sentBack + 3)), direction: 'Sent', subject: intro, body: bodySent });
    msgs.push({ ts: fmtTs(daysAgo(sentBack)),     direction: 'Received', subject: `Re: ${intro}`, body: bodyReplyIn });
  } else if (c.status === 'Meeting Scheduled') {
    msgs.push({ ts: fmtTs(daysAgo(sentBack + 5)), direction: 'Sent', subject: intro, body: bodySent });
    msgs.push({ ts: fmtTs(daysAgo(sentBack + 2)), direction: 'Received', subject: `Re: ${intro}`, body: bodyReplyIn });
    msgs.push({ ts: fmtTs(daysAgo(sentBack)),     direction: 'Sent', subject: `Confirmed call`, body: bodyConfirm });
  }
  return msgs;
}

let corrWritten = 0, corrMessages = 0;
for (const c of allTA) {
  if (!['Sent', 'Replied', 'Meeting Scheduled'].includes(c.status)) continue;
  if (!c.lastTouch) continue;
  const msgs = buildTACorr(c);
  if (!msgs.length) continue;
  const out = msgs.map(m => `## ${m.ts} | ${m.direction} | ${m.subject}\n\n${m.body}\n`).join('\n');
  fs.writeFileSync(path.join(TA_CORR_DIR, `${c.id}.md`), out);
  corrWritten++;
  corrMessages += msgs.length;
}
console.log(`Wrote ${corrWritten} TA correspondence files (${corrMessages} messages).`);

// ─── LinkedIn SSI ─────────────────────────────────────────────────────────
// 12-week tracker showing upward trend from 39 → 58, with realistic
// posting / commenting / connection activity for a dedicated user.
fs.mkdirSync(SSI_DIR, { recursive: true });

const ssiTrend = [
  { week: 1,  start: 78, ssi: 39, brand: 16.3, find: 7.3, eng: 6.2,  rel: 9.2,  posts: 0, comments: 2,  connSent: 5,  connAcc: 3,  interviews: 0, notes: 'Starting baseline. Two comments on industry posts.' },
  { week: 2,  start: 71, ssi: 41, brand: 17.0, find: 7.8, eng: 6.5,  rel: 9.7,  posts: 1, comments: 5,  connSent: 8,  connAcc: 5,  interviews: 0, notes: 'First post: RevOps forecasting framework.' },
  { week: 3,  start: 64, ssi: 43, brand: 17.4, find: 8.2, eng: 7.0,  rel: 10.4, posts: 0, comments: 7,  connSent: 12, connAcc: 8,  interviews: 1, notes: 'Comment-only week. First inbound interview request from past comments.' },
  { week: 4,  start: 57, ssi: 46, brand: 18.0, find: 8.8, eng: 7.6,  rel: 11.6, posts: 1, comments: 9,  connSent: 10, connAcc: 7,  interviews: 0, notes: 'Second post: MEDDPICC adoption story. 24 reactions.' },
  { week: 5,  start: 50, ssi: 48, brand: 18.5, find: 9.1, eng: 8.0,  rel: 12.4, posts: 1, comments: 8,  connSent: 14, connAcc: 9,  interviews: 1, notes: 'Strong engagement week. One inbound DM converted to a screening call.' },
  { week: 6,  start: 43, ssi: 50, brand: 19.0, find: 9.6, eng: 8.4,  rel: 13.0, posts: 0, comments: 11, connSent: 9,  connAcc: 6,  interviews: 0, notes: 'No post; doubled down on commenting in target communities.' },
  { week: 7,  start: 36, ssi: 52, brand: 19.4, find: 9.9, eng: 9.0,  rel: 13.7, posts: 2, comments: 12, connSent: 11, connAcc: 8,  interviews: 1, notes: 'Two posts (analytics + forecasting). First repost by an influencer.' },
  { week: 8,  start: 29, ssi: 54, brand: 19.8, find: 10.4, eng: 9.4, rel: 14.4, posts: 1, comments: 10, connSent: 13, connAcc: 9,  interviews: 1, notes: 'Steady cadence — 1 post + 10 comments. Inbound recruiter ping from Series D RevOps Head.' },
  { week: 9,  start: 22, ssi: 55, brand: 20.0, find: 10.7, eng: 9.7, rel: 14.6, posts: 1, comments: 13, connSent: 12, connAcc: 8,  interviews: 0, notes: 'Steady; comments crossing 10/wk consistently.' },
  { week: 10, start: 15, ssi: 56, brand: 20.3, find: 11.0, eng: 9.9, rel: 14.8, posts: 1, comments: 11, connSent: 10, connAcc: 7,  interviews: 2, notes: 'Two interview-loop requests via DMs this week.' },
  { week: 11, start: 8,  ssi: 57, brand: 20.5, find: 11.3, eng: 10.1, rel: 15.1, posts: 1, comments: 12, connSent: 11, connAcc: 8,  interviews: 1, notes: 'Best week yet for inbound. Strong follower growth.' },
  { week: 12, start: 1,  ssi: 58, brand: 20.8, find: 11.5, eng: 10.3, rel: 15.4, posts: 1, comments: 9,  connSent: 9,  connAcc: 6,  interviews: 0, notes: 'Current week. SSI 58 — closing in on the 60 target.' },
];

const ssiTracker = {
  currentSsi: 58,
  targetSsi: 60,
  industryRank: 'Top 18%',
  networkRank: 'Top 24%',
  industryAvg: 33,
  networkAvg: 42,
  weeks: ssiTrend.map(w => ({
    weekNum: w.week,
    weekOf: fmtDay(daysAgo(w.start)),
    brand: w.brand,
    findPeople: w.find,
    engageInsights: w.eng,
    relationships: w.rel,
    postsPublished: w.posts,
    commentsMade: w.comments,
    connRequestsSent: w.connSent,
    connAccepted: w.connAcc,
    interviewRequests: w.interviews,
    notes: w.notes,
  })),
};
fs.writeFileSync(path.join(SSI_DIR, 'tracker.json'), JSON.stringify(ssiTracker, null, 2));

// Influencers — curate a list of high-leverage GTM/RevOps voices to engage with
const SSI_INFLUENCERS = [
  ['Sangram Vajre', 'Co-founder, GTM Partners', 'Followed', true, 'GTM strategy thought-leadership; comments earn visibility from operators.'],
  ['Mark Roberge', 'Sr Lecturer, HBS / former CRO HubSpot', 'Followed', true, 'Sales scaling fundamentals; engage on hiring-bar posts.'],
  ['Aaron Ross', 'Co-author, Predictable Revenue', 'Followed', false, 'SDR ops playbooks; foundational reading.'],
  ['Kevin Dorsey (KD)', 'CEO, Inside Sales Excellence', 'Followed', true, 'Sales leadership and management content.'],
  ['Lindsey Plocek', 'GTM advisor', 'Following', false, 'Sourcing strategy + ICP work.'],
  ['Jacco van der Kooij', 'Founder, Winning by Design', 'Following', false, 'GTM frameworks; useful for archetype framing.'],
  ['Lori Richardson', 'CEO, Score More Sales', 'Followed', true, 'Sales process expertise; senior network.'],
  ['Anthony Iannarino', 'Author', 'Following', false, 'Sales philosophy; less actionable but visible.'],
  ['Pete Kazanjy', 'Founder, Modern Sales Pros', 'Followed', true, 'Sales ops community; great network adjacency.'],
  ['Becc Holland', 'Founder, Flip the Script', 'Followed', false, 'Outbound playbooks.'],
  ['Mary Shea, PhD', 'Sales transformation', 'Following', false, 'Enterprise sales transformation; thought leadership.'],
  ['Asad Zaman', 'CEO, Sales Talent Agency', 'Followed', true, 'Sales recruiting; high-leverage for inbound.'],
];
const influencers = SSI_INFLUENCERS.map(([name, role, status, connected, notes], i) => ({
  id: i + 1, name, role, status, connected, notes, lastEngaged: fmtDay(daysAgo(2 + i * 3)),
}));
fs.writeFileSync(path.join(SSI_DIR, 'influencers.json'), JSON.stringify(influencers, null, 2));

// Engagement log
const engagementMd = `# LinkedIn Engagement Log

Tactical log of high-leverage engagement actions. Used by the LinkedIn SSI module to track posting and commenting cadence.

| Date | Action | Target | Notes |
|------|--------|--------|-------|
${[
  [fmtDay(daysAgo(1)),  'Comment',  'Sangram Vajre post on GTM strategy',     'Added a frame on forecasting-accuracy vs. pipeline-velocity tradeoff.'],
  [fmtDay(daysAgo(2)),  'Comment',  'Mark Roberge on hiring-bar drift',        'Shared a 1-line MEDDPICC adoption story.'],
  [fmtDay(daysAgo(3)),  'Post',     'Self: forecasting framework v2',          '1 post — 32 reactions, 7 comments, 1 inbound DM.'],
  [fmtDay(daysAgo(4)),  'Comment',  'Pete Kazanjy on RevOps team comp',        'Added a $400M ARR data point.'],
  [fmtDay(daysAgo(5)),  'Connect',  'Director of RevOps, Series D fintech',    'Warm intro via comment thread; accepted.'],
  [fmtDay(daysAgo(6)),  'Comment',  'KD on sales coaching playbooks',          'Lightweight, builds reciprocity.'],
  [fmtDay(daysAgo(8)),  'Post',     'Self: MEDDPICC adoption case study',      '1 post — 47 reactions, 11 comments. 2 inbound recruiter pings.'],
  [fmtDay(daysAgo(10)), 'Connect',  'CRO at Series E SaaS',                    'Followed first; warm-ish; accepted.'],
  [fmtDay(daysAgo(12)), 'Comment',  'Lori Richardson on enterprise GTM',       'Anchor comment; visible reply from Lori.'],
  [fmtDay(daysAgo(15)), 'Post',     'Self: 47-person SDR redesign',            '1 post — 28 reactions, 5 comments. Solid baseline.'],
].map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`).join('\n')}
`;
fs.writeFileSync(path.join(SSI_DIR, 'engagement-log.md'), engagementMd);
console.log(`Wrote SSI data (tracker + ${influencers.length} influencers + engagement log).`);

// ─── Summary ──────────────────────────────────────────────────────────────
const byStatus = {};
for (const a of allApps) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
console.log('\nFinal applications distribution:');
for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v}`);

const taByStatus = {};
for (const c of allTA) taByStatus[c.status] = (taByStatus[c.status] || 0) + 1;
console.log('\nFinal TA distribution:');
for (const [k, v] of Object.entries(taByStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);

console.log(`\nDone. Restart server with DEMO=1 to use.`);
