#!/usr/bin/env node
// Recruiters demo data seeder.
// Builds data/demo/recruiters.md (515 contacts, 56 firms) with a realistic
// 30-day outreach funnel, and per-contact correspondence files that exercise
// every populated branch in the redesigned Recruiters module.
//
// Run:  node seed-recruiters-demo.mjs
// Then: DEMO=1 npm run dev
//
// Deterministic — seeded RNG so re-runs produce the same demo data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIVE_MD = path.join(ROOT, 'data', 'recruiters.md');
const DEMO_MD = path.join(ROOT, 'data', 'demo', 'recruiters.md');
const DEMO_CORR_DIR = path.join(ROOT, 'data', 'demo', 'recruiter-correspondence');

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
const pickN = (arr, n) => {
  const c = [...arr];
  const out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rand() * c.length), 1)[0]);
  return out;
};

// ─── Date helpers ──────────────────────────────────────────────────────────
const TODAY = new Date('2026-06-07T10:00:00Z');
function daysAgo(n, hour = 10, min = 0) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, min, 0, 0);
  return d;
}
function fmtDay(d) { return d.toISOString().slice(0, 10); }
function fmtTs(d) { return d.toISOString().replace('T', ' ').slice(0, 16); }

// ─── Parse live recruiters.md ──────────────────────────────────────────────
const liveText = fs.readFileSync(LIVE_MD, 'utf8');
const headerLines = [];
const dataLines = [];
let pastHeader = false;
for (const line of liveText.split('\n')) {
  if (line.startsWith('| #') || line.startsWith('|---')) {
    headerLines.push(line);
    pastHeader = true;
    continue;
  }
  if (pastHeader && line.startsWith('| ')) {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length >= 15 && !isNaN(parseInt(parts[1], 10))) {
      dataLines.push({
        id: parseInt(parts[1], 10),
        firm: parts[2], last: parts[3], first: parts[4], salute: parts[5],
        title: parts[6], city: parts[7], state: parts[8], zip: parts[9],
        phone: parts[10], email: parts[11],
        status: 'Not Contacted', lastTouch: '', notes: '',
      });
    }
  }
}
console.log(`Read ${dataLines.length} live recruiter contacts.`);

// ─── Pick firms to seed ────────────────────────────────────────────────────
// Use 10 firms with varied sizes so firm-glance peers + firm cards look rich.
const byFirm = new Map();
for (const c of dataLines) {
  if (!byFirm.has(c.firm)) byFirm.set(c.firm, []);
  byFirm.get(c.firm).push(c);
}
const firms = [...byFirm.entries()]
  .map(([name, contacts]) => ({ name, contacts, n: contacts.length }))
  .sort((a, b) => b.n - a.n);
const seedFirms = [
  firms[0],  // Heidrick & Struggles (42)
  firms[1],  // Korn Ferry (42)
  firms[2],  // Stanton Chase (42)
  firms[3],  // Patina (37)
  firms[4],  // Spencer Stuart (37)
  firms[7],  // Boyden
  firms[10], // True Search
  firms[15], // mid-tier
  firms[22], // mid-tier
  firms[35], // long-tail
];
console.log(`Seeding ${seedFirms.length} firms:`, seedFirms.map(f => `${f.name.split(' — ')[0]} (${f.n})`).join(', '));

// ─── Funnel plan ──────────────────────────────────────────────────────────
// Target distribution across the 10 firms (realistic 30-day outreach motion):
//   Drafted: 8 (in-flight, not yet sent)
//   Sent: 28 (sent, no reply yet)
//   Replied: 16
//   Meeting Scheduled: 7
//   Connected: 3
//   Dormant: 6 (paused after no reply)
//
// Per firm we draw a stratified sample so each firm gets a mix.
const PLAN = [
  { status: 'Connected',         count: 3, daysBack: [25, 30] },
  { status: 'Meeting Scheduled', count: 7, daysBack: [10, 22] },
  { status: 'Replied',           count: 16, daysBack: [3, 18] },
  { status: 'Sent',              count: 28, daysBack: [1, 14] },
  { status: 'Drafted',           count: 8,  daysBack: [0, 3]  },
  { status: 'Dormant',           count: 6,  daysBack: [22, 30] },
];
const totalTouched = PLAN.reduce((s, p) => s + p.count, 0);
console.log(`Planning ${totalTouched} touched contacts across the funnel.`);

// Pick contacts: each firm contributes proportionally, but ensure spread across all 10
const candidatePool = [];
for (const f of seedFirms) {
  // Each firm contributes up to 8 contacts to the pool
  for (const c of pickN(f.contacts, Math.min(f.contacts.length, 9))) {
    candidatePool.push(c);
  }
}
console.log(`Candidate pool: ${candidatePool.length}`);

// Shuffle deterministically
candidatePool.sort(() => rand() - 0.5);

// Assign statuses
const assignments = [];
let cursor = 0;
for (const stage of PLAN) {
  for (let i = 0; i < stage.count; i++) {
    if (cursor >= candidatePool.length) break;
    const c = candidatePool[cursor++];
    const daysBack = stage.daysBack[0] + Math.floor(rand() * (stage.daysBack[1] - stage.daysBack[0]));
    assignments.push({ contact: c, status: stage.status, daysBack });
  }
}
console.log(`Assigned ${assignments.length} contacts to non-default statuses.`);

// ─── Build correspondence per assigned contact ────────────────────────────
// Templates per stage. Each generates 1-3 messages with realistic dates.
function buildMessages(c, status, daysBack) {
  const firmShort = c.firm.split(' — ')[0];
  const subjectSent = `Director-level RevOps mandates — ${c.first} introduction`;
  const subjectFollow = `Following up · ${c.first}, RevOps leadership conversation`;

  const bodySent = `${c.salute || ''} ${c.last},

I noticed ${firmShort} runs a number of operator searches in the ${c.city} market and wanted to introduce myself directly.

I've spent the last decade leading revenue operations across early-stage and growth-stage SaaS — building forecasting systems, deploying MEDDPICC across 150+ sellers, and standing up the analytics layer behind $400M ARR. I'm now exploring Director / VP RevOps mandates and would value being on your radar.

Would 20 minutes next week be worthwhile? Happy to send a one-pager first.

Best,
Jordan Avery`;

  const bodyDraft = `${c.salute || ''} ${c.last},

I've been watching the leadership work ${firmShort} runs and wanted to reach out personally about Director-level RevOps placements.

[draft — still tightening the proof-point paragraph before send]

Best,
Jordan Avery`;

  const bodyReplyIn = `Jordan —

Thanks for reaching out. Your background looks like a strong fit for a couple of active searches we're running. Do you have time this week for a short call? Tuesday or Wednesday afternoon work on my end.

— ${c.first}`;

  const bodyFollow = `${c.first},

Circling back on my note from a couple weeks ago — wanted to make sure it didn't get buried. I've added two more wins to the deck since (24% lift on outbound conversion at the current role; closed-loop forecast accuracy within 3%).

Still happy to send a one-pager or jump on a call when timing is right.

Best,
Jordan`;

  const msgs = [];

  if (status === 'Drafted') {
    msgs.push({
      timestamp: fmtTs(daysAgo(daysBack, 9, 14)),
      direction: 'Draft',
      subject: subjectSent,
      body: bodyDraft,
    });
  } else if (status === 'Sent') {
    msgs.push({
      timestamp: fmtTs(daysAgo(daysBack, 10, 22)),
      direction: 'Sent',
      subject: subjectSent,
      body: bodySent,
    });
    // Sometimes a follow-up too
    if (daysBack > 7 && rand() < 0.45) {
      msgs.push({
        timestamp: fmtTs(daysAgo(Math.max(0, daysBack - 7), 11, 30)),
        direction: 'Sent',
        subject: subjectFollow,
        body: bodyFollow,
      });
    }
  } else if (status === 'Replied') {
    const sentBack = daysBack + 2 + Math.floor(rand() * 3);
    msgs.push({
      timestamp: fmtTs(daysAgo(sentBack, 9, 12)),
      direction: 'Sent',
      subject: subjectSent,
      body: bodySent,
    });
    msgs.push({
      timestamp: fmtTs(daysAgo(daysBack, 14, 8)),
      direction: 'Received',
      subject: `Re: ${subjectSent}`,
      body: bodyReplyIn,
    });
  } else if (status === 'Meeting Scheduled') {
    const sentBack = daysBack + 5 + Math.floor(rand() * 5);
    const replyBack = daysBack + 2 + Math.floor(rand() * 2);
    msgs.push({
      timestamp: fmtTs(daysAgo(sentBack, 9, 30)),
      direction: 'Sent',
      subject: subjectSent,
      body: bodySent,
    });
    msgs.push({
      timestamp: fmtTs(daysAgo(replyBack, 11, 0)),
      direction: 'Received',
      subject: `Re: ${subjectSent}`,
      body: bodyReplyIn,
    });
    msgs.push({
      timestamp: fmtTs(daysAgo(daysBack, 16, 30)),
      direction: 'Sent',
      subject: `Confirmed — call ${fmtDay(daysAgo(Math.max(0, daysBack - 5), 10, 0))} at 10:00 PT`,
      body: `${c.first} — confirmed for ${fmtDay(daysAgo(Math.max(0, daysBack - 5), 10, 0))} at 10:00 PT. Sending a quick agenda separately. Looking forward to it.\n\n— Jordan`,
    });
  } else if (status === 'Connected') {
    const sentBack = daysBack + 8 + Math.floor(rand() * 5);
    msgs.push({
      timestamp: fmtTs(daysAgo(sentBack, 9, 30)),
      direction: 'Sent',
      subject: subjectSent,
      body: bodySent,
    });
    msgs.push({
      timestamp: fmtTs(daysAgo(sentBack - 2, 11, 0)),
      direction: 'Received',
      subject: `Re: ${subjectSent}`,
      body: bodyReplyIn,
    });
    msgs.push({
      timestamp: fmtTs(daysAgo(sentBack - 8, 15, 0)),
      direction: 'Sent',
      subject: `Great call yesterday — sending the deck`,
      body: `${c.first} —\n\nGreat call yesterday. Attaching the one-pager + portfolio link.\n\nHappy to be top-of-list for any Director / VP RevOps mandates that come through. I'll check back in mid-month.\n\nBest,\nJordan`,
    });
    msgs.push({
      timestamp: fmtTs(daysAgo(daysBack, 9, 0)),
      direction: 'Received',
      subject: `Two active searches — worth a look?`,
      body: `Jordan — two active mandates that match your profile. I'll send the JDs over today. Glad we connected.\n\n— ${c.first}`,
    });
  } else if (status === 'Dormant') {
    msgs.push({
      timestamp: fmtTs(daysAgo(daysBack + 4, 10, 0)),
      direction: 'Sent',
      subject: subjectSent,
      body: bodySent,
    });
    msgs.push({
      timestamp: fmtTs(daysAgo(daysBack, 11, 0)),
      direction: 'Sent',
      subject: subjectFollow,
      body: bodyFollow,
    });
  }
  return msgs;
}

// ─── Write demo data ──────────────────────────────────────────────────────
console.log('Writing demo recruiters.md…');

// Apply assignments
const byId = new Map(dataLines.map(c => [c.id, c]));
for (const a of assignments) {
  const c = byId.get(a.contact.id);
  if (!c) continue;
  c.status = a.status;
  c.lastTouch = fmtDay(daysAgo(a.daysBack));
  if (a.status === 'Dormant') c.notes = 'No reply after two touches — parked.';
}

// Compose the new markdown file
const header = `# Recruiters Tracker

Executive recruiters and search firms. (Demo data — synthetic outreach motion for portfolio showcase.)

| # | Firm | Last | First | Salute | Title | City | State | Zip | Phone | Email | Status | Last Touch | Notes |
|---|------|------|-------|--------|-------|------|-------|-----|-------|-------|--------|------------|-------|
`;
const body = dataLines.map(c =>
  `| ${c.id} | ${c.firm} | ${c.last} | ${c.first} | ${c.salute} | ${c.title} | ${c.city} | ${c.state} | ${c.zip} | ${c.phone} | ${c.email} | ${c.status} | ${c.lastTouch} | ${c.notes} |`
).join('\n');

fs.mkdirSync(path.dirname(DEMO_MD), { recursive: true });
fs.writeFileSync(DEMO_MD, header + body + '\n');
console.log(`Wrote ${DEMO_MD} (${dataLines.length} rows).`);

// Wipe + rewrite correspondence dir
console.log(`Writing correspondence files to ${DEMO_CORR_DIR}…`);
fs.rmSync(DEMO_CORR_DIR, { recursive: true, force: true });
fs.mkdirSync(DEMO_CORR_DIR, { recursive: true });

let corrFiles = 0, corrMessages = 0;
for (const a of assignments) {
  const msgs = buildMessages(a.contact, a.status, a.daysBack);
  if (!msgs.length) continue;
  const out = msgs.map(m =>
    `## ${m.timestamp} | ${m.direction} | ${m.subject}\n\n${m.body}\n`
  ).join('\n');
  fs.writeFileSync(path.join(DEMO_CORR_DIR, `${a.contact.id}.md`), out);
  corrFiles++;
  corrMessages += msgs.length;
}
console.log(`Wrote ${corrFiles} correspondence files (${corrMessages} messages total).`);

// ─── Print summary ─────────────────────────────────────────────────────────
const summary = {};
for (const c of dataLines) summary[c.status] = (summary[c.status] || 0) + 1;
console.log('\nFinal distribution:');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`\nDone. Restart server with DEMO=1 to use.`);
