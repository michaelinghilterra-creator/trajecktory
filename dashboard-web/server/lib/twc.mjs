// lib/twc.mjs — the Texas Workforce Commission (TWC) work-search activity report.
//
// WHY THIS EXISTS
// A claimant on unemployment must keep a running log of job-search activities and
// produce it on request or lose benefits. The user already does all of that
// searching inside trajecktory, so this assembles the log straight from their own
// data instead of asking them to hand-keep it. Pick a date range, get one row per
// dated activity in that window, export as CSV whose columns mirror the TWC Work
// Search Log. TWC accepts CSV — the exact PDF form is not required.
//
// WHAT COUNTS AS AN ACTIVITY (all TWC-acceptable):
//   - applications sent   → "Applied online for a job"
//   - interviews          → each dated interview event ("Interview — Phone Screen")
//   - follow-up (email)   → each dated Sent email to an employer contact
//   - networking          → each dated LinkedIn connection request to a contact
// Raw evaluations are deliberately NOT counted (hundreds of them; padding).
//
// OUTREACH IS SOURCED FROM THE CORRESPONDENCE LOGS, not follow-ups.md alone.
// follow-ups.md only captures a touch when the "also log to application"
// cross-log fires, so every bulk / queue send (the bulk of the real outreach)
// never reached it and the report was blind to it — e.g. a fortnight showing 13
// follow-ups when 90 emails and 60 LinkedIn requests had actually gone out. The
// per-contact correspondence logs (target-talent + recruiters) ARE the authoritative
// record of every Sent message, so we read them directly and merge follow-ups.md on
// top, deduped, so a cross-logged touch (present in both) is counted exactly once and
// a hand-entered follow-up with no correspondence file is still kept.
//
// DATE SOURCING is the subtle part. The applications.md Date column is the
// evaluation/scrape date, NOT when the user applied, so an application is dated
// (best first): apply-dates.json → earliest "Applied" status-event → the tracker
// Date column (approximate; flagged). Interviews and follow-ups carry their own
// real dates.
//
// Pure apart from the sidecar reads (mirrors lib/activity.mjs), so it is unit
// testable. enrichEmployers is the one impure, network-touching export.
import { parseApplicationsMd } from './applications.mjs';
import { readApplyDates, parseStatusEvents } from './sidecars.mjs';
import { parseFollowupsMd } from './followups.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';
import { parseReferralsMd, readReferralCorrespondence, resolveReferralLink } from './referrals.mjs';
import { isLinkedInEntry } from './channels.mjs';
import { normalizeCompany } from '../../../lib/identity.mjs';
import { appReached, isInterviewStage } from './statuses.mjs';
import { readEmployerDirectory, employerKey, hasEmployer, mergeEmployers } from './employer-directory.mjs';
import { toCsv } from './csv.mjs';
import { readConnects } from './connects.mjs';
import { generateText, draftModel } from './anthropic.mjs';

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

// TWC weeks run Sunday–Saturday ("a week begins on Sunday and ends on Saturday").
// Returns the Sunday on or before `ymd`, so activities group into benefit weeks.
// Parsed as UTC deliberately, exactly like activity.mjs weekStartOf: a local-time
// parse shifts a date-only string across a week boundary west of UTC and silently
// moves Sunday's work into the wrong week. NOTE this is Sunday-based on purpose —
// activity.mjs weekStartOf is Monday-based (ISO) and must not be reused here.
export function twcWeekStart(ymd) {
  if (!isYmd(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay: 0 = Sunday
  return d.toISOString().slice(0, 10);
}

// Map an application's current status to a TWC "Result of your activity" phrase.
// TWC's own examples: submitted job application, sent a résumé, interviewed, hired,
// not hired, no reply, other. The application row reflects that application's
// outcome, so a role that later rejected reads "Not hired" on its apply row.
const RESULT_BY_STATUS = {
  Evaluated: 'Submitted application',
  Applied: 'Submitted application',
  'Phone Screen': 'Interviewed',
  '1st Interview': 'Interviewed',
  '2nd Interview': 'Interviewed',
  '3rd Interview': 'Interviewed',
  Offer: 'Offer received',
  Rejected: 'Not hired',
  'No Response': 'No reply',
  Closed: 'Posting closed',
  Discarded: 'Withdrew',
  'Not a Fit': 'Not a fit',
};
function resultForStatus(status) { return RESULT_BY_STATUS[status] || 'Other'; }

// The CSV header row — mirrors the TWC Work Search Log fields, with a leading
// benefit-week column so each activity is grouped to its Sunday–Saturday week.
export const TWC_CSV_HEADERS = [
  'Week of (Sun)', 'Date', 'Work search activity', 'Type of job you are seeking',
  'Employer name', 'Employer address', 'Employer web page', 'Employer phone',
  'Person contacted', 'Method of contact', 'Result',
];

/**
 * Build the flat, dated activity list for [from, to] inclusive (YYYY-MM-DD, either
 * open-ended). One row per application (deduped), per interview event, and per
 * follow-up touch, joined to the cached employer directory for address/phone.
 */
export function buildActivities({ from, to } = {}) {
  const apps = safe(parseApplicationsMd, []);
  const byId = new Map(apps.map(a => [String(a.id), a]));
  const applyDates = safe(readApplyDates, {}) || {};
  const events = safe(parseStatusEvents, []) || [];
  const followups = safe(parseFollowupsMd, []) || [];
  const directory = safe(readEmployerDirectory, {}) || {};

  // Earliest dashboard-logged "Applied" event per app — the fallback apply date
  // when apply-dates.json has no entry.
  const earliestApplied = new Map();
  for (const e of events) {
    if (e.status !== 'Applied' || !isYmd(e.date)) continue;
    const cur = earliestApplied.get(e.app);
    if (!cur || e.date < cur) earliestApplied.set(e.app, e.date);
  }

  const empFor = (company) => directory[employerKey(company)] || null;
  const webPage = (app, emp) => (app && app.url) || (emp && emp.website) || '';

  // Company → its applications, so an outreach touch can borrow the role the user
  // is seeking there (the TWC "Type of job" column) when it is unambiguous. Left
  // blank when a company has zero or several open applications rather than guessing.
  const appsByCompany = new Map();
  for (const app of apps) {
    const k = normalizeCompany(app.company);
    if (!k) continue;
    if (!appsByCompany.has(k)) appsByCompany.set(k, []);
    appsByCompany.get(k).push(app);
  }
  const roleFor = (company) => {
    const list = appsByCompany.get(normalizeCompany(company)) || [];
    return list.length === 1 ? { role: list[0].role || '', appId: list[0].id } : { role: '', appId: '' };
  };

  // Dedup keys so a correspondence touch that ALSO lives in follow-ups.md (the
  // cross-logged ones) is counted once. Two independent signatures because a
  // follow-up row may match on either: the exact subject line (cross-logged rows
  // store "Subject: …") OR the same contact reached the same day at the same
  // company (catches rows whose notes are the full email body, no "Subject:").
  const loggedSig = new Set();
  const normSub = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const normNm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const subjOf = (notes) => { const m = /subject:\s*(.+)$/i.exec(String(notes || '')); return m ? m[1] : notes; };

  const activities = [];

  // 1) Applications — one row per app that ever reached Applied (or beyond).
  for (const app of apps) {
    if (!appReached(app, 'Applied')) continue;
    const raw = applyDates[String(app.id)];
    const applyDate = typeof raw === 'string' ? raw : (raw && raw.date);
    let date = null, approx = false;
    if (isYmd(applyDate)) date = applyDate;
    else if (earliestApplied.has(String(app.id))) date = earliestApplied.get(String(app.id));
    else if (isYmd(app.date)) { date = app.date; approx = true; } // tracker Date = eval date
    if (!date) continue;
    const emp = empFor(app.company);
    activities.push({
      kind: 'application',
      date, week: twcWeekStart(date), dateApprox: approx,
      activity: 'Applied online for a job',
      role: app.role || '', company: app.company || '',
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: webPage(app, emp),
      employerPhone: (emp && emp.phone) || '',
      contact: '', method: 'Online application',
      result: resultForStatus(app.status),
      appId: app.id,
    });
  }

  // 2) Interviews — one row per dated interview status-event.
  for (const e of events) {
    if (!isInterviewStage(e.status) || !isYmd(e.date)) continue;
    const app = byId.get(String(e.app));
    const company = (app && app.company) || e.company || '';
    const emp = empFor(company);
    activities.push({
      kind: 'interview',
      date: e.date, week: twcWeekStart(e.date), dateApprox: false,
      activity: `Interview — ${e.status}`,
      role: (app && app.role) || '', company,
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: webPage(app, emp),
      employerPhone: (emp && emp.phone) || '',
      contact: '', method: '',
      result: 'Interviewed',
      appId: e.app,
    });
  }

  // 3) Follow-ups from follow-ups.md — one row per dated touch. This is the only
  // source that carries a named contact + method; online applications leave both
  // blank. Each row also seeds the dedup index so the correspondence sweep below
  // does not re-add a touch that was cross-logged here.
  for (const f of followups) {
    if (!isYmd(f.date)) continue;
    const app = byId.get(String(f.appNum));
    const company = f.company || (app && app.company) || '';
    const co = normalizeCompany(company);
    loggedSig.add(`s|${f.date}|${co}|${normSub(subjOf(f.notes))}`);
    if ((f.contact || '').trim()) loggedSig.add(`c|${f.date}|${co}|${normNm(f.contact)}`);
    const emp = empFor(company);
    activities.push({
      kind: 'followup',
      date: f.date, week: twcWeekStart(f.date), dateApprox: false,
      activity: `Follow-up (${f.channel || 'Other'})`,
      role: f.role || (app && app.role) || '', company,
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: webPage(app, emp),
      employerPhone: (emp && emp.phone) || '',
      contact: f.contact || '', method: f.channel || '',
      result: 'Sent follow-up',
      appId: f.appNum,
    });
  }

  // 4) Outreach straight from the correspondence logs (target-talent + referrals).
  // Every Sent message is a dated employer contact: an email follow-up, or a
  // LinkedIn connection request (networking). Deduped against the follow-ups.md
  // rows above so a cross-logged touch is not double-counted. This is what makes
  // the report reflect ALL outreach automatically, no manual cross-log required.
  //
  // The target-talent rows are parsed once here and reused for the referral-twin
  // check and the section-5 ledger join. Referrals are folded in as a second book,
  // but ONLY the unlinked ones: a referral with a TA/recruiter twin shares (and logs
  // to) the twin's correspondence dir, so it is already swept via the TA book above;
  // reading it again here would double-count it. Each book adapts its own row shape
  // (TA has first/last + a shared-namespace id; a referral has a single name and an
  // id from a DIFFERENT namespace, so it must not seed the ledger's id-based dedup).
  const taRows = safe(parseTargetTalentMd, []) || [];
  const unlinkedReferrals = (safe(parseReferralsMd, []) || [])
    .filter(r => !resolveReferralLink(r, taRows));
  const books = [
    { rows: taRows, read: readTTCorrespondence,
      companyOf: (r) => r.company, contactOf: (r) => `${r.first || ''} ${r.last || ''}`.trim(), idOf: (r) => r.id },
    { rows: unlinkedReferrals, read: readReferralCorrespondence,
      companyOf: (r) => r.where, contactOf: (r) => r.name || '', idOf: () => null },
  ];
  for (const book of books) {
    for (const c of book.rows) {
      let msgs = [];
      try { msgs = book.read(c.id) || []; } catch { msgs = []; }
      for (const msg of msgs) {
        if (msg.direction !== 'Sent') continue;
        const date = String(msg.timestamp || '').slice(0, 10);
        if (!isYmd(date)) continue;
        const company = book.companyOf(c) || '';
        const co = normalizeCompany(company);
        const subject = msg.subject || '';
        const contactName = book.contactOf(c);
        // Already captured as a follow-ups.md row?
        if (loggedSig.has(`s|${date}|${co}|${normSub(subject)}`)) continue;
        if (contactName && loggedSig.has(`c|${date}|${co}|${normNm(contactName)}`)) continue;
        // Guard against the same Sent message being read twice.
        const selfSig = `x|${date}|${co}|${normNm(contactName)}|${normSub(subject)}`;
        if (loggedSig.has(selfSig)) continue;
        loggedSig.add(selfSig);

        const linkedin = isLinkedInEntry(msg);
        const emp = empFor(company);
        const { role, appId } = roleFor(company);
        activities.push({
          kind: linkedin ? 'outreach' : 'followup',
          date, week: twcWeekStart(date), dateApprox: false,
          activity: linkedin ? 'Networking — LinkedIn connection request' : 'Follow-up (Email)',
          role, company,
          employerAddress: (emp && emp.hqAddress) || '',
          employerWebPage: (emp && emp.website) || '',
          employerPhone: (emp && emp.phone) || '',
          contact: contactName, method: linkedin ? 'LinkedIn' : 'Email',
          result: linkedin ? 'Sent connection request' : 'Sent follow-up',
          appId, contactId: book.idOf(c),
        });
      }
    }
  }

  // 5) LinkedIn connection requests straight from the authoritative connects
  // ledger (data/linkedin-connects.json, written by lib/connects.mjs logConnect).
  // Section 4 only sees connects that were ALSO written to a correspondence log;
  // the manual "log a connect" button and any bulk/legacy import write ONLY the
  // ledger, so without this every such invite is invisible here while
  // weekly-collect.mjs already counts it (that mismatch is the bug this fixes).
  //
  // Identity is the contact id, not the name: logConnect now records the id of the
  // contact the invite went to, so a ledger connect dedups EXACTLY against the
  // section-4 connect for the same (date, contact id). Name is the fallback key for
  // legacy rows logged before id capture (until `node backfill-connect-ids.mjs`
  // stamps their ids). Employer is recovered by id → target-talent company (name as
  // the fallback), so these rows carry the same Employer/Type columns as the rest.
  const seenConnect = new Set();
  for (const a of activities) {
    if (a.kind !== 'outreach') continue;
    if (a.contactId !== undefined && a.contactId !== null) seenConnect.add(`id|${a.date}|${a.contactId}`);
    seenConnect.add(`nm|${a.date}|${normNm(a.contact)}`);
  }
  // taRows was parsed once in section 4 and is reused here.
  const taById = new Map();
  const taByName = new Map();
  for (const c of taRows) {
    if (c.id !== undefined && c.id !== null) taById.set(String(c.id), c.company || '');
    const k = normNm(`${c.first || ''} ${c.last || ''}`);
    if (k && !taByName.has(k)) taByName.set(k, c.company || '');
  }
  for (const e of (safe(readConnects, null) || [])) {
    const date = String((e && e.date) || '').slice(0, 10);
    if (!isYmd(date)) continue;
    const hasId = e.id !== undefined && e.id !== null && e.id !== '';
    const nm = normNm(e.name);
    // Already counted from correspondence (id when we have one, name otherwise), or
    // already emitted from an earlier ledger row for the same invite.
    if ((hasId && seenConnect.has(`id|${date}|${e.id}`)) || seenConnect.has(`nm|${date}|${nm}`)) continue;
    if (hasId) seenConnect.add(`id|${date}|${e.id}`);
    seenConnect.add(`nm|${date}|${nm}`);

    const company = (hasId && taById.get(String(e.id))) || taByName.get(nm) || '';
    const emp = company ? empFor(company) : null;
    const { role, appId } = company ? roleFor(company) : { role: '', appId: '' };
    activities.push({
      kind: 'outreach',
      date, week: twcWeekStart(date), dateApprox: false,
      activity: 'Networking — LinkedIn connection request',
      role, company,
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: (emp && emp.website) || '',
      employerPhone: (emp && emp.phone) || '',
      contact: e.name || '', method: 'LinkedIn',
      result: 'Sent connection request',
      appId, contactId: hasId ? e.id : null,
    });
  }

  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  return activities
    .filter(a => a.date && inRange(a.date))
    .sort((a, b) => a.date.localeCompare(b.date)
      || (a.company || '').localeCompare(b.company || '')
      || a.kind.localeCompare(b.kind));
}

// Per benefit-week activity counts, so the UI can show whether a week hit the
// required minimum. Each week also carries a per-kind breakdown (byKind) so the
// dashboard can show WHAT made up the week — applications vs LinkedIn networking
// vs follow-ups vs interviews — not just the total. `count` is retained (it is
// the sum of byKind) so an older client keeps working. Sorted by week ascending.
const TWC_KINDS = ['application', 'interview', 'followup', 'outreach'];
export function weeklyCounts(activities) {
  const map = new Map();
  const zero = () => TWC_KINDS.reduce((o, k) => (o[k] = 0, o), {});
  for (const a of activities) {
    const wk = a.week || 'unknown';
    if (!map.has(wk)) map.set(wk, { count: 0, byKind: zero() });
    const entry = map.get(wk);
    entry.count += 1;
    if (Object.prototype.hasOwnProperty.call(entry.byKind, a.kind)) entry.byKind[a.kind] += 1;
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, { count, byKind }]) => ({ week, count, byKind }));
}

// Distinct employers in a set of activities, each flagged with whether the
// directory already has it. Drives the "look up employer HQ + phone" action:
// only the un-cached ones need a web search.
export function employersInActivities(activities) {
  const seen = new Map();
  for (const a of activities) {
    const key = employerKey(a.company);
    if (!key || seen.has(key)) continue;
    seen.set(key, { company: a.company, cached: hasEmployer(a.company) });
  }
  return [...seen.values()];
}

// Serialize activities to the TWC CSV. Header row first, then one line per
// activity in the same column order.
export function toTwcCsv(activities) {
  const rows = [TWC_CSV_HEADERS.slice()];
  for (const a of activities) {
    rows.push([
      a.week || '', a.date || '', a.activity || '', a.role || '',
      a.company || '', a.employerAddress || '', a.employerWebPage || '', a.employerPhone || '',
      a.contact || '', a.method || '', a.result || '',
    ]);
  }
  return toCsv(rows);
}

// ── Employer HQ enrichment (web search) ─────────────────────────────────────────
// Look up each company's US headquarters mailing address + main phone via the same
// web-search path the TA-discovery step uses (generateText with the hosted
// web_search tool on the API-key path, --allowedTools WebSearch on the Claude-plan
// path; billing mode is honored inside generateText). Results are cached in the
// employer directory, so a report never re-searches a company already resolved.
//
// Scale guards copied from routes/tt-reconcile.mjs discover: bounded concurrency,
// a per-company hard timeout so one stalled search cannot hang the batch, and a
// per-company try/catch so a failure drops that company rather than the whole run.
const ENRICH_CONCURRENCY = 3;
const ENRICH_TIMEOUT_MS = 90000;
export const ENRICH_MAX = 15; // rate-limit protection, same cap as discover

function employerPrompt(company) {
  return `Find the UNITED STATES corporate headquarters mailing address and the main phone number for the company "${company}".

INSTRUCTIONS:
1. USE THE web_search tool. Try queries like:
   - "${company}" corporate headquarters address
   - "${company}" head office phone number
   - "${company}" contact us
2. Prefer the company's own official website or a reputable business directory.
3. Return the US headquarters. If the company is foreign-based with a US office, return the main US office; if it has no US presence, return the global HQ.
4. Put the full street address on one line (street, city, state, ZIP) and the main phone with area code.

Output ONLY this JSON object (your final response after searching), no prose, no markdown:
{ "hqAddress": "123 Main St, Austin, TX 78701", "phone": "(512) 555-0100", "website": "https://example.com" }

If you cannot find a reliable value, leave that field as an empty string. Never fabricate an address or phone number.`;
}

async function lookupEmployer(company) {
  const prompt = employerPrompt(company);
  const apiCall = generateText(prompt, {
    model: draftModel(),
    maxTokens: 1200,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2, allowed_callers: ['direct'] }],
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`employer lookup timeout after 90s for ${company}`)), ENRICH_TIMEOUT_MS));
  const text = await Promise.race([apiCall, timeout]);
  const m = String(text || '').match(/\{[\s\S]*\}/);
  const obj = m ? (() => { try { return JSON.parse(m[0]); } catch { return {}; } })() : {};
  const hqAddress = String(obj.hqAddress || obj.address || '').trim();
  const phone = String(obj.phone || '').trim();
  const website = String(obj.website || '').trim();
  return { company, hqAddress, phone, website, source: (hqAddress || phone) ? 'web-search' : 'not-found' };
}

/**
 * Enrich (web-search + cache) the given companies. Skips any already cached.
 * Returns { updated: [entries written], errors: [{ company, error }], skipped:[names] }.
 * Caller enforces the ENRICH_MAX cap; this also de-dupes and drops cached names.
 */
export async function enrichEmployers(companies) {
  const wanted = [...new Set((companies || []).map(c => String(c || '').trim()).filter(Boolean))];
  const todo = wanted.filter(c => !hasEmployer(c));
  const skipped = wanted.filter(c => hasEmployer(c));
  const updated = [];
  const errors = [];

  for (let i = 0; i < todo.length; i += ENRICH_CONCURRENCY) {
    const slice = todo.slice(i, i + ENRICH_CONCURRENCY);
    const chunk = await Promise.all(slice.map(async (company) => {
      try { return await lookupEmployer(company); }
      catch (e) { return { company, error: e.message }; }
    }));
    // Write successes (including a searched-but-not-found result, so it is not
    // re-searched next time) in one merge. A thrown error is transient — do NOT
    // cache it, so the user can retry.
    const ok = chunk.filter(r => r && !r.error);
    if (ok.length) mergeEmployers(ok);
    for (const r of chunk) {
      if (r && r.error) errors.push({ company: r.company, error: r.error });
      else if (r) updated.push(r);
    }
  }
  return { updated, errors, skipped };
}
