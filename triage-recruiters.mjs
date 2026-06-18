#!/usr/bin/env node
// Recruiter triage: score every contact, keep top 3 per firm.
// Writes a recommendations report (does not modify recruiters.md).

import fs from 'fs';

const SRC = 'data/recruiters.md';
const OUT = 'data/recruiter-triage-recommendations.md';

const BIG5 = new Set([
  'Spencer Stuart',
  'Korn Ferry',
  'Patina - A Korn Ferry Company',
  'Heidrick & Struggles',
  'Russell Reynolds Associates',
  'Egon Zehnder',
]);

const HARD_NO_CITIES = [
  'new york', 'manhattan', 'san francisco', 'palo alto', 'menlo park',
  'los angeles', 'chicago', 'boston', 'seattle', 'stamford', 'london', 'toronto',
  'minneapolis', 'philadelphia', 'cleveland', 'columbus', 'detroit', 'pittsburgh',
  'cincinnati', 'st. louis', 'st louis', 'orange village', 'bedford',
];
const TIER1_GEO = ['tx', 'texas'];
const TIER2_GEO = ['fl', 'ga', 'nc', 'tn', 'co', 'va', 'dc', 'az', 'nv', 'utah', 'ut'];

const HIGH_FIT_KEYS = [
  'analytics', 'business intelligence', ' bi ', 'revenue', 'gtm', 'go-to-market',
  'revops', 'rev ops', 'data', 'insights', 'commercial', 'growth', 'technology',
  'software', 'saas', 'digital', ' ai ', 'cio', 'cto', 'chief digital',
  'chief data', 'chief technology', 'chief information',
];
const MED_FIT_KEYS = [
  'sales', 'operations', 'strategy', 'marketing', 'business development',
  'go to market', 'product', 'tech ', 'tmt', 'media',
];
const ANTI_FIT_KEYS = [
  'cfo', 'financial officers practice', 'chro', 'human resources practice',
  ' hr practice', 'people officer', 'healthcare', 'life sciences', 'biotech',
  'clinical', 'pharma', 'energy', 'oil ', ' oil', 'aerospace', 'defense',
  'government', 'education practice', 'general counsel', 'legal practice',
  'board ', 'governance', 'academic', 'non-profit', 'nonprofit',
  'consumer products', 'consumer practice', 'retail practice', 'fashion',
  'real estate', 'construction', 'mining', 'agriculture', 'hospitality',
  'leisure', 'transportation', 'logistics', 'manufacturing',
];

const JUNIOR_TITLES = [
  'associate', 'principal', 'engagement manager', 'researcher', 'research',
  'coordinator', 'senior associate', 'analyst',
];
const SENIOR_PARTNER_TITLES = [
  'global managing partner', 'managing partner', 'vice chair', 'chair',
  'office leader', 'regional managing partner', 'regional leader',
  'global leader', 'global head', 'senior partner',
];

function parseRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 13) continue;
    const id = parseInt(parts[1], 10);
    if (isNaN(id)) continue;
    rows.push({
      raw: line,
      id,
      firm: parts[2],
      last: parts[3],
      first: parts[4],
      salute: parts[5],
      title: parts[6],
      city: parts[7],
      state: parts[8],
      zip: parts[9],
      phone: parts[10],
      email: parts[11],
      status: parts[12],
      lastTouch: parts[13] || '',
      notes: parts[14] || '',
    });
  }
  return rows;
}

function scoreContact(c) {
  let score = 0;
  const reasons = [];

  // Already engaged = hard keep
  if (c.status && c.status !== 'Not Contacted') {
    score += 100;
    reasons.push(`HARD-KEEP: status=${c.status}`);
  }

  // Geo
  const stateLower = (c.state || '').toLowerCase();
  const cityLower = (c.city || '').toLowerCase();
  const fullGeo = `${cityLower} ${stateLower}`;
  if (TIER1_GEO.includes(stateLower)) {
    score += 25; reasons.push('TX (+25)');
  } else if (HARD_NO_CITIES.some(c => fullGeo.includes(c))) {
    score -= 30; reasons.push('hard-no metro (-30)');
  } else if (TIER2_GEO.includes(stateLower)) {
    score += 12; reasons.push(`${stateLower.toUpperCase()} tier-2 (+12)`);
  } else {
    score += 3;
  }

  // Function fit
  const titleLower = (c.title || '').toLowerCase();
  const highHits = HIGH_FIT_KEYS.filter(k => titleLower.includes(k));
  const medHits = MED_FIT_KEYS.filter(k => titleLower.includes(k));
  const antiHits = ANTI_FIT_KEYS.filter(k => titleLower.includes(k));
  if (highHits.length) {
    score += 20 * highHits.length;
    reasons.push(`fit:${highHits.join('/')} (+${20 * highHits.length})`);
  }
  if (medHits.length && !highHits.length) {
    score += 10;
    reasons.push(`med-fit:${medHits[0]} (+10)`);
  }
  if (antiHits.length) {
    score -= 15 * antiHits.length;
    reasons.push(`anti:${antiHits.join('/')} (-${15 * antiHits.length})`);
  }

  // Tier handling
  const isBig5 = BIG5.has(c.firm);
  const isJunior = JUNIOR_TITLES.some(t => titleLower.includes(t)) &&
                   !titleLower.includes('partner');
  const isSeniorPartner = SENIOR_PARTNER_TITLES.some(t => titleLower.includes(t));
  if (isBig5) {
    if (isJunior) { score += 12; reasons.push('big5 junior tier (+12)'); }
    else if (isSeniorPartner) { score -= 8; reasons.push('big5 senior leader (-8)'); }
    else if (titleLower.includes('partner')) { score += 0; }
  } else {
    if (isSeniorPartner) { score += 3; }
    else if (titleLower.includes('partner') || titleLower.includes('director') ||
             titleLower.includes('vice president') || titleLower.includes('managing director')) {
      score += 6; reasons.push('mid-tier senior (+6)');
    } else if (isJunior) { score += 4; reasons.push('mid-tier junior (+4)'); }
  }

  // Notes already populated = manual investment
  if (c.notes && c.notes.length > 5 && !c.notes.startsWith('Email corrected')) {
    score += 5;
    reasons.push('has-notes (+5)');
  }

  return { score, reasons };
}

const text = fs.readFileSync(SRC, 'utf8');
const rows = parseRows(text);

// Score all
for (const r of rows) {
  const s = scoreContact(r);
  r.score = s.score;
  r.reasons = s.reasons.join('; ');
}

// Group by firm
const byFirm = {};
for (const r of rows) {
  byFirm[r.firm] = byFirm[r.firm] || [];
  byFirm[r.firm].push(r);
}

// Decide keep/cut
const KEEP_PER_FIRM = 3;
const keepers = [];
const cuts = [];

for (const [firm, members] of Object.entries(byFirm)) {
  members.sort((a, b) => b.score - a.score);
  // Always keep already-contacted regardless of rank
  const forced = members.filter(m => m.status && m.status !== 'Not Contacted');
  const remaining = members.filter(m => !forced.includes(m));
  const targetKeep = Math.max(KEEP_PER_FIRM, forced.length);
  const topPicks = remaining.slice(0, targetKeep - forced.length);
  const firmKeepers = [...forced, ...topPicks];
  const firmCuts = remaining.slice(targetKeep - forced.length);
  for (const k of firmKeepers) { k.decision = 'KEEP'; keepers.push(k); }
  for (const c of firmCuts) { c.decision = 'CUT'; cuts.push(c); }
}

// Build report
const lines = [];
lines.push('# Recruiter Triage Recommendations');
lines.push('');
lines.push(`Generated: 2026-06-08`);
lines.push(`Source: ${rows.length} contacts across ${Object.keys(byFirm).length} firms`);
lines.push(`Target: keep top ${KEEP_PER_FIRM} per firm (+ any already-contacted)`);
lines.push('');
lines.push(`**KEEP: ${keepers.length}** &nbsp;&nbsp; **CUT: ${cuts.length}** &nbsp;&nbsp; **Reduction: ${Math.round(cuts.length / rows.length * 100)}%**`);
lines.push('');
lines.push('## Scoring rubric');
lines.push('');
lines.push('- **Geo**: TX +25 · FL/GA/NC/TN/CO/VA/DC/AZ/NV/UT +12 · hard-no metros (NYC/SF/LA/Chicago/Boston/Seattle/Stamford/London/Toronto/MSP/Philly/Cleveland/Columbus/Detroit/Pittsburgh/Cincinnati/StL/Orange Village/Bedford) −30');
lines.push('- **Function**: each match in `analytics/BI/revenue/GTM/RevOps/data/insights/commercial/growth/tech/software/SaaS/digital/AI/CIO/CTO/CDO` +20 · `sales/ops/strategy/marketing/BD/product/TMT` +10 · each anti-match (CFO/CHRO/healthcare/legal/board/energy/oil/industrial/consumer-practice/real-estate/etc) −15');
lines.push('- **Tier at Big 5** (SS/KF/H&S/RRA/EZ/Patina): Associate/Principal/Engagement Manager/Researcher +12 · senior leaders (Managing Partner/Vice Chair/Office Leader) −8');
lines.push('- **Tier at mid-tier firms**: Partner/Director/VP/MD +6 · Junior +4');
lines.push('- **HARD-KEEP +100**: any row where Status ≠ "Not Contacted" (already engaged) — kept regardless of score');
lines.push('');
lines.push('---');
lines.push('');

// Per-firm breakdown
const firmEntries = Object.entries(byFirm).sort((a, b) => b[1].length - a[1].length);
for (const [firm, members] of firmEntries) {
  const k = members.filter(m => m.decision === 'KEEP');
  const c = members.filter(m => m.decision === 'CUT');
  lines.push(`## ${firm}  *(${members.length} → ${k.length})*`);
  lines.push('');
  if (k.length) {
    lines.push('**Keep:**');
    lines.push('');
    lines.push('| # | Name | Title | City | State | Score | Why |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const m of k) {
      lines.push(`| ${m.id} | ${m.first} ${m.last} | ${m.title} | ${m.city} | ${m.state} | ${m.score} | ${m.reasons} |`);
    }
    lines.push('');
  }
  if (c.length) {
    lines.push(`**Cut (${c.length}):**`);
    lines.push('');
    lines.push('| # | Name | Title | City | State | Score | Why cut |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const m of c) {
      lines.push(`| ${m.id} | ${m.first} ${m.last} | ${m.title} | ${m.city} | ${m.state} | ${m.score} | ${m.reasons || 'low fit'} |`);
    }
    lines.push('');
  }
}

// Flat cut list for easy review
lines.push('---');
lines.push('');
lines.push(`## Flat cut list — ${cuts.length} IDs proposed for deletion`);
lines.push('');
lines.push('```');
lines.push(cuts.map(c => c.id).sort((a, b) => a - b).join(','));
lines.push('```');

fs.writeFileSync(OUT, lines.join('\n'));
console.log(`✅ Wrote ${OUT}`);
console.log(`   ${keepers.length} keep · ${cuts.length} cut · ${Math.round(cuts.length/rows.length*100)}% reduction`);
console.log(`   Firms: ${Object.keys(byFirm).length}`);
