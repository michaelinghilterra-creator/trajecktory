import fs from 'fs';
import path from 'path';
import { APPS_MD, ROOT_DIR, STATUS_EVENTS_PATH } from '../config.mjs';
import { parseTrackerLine } from '../../../lib/tracker.mjs';
import { hasV1Frontmatter, parseV1, v1Header } from '../v1-loader.mjs';
import { logStatusEvent, parseStatusEvents } from './sidecars.mjs';
import { FUNNEL_ORDER, makeFurthestIdx, isInbound } from './statuses.mjs';

// ── Parser ────────────────────────────────────────────────────────────────────

function parseScore(raw) {
  if (!raw || raw === 'N/A') return null;
  const m = raw.match(/([\d.]+)\s*\/\s*5/);
  return m ? parseFloat(m[1]) : null;
}

// The final return is a CATCH-ALL, not a classification. It previously returned
// a real archetype name, which made every unmatched title look like a deliberate
// cohort — potentially a large share of any tracker — and let the dashboard
// advise "X roles convert best, weight your applications toward X" about a bucket
// that only means "none of the patterns above matched". Naming it honestly keeps
// it visible as a gap in the archetype rules rather than dressing it up as a target.
export const ARCHETYPE_UNCLASSIFIED = 'Unclassified';

function inferArchetype(role) {
  const r = role.toLowerCase();
  if (/rev\s*ops|revenue ops|revenue operations/.test(r)) return 'RevOps';
  if (/sales ops|sales operations|gtm ops|gtm operations|commercial ops/.test(r)) return 'SalesOps';
  if (/analytics|business intelligence|\bbi\b|data & insights|revenue intelligence/.test(r)) return 'Analytics';
  if (/business development|biz\s*dev|bds|strategic partnerships|corporate development/.test(r)) return 'BizDev';
  if (/sales development|\bsdr\b|\bbdr\b/.test(r)) return 'SalesDev';
  if (/strategy|strategic planning|chief of staff/.test(r)) return 'Strategy';
  return ARCHETYPE_UNCLASSIFIED;
}

// ── Report header enrichment cache ───────────────────────────────────────────
// applications.md doesn't store comp / domain / source. The data IS in each
// linked report file (Block A "Domain", Block D salary, header "URL"). We
// read the first ~40 lines of each report once, cache by mtime, and merge
// the enriched fields into the row payload.
const _reportHeaderCache = new Map(); // key: reportPath, value: { mtimeMs, data }

function readReportHeader(reportPath) {
  if (!reportPath) return null;
  const abs = path.resolve(ROOT_DIR, reportPath);
  let stat;
  try { stat = fs.statSync(abs); } catch { return null; }
  const cached = _reportHeaderCache.get(reportPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;

  let url = null, domain = null, compStated = null, legitimacy = null;
  try {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(48000);
    const n = fs.readSync(fd, buf, 0, 48000, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n).toString('utf8');

    // v1 reports: pull header fields straight from JSON frontmatter
    if (hasV1Frontmatter(head)) {
      try {
        const { data } = parseV1(head);
        const h = v1Header(data);
        const out = { url: h.url, domain: h.domain, compStated: h.compStated, legitimacy: h.legitimacy };
        _reportHeaderCache.set(reportPath, { mtimeMs: stat.mtimeMs, data: out });
        return out;
      } catch { /* malformed v1 — fall through to legacy regex */ }
    }

    const urlMatch = head.match(/^\*\*URL:\*\*\s*(https?:\/\/[^\s()]+)/m);
    if (urlMatch) url = urlMatch[1];

    // Block A "Domain" row (table format: | Domain | <value> |)
    const domainMatch = head.match(/\|\s*\*{0,2}Domain\*{0,2}\s*\|\s*([^|\n]+?)\s*\|/i);
    if (domainMatch) domain = domainMatch[1].trim();
    if (!domain) {
      const domainHeader = head.match(/^\*\*Domain:\*\*\s*([^\n]+)/m);
      if (domainHeader) domain = domainHeader[1].trim();
    }

    // Legitimacy tier from header line
    const legitMatch = head.match(/^\*\*Legitimacy:\*\*\s*([^\n*]+?)\s*(?:\*|$)/m);
    if (legitMatch) legitimacy = legitMatch[1].trim();

    // Compensation: prioritize explicit "Compensation:" line, then fall back to generic patterns
    const compHeaderMatch = head.match(/^\*\*Compensation:\*\*\s*([^\n]+)/m);
    if (compHeaderMatch) {
      compStated = compHeaderMatch[1].trim();
    } else {
      // Salary range or single OTE: $xxx-$yyy / $xxxK / USD x-y
      const compMatch = head.match(/\$[\d,]+(?:[KkMm])?\s*[-–—to]+\s*\$?[\d,]+(?:[KkMm])?/) ||
                        head.match(/USD\s+[\d,.]+(?:[-–—]\s*[\d,.]+)?(?:\s*\/\s*year)?/) ||
                        head.match(/\$[\d,]+(?:[KkMm])?\s+(?:base|OTE|annually|\/yr)/i);
      if (compMatch) compStated = compMatch[0].replace(/\s+/g, ' ').trim();
    }
  } catch { /* report not readable */ }

  const data = { url, domain, compStated, legitimacy };
  _reportHeaderCache.set(reportPath, { mtimeMs: stat.mtimeMs, data });
  return data;
}

// Normalize the verbose Block A "Domain" field into a short canonical sector label.
// Patterns are evaluated in priority order — first match wins, so put more
// specific patterns before general ones. The original string is preserved on
// the entry payload (`sectorRaw`) for the hover tooltip.
const SECTOR_PATTERNS = [
  // Security
  [/devsecops/i,                                        'DevSecOps'],
  [/cyber|security|threat|infosec|appsec|netsec|siem/i, 'Cybersecurity'],
  // Privacy
  [/privacy\s*tech|consumer privacy|privacy.?first/i,   'Privacy Tech'],
  // Data & dev infrastructure
  [/data.*integration|etl|elt|reverse etl|pipeline|warehouse|lakehouse|composable cdp|data activation/i, 'Data Infrastructure'],
  [/observability|monitoring|apm/i,                     'Observability'],
  [/devtool|developer\s+tool|api platform|low.?code|no.?code|developer\s+infra|dev\s+infra/i, 'DevTools'],
  [/cloud (?:infra|platform|computing)|paas|iaas|edge computing|platform (?:reliability|engineering)/i, 'Cloud Infrastructure'],
  // AI/ML — conversational/voice AI before general AI/ML
  [/voice ai|speech.?to.?text|speech technology|conversational ai|ai voice|ai.?cx\b/i, 'Conversational AI'],
  [/\bllm\b|generative ai|gen.?ai|ai\/ml|machine learning|\bai platform\b|\bai (?:product|application)|ai.?agents?\b/i, 'AI/ML'],
  // Analytics & BI
  [/analytics|business intelligence|\bbi\b|\bdashboard|\bcdp\b/i, 'Analytics'],
  // GTM / Sales-Marketing-Customer tech
  [/contact center|ccaas|customer service platform/i,   'Contact Center'],
  [/\brevops\b|revenue operations|gtm operations|go.?to.?market operations/i, 'SalesTech'],
  [/sales (?:engagement|enablement|tech|automation)|revenue (?:intelligence|tech)/i, 'SalesTech'],
  [/sms marketing|email marketing|martech|marketing automation|ad.?tech|seo|growth marketing|digital marketing|affiliate|performance marketing|advertising technology|\bctv\b|connected tv/i, 'MarTech'],
  [/customer success|cs platform/i,                     'CSTech'],
  // Verticals
  [/health\s*tech|digital health|telehealth/i,          'Healthtech'],
  [/healthcare|hospital|clinical|medical (?:device|services)|pharma|life sciences|biotech|home care/i, 'Healthcare'],
  [/legal\s*(?:tech|saas)|law\s*firm|legal practice/i,  'Legal Tech'],
  [/insur\w*tech|insurance saas/i,                      'InsurTech'],
  [/insurance/i,                                        'Insurance'],
  [/fintech|payments?|banking|wealth\s*tech|treasury|invoicing|tax (?:automation|compliance)|financial performance|expense management|accounting/i, 'Fintech'],
  [/financial services|investment|asset management|capital markets|ipo prep|public company/i, 'Financial Services'],
  [/ed\s*tech|education saas|learning platform/i,       'EdTech'],
  [/education(?!\s*tech)|university|k-12|tutoring/i,    'Education'],
  [/hr\s*tech|people (?:tech|ops)|talent (?:tech|saas)|recruiting platform|workforce management|employer of record|\beor\b/i, 'HR Tech'],
  [/government|gov\s*tech|public sector|federal|civic/i,'GovTech'],
  [/real estate|proptech|property/i,                    'Real Estate'],
  [/travel|hospitality|hotel|airline/i,                 'Travel'],
  [/e[-\s]?commerce|retail (?:saas|tech)|shopping platform/i, 'E-commerce'],
  [/qsr|quick service|restaurant|food service/i,        'Food & Beverage'],
  [/retail/i,                                           'Retail'],
  [/cpg|consumer goods|consumer packaged/i,             'CPG'],
  [/logistics|supply chain|freight|shipping|transportation/i, 'Logistics'],
  [/manufacturing|industrial|cnc|factory/i,             'Manufacturing'],
  [/energy|utility|oil & gas|renewable/i,               'Energy'],
  [/media|broadcast|publishing|streaming|advertising agency|music distribution|creator economy|creative.?as.?a.?service/i, 'Media'],
  [/telecom|telco|isp|networking equipment/i,           'Telecom'],
  [/automotive|auto\s*tech|mobility/i,                  'Automotive'],
  [/agritech|agriculture|farming/i,                     'AgriTech'],
  [/construction|building/i,                            'Construction'],
  [/non[-\s]?profit|ngo|philanthropy/i,                 'Non-profit'],
  [/web3|blockchain|crypto(?:currency)?|\bdefi\b/i,     'Web3'],
  [/it services|managed services|\bmsp\b/i,             'IT Services'],
  [/consulting|professional services/i,                 'Consulting'],
  // Catch-alls — least specific last
  [/b2b\s*saas|enterprise saas/i,                       'B2B SaaS'],
  [/\bsaas\b|software[-\s]as[-\s]a[-\s]service/i,       'SaaS'],
];

function normalizeSector(raw) {
  if (!raw) return null;
  const s = raw.trim();
  for (const [rx, label] of SECTOR_PATTERNS) {
    if (rx.test(s)) return label;
  }
  // Fallback: take everything before the first " / " or " — " separator and trim
  const head = s.split(/[/—\-(]/)[0].trim();
  if (head.length > 0 && head.length <= 22) return head;
  return 'Other';
}

// Classify how this entry entered the tracker — for the dashboard "Source" column.
//   Self-sourced — user pasted the JD manually (notes tagged [self-sourced])
//   Referral     — came via a referral (notes tagged [referral: NAME])
//   API Scan     — zero-token scanner hit a Greenhouse/Ashby/Lever endpoint
//   Agent Scan   — agent ran /trajecktory scan against a non-API portal
function classifySource(notes, url) {
  if (/\[self-sourced\]/i.test(notes)) return 'Self-sourced';
  if (/\[referral:/i.test(notes))      return 'Referral';
  // [cowork] is a resume-tailoring ENGINE tag, not a JD source — let those rows
  // fall through to URL-based classification (API Scan / Agent Scan) instead of
  // being mislabeled 'CoWork' in the Source column.
  if (!url) return 'Agent Scan';
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/(^|\.)(greenhouse\.io|ashbyhq\.com|lever\.co|job-boards\.greenhouse\.io|boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com)$/.test(host)) {
      return 'API Scan';
    }
    return 'Agent Scan';
  } catch { return 'Agent Scan'; }
}

// Cache the parsed tracker keyed on the file's mtime (same pattern as
// _reportHeaderCache). parseApplicationsMd is called from ~14 routes; without
// this, every call re-reads and re-parses the whole file and re-enriches every
// row. A write to applications.md (e.g. a status PATCH) bumps mtime and
// invalidates the cache automatically. Note: a report-header edit that does not
// touch applications.md will not invalidate this until the next write or a
// server restart (report headers are themselves mtime-cached for fresh reads).
// Also keyed on the status-event log's mtime: each row carries a `reached` rung
// derived from that log, so an event-only write (no tracker edit) must
// invalidate this too or `reached` goes stale.
let _appsCache = null; // { mtimeMs, evMtimeMs, rows }
function parseApplicationsMd() {
  let mtimeMs = 0;
  let evMtimeMs = 0;
  let missing = false;
  try { mtimeMs = fs.statSync(APPS_MD).mtimeMs; } catch { missing = true; }
  try { evMtimeMs = fs.statSync(STATUS_EVENTS_PATH).mtimeMs; } catch { /* no events logged yet */ }
  if (_appsCache && _appsCache.mtimeMs === mtimeMs && _appsCache.evMtimeMs === evMtimeMs) return _appsCache.rows;
  if (missing) {
    // Fresh install / pre-onboarding: the tracker doesn't exist yet. Return an
    // empty set instead of throwing so /api/applications and the follow-up
    // endpoints don't 500 on first launch (caches as mtime 0; once onboarding
    // creates applications.md, statSync returns a real mtime and this misses).
    _appsCache = { mtimeMs: 0, evMtimeMs, rows: [] };
    return _appsCache.rows;
  }
  const text = fs.readFileSync(APPS_MD, 'utf8');
  const lines = text.split('\n');
  const rows = [];

  for (const line of lines) {
    // Parse with the single canonical tracker parser (lib/tracker.mjs).
    const base = parseTrackerLine(line);
    if (!base) continue; // header, separator, blank, or sub-9-column row
    if (base.columns < 10) {
      console.warn(`[parse] applications.md row #${base.num} SKIPPED: ${base.cellCount} columns, expected 10 — check for missing/extra pipes in that line`);
      continue;
    }
    if (base.cellCount > 10) {
      console.warn(`[parse] applications.md row #${base.num}: ${base.cellCount} columns, expected 10 — extra pipe in a field? Notes may be truncated`);
    }

    const num = base.num;
    const resume = base.resume;
    // Stripped report path (or the raw cell if it was not a markdown link).
    const report = base.reportPath;
    const role = base.role;
    const notes = base.notes;

    // Enrich from report header (cached per mtime)
    const header = report && report !== '-' ? readReportHeader(report) : null;
    const url        = header?.url || null;
    const sectorRaw  = header?.domain || null;
    const sector     = normalizeSector(sectorRaw);
    const compStated = header?.compStated || null;
    const legitimacy = header?.legitimacy || null;
    const source     = classifySource(notes, url);

    rows.push({
      id: num,
      date: base.date,
      company: base.company,
      role,
      score: parseScore(base.score),
      scoreRaw: base.score,
      status: base.status,
      pdf: base.pdf === '✅',
      resume,
      report: report || null,
      notes,
      archetype: inferArchetype(role),
      // Enriched from report headers — null if missing in report or no JD comp stated
      salary: null,        // kept for legacy callers that did $XXk math; comp is in compStated
      compStated,          // e.g., "$198,200 – $297,200" — display string from the JD
      target: null,
      sector,              // canonical short label (e.g., 'Cybersecurity', 'Fintech')
      sectorRaw,           // original Block A "Domain" string for hover tooltip
      size: null,
      url,
      source,              // 'Self-sourced' | 'Referral' | 'API Scan' | 'Agent Scan'
      legitimacy,          // 'High Confidence' | 'Proceed with Caution' | 'Suspicious' | null
    });
  }
  // Stamp the furthest funnel rung each row ever reached. The browser cannot
  // read the event log, so without this the UI can only see the live status and
  // the [reached:] tag, and undercounts anyone who replied then got rejected.
  const { furthestIdx } = makeFurthestIdx(parseStatusEvents());
  for (const r of rows) {
    const i = furthestIdx(r);
    r.reached = i >= 0 ? FUNNEL_ORDER[i] : null;
    // Recruiter-inbound: the approach came before the application, so this row's
    // reply is not evidence that the user's outbound applications are working.
    r.inbound = isInbound(r.notes);
  }

  _appsCache = { mtimeMs, evMtimeMs, rows };
  return rows;
}

// Targeted in-place update — only modifies the specific cells, preserving all original formatting.
// Column positions in the pipe-split array:
//   [0]='' [1]=# [2]=date [3]=company [4]=role [5]=score [6]=status [7]=pdf [8]=resume [9]=report [10]=notes [11]=''
// hint.company is used to disambiguate when multiple rows share the same id (batch collision artifact).
// hint.eventDate is when the change actually happened (booked/notified), if the
// caller knows it; omitted, the event log falls back to today as it always did.
function patchRowInMd(id, updates, hint = {}) {
  const text = fs.readFileSync(APPS_MD, 'utf8');
  const lines = text.split('\n');

  // Collect all lines that match this id
  const candidates = [];
  lines.forEach((line, idx) => {
    if (!line.startsWith('|')) return;
    const cells = line.split('|');
    if (cells.length < 10) return;
    if (parseInt(cells[1].trim(), 10) !== id) return;
    candidates.push({ idx, cells, company: cells[3].trim() });
  });

  if (candidates.length === 0) return false;

  // Pick exact company match when available, otherwise first candidate
  const target = (hint.company && candidates.find(c => c.company === hint.company))
    || candidates[0];

  const newLines = [...lines];
  if (updates.status !== undefined) target.cells[6] = ` ${updates.status} `;
  if (updates.notes !== undefined) target.cells[10] = ` ${updates.notes} `;
  newLines[target.idx] = target.cells.join('|');

  fs.writeFileSync(APPS_MD, newLines.join('\n'), 'utf8');
  // Record the status transition in the sidecar event log (dated), so analytics
  // like time-to-rejection can be derived without altering applications.md.
  if (updates.status !== undefined) logStatusEvent(id, updates.status, { company: target.company, date: hint.eventDate });
  return true;
}
// Days from application to rejection, using the date each app was MARKED
// Rejected in the dashboard (its Rejected status event). The apply baseline is
// the logged Applied event date when present, else the app row's Date column.
function rejectionTimingStats() {
  const events = parseStatusEvents();
  const rowDateById = new Map(parseApplicationsMd().map(r => [String(r.id), r.date]));
  // Earliest Applied event per app (the anchor for elapsed time).
  const appliedByApp = new Map();
  for (const e of events) {
    if (e.status !== 'Applied') continue;
    const prev = appliedByApp.get(e.app);
    if (!prev || e.date < prev) appliedByApp.set(e.app, e.date);
  }
  const days = [];
  // A rejection dated before its own apply anchor is not measurable, but it is
  // also not nothing: it means one of the two dates is wrong. Counting the drops
  // keeps that visible. While every date was stamped "now" this could not
  // happen; it became reachable the moment users could enter a date by hand.
  let excluded = 0;
  // Earliest Rejected event per app. An application is rejected once; a second
  // Rejected row is a data artifact (a re-click, or a status re-entered during a
  // backfill), not a second rejection. Iterating raw events counted those twice,
  // which barely showed while every date was "now" and both copies landed a few
  // days apart — but once apply dates could be backdated, one duplicated app
  // could contribute two large outliers and visibly drag the average.
  const rejectedByApp = new Map();
  for (const e of events) {
    if (e.status !== 'Rejected') continue;
    const prev = rejectedByApp.get(e.app);
    if (!prev || e.date < prev) rejectedByApp.set(e.app, e.date);
  }
  for (const [app, date] of rejectedByApp) {
    const base = appliedByApp.get(app) || rowDateById.get(app);
    if (!base) continue;
    const d = Math.round((Date.parse(date) - Date.parse(base)) / 86400000);
    if (Number.isFinite(d) && d >= 0) days.push(d);
    else excluded++;
  }
  const n = days.length;
  if (!n) return { n: 0, avgDays: null, medianDays: null, excluded };
  const avgDays = Math.round((days.reduce((a, b) => a + b, 0) / n) * 10) / 10;
  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const medianDays = n % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  return { n, avgDays, medianDays, excluded };
}

export { parseApplicationsMd, patchRowInMd, rejectionTimingStats };

