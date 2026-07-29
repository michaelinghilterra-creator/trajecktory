// tt-reconcile-core.mjs — the ONE decision for TA reconcile, shared by the
// dashboard route (routes/tt-reconcile.mjs) and the headless CLI
// (reconcile-ta.mjs) so the two can never drift. Pure: takes parsed apps + TA
// rows, returns what to archive and which active companies lack a contact.
//
// Rule: a TA contact is archived when their company has logged applications and
// NONE of them are still worth keeping — i.e. none are active (Evaluated..Offer)
// AND none are "No Response". Recruiters are external firms, not tied to one
// opportunity, and are never considered here.
import { ACTIVE_STATUSES } from './statuses.mjs';

// Companies whose contacts are worth keeping (never auto-archived). This is the
// active funnel PLUS "No Response". A No-Response application is ghosted, not
// dead: the connect/email queues already treat it as still-applied (a No-Response
// row's furthest-reached rung is forced to Applied in statuses.mjs), so reconcile
// must agree — otherwise it archives exactly the contacts those queues surface for
// chasing a ghost, which is what silently wiped a batch of freshly-sourced
// contacts. Genuinely dead outcomes (Rejected, Discarded, SKIP, Closed) are NOT
// here, so their contacts still archive.
const KEEP_STATUSES = [...ACTIVE_STATUSES, 'No Response'];

export function normCompany(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// apps: parseApplicationsMd() output. ttRows: parseTargetTalentMd() output ALREADY
// filtered to non-Archived. Returns { toArchive, companiesNeedingContacts }, the
// exact shape the /api/tt-reconcile/preview endpoint returns.
export function reconcilePreview(apps, ttRows) {
  const appsByCompany = new Map();
  for (const a of apps) {
    const k = normCompany(a.company);
    if (!k) continue;
    if (!appsByCompany.has(k)) appsByCompany.set(k, []);
    appsByCompany.get(k).push(a);
  }

  // Archive a contact when their company has apps and none are worth keeping
  // (no active app and no ghosted "No Response" app to chase).
  const toArchive = [];
  for (const c of ttRows) {
    const companyApps = appsByCompany.get(normCompany(c.company)) || [];
    if (companyApps.length === 0) continue;               // no apps logged — leave alone
    if (companyApps.some(a => KEEP_STATUSES.includes(a.status))) continue; // active or ghosted — keep
    toArchive.push({
      id: c.id,
      first: c.first,
      last: c.last,
      company: c.company,
      title: c.title,
      reason: `${companyApps.length} application${companyApps.length === 1 ? '' : 's'} closed (${companyApps.map(a => a.status).slice(0, 3).join(', ')})`,
      relatedApps: companyApps.map(a => ({ id: a.id, status: a.status, role: a.role, date: a.date })),
    });
  }

  // Companies worth a contact (>=1 active OR ghosted "No Response" app) that have
  // no TA contact yet — the discover targets. Includes No Response so a ghosted
  // company you want to chase surfaces for sourcing, matching the keep rule above.
  const ttCompaniesNorm = new Set(ttRows.map(c => normCompany(c.company)));
  const companiesNeedingContacts = [];
  for (const [k, companyApps] of appsByCompany.entries()) {
    if (ttCompaniesNorm.has(k)) continue;
    const active = companyApps.filter(a => KEEP_STATUSES.includes(a.status));
    if (active.length === 0) continue;
    const mostRecent = active.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    companiesNeedingContacts.push({
      company: mostRecent.company,
      exampleRole: mostRecent.role,
      appCount: active.length,
      mostRecentApp: { id: mostRecent.id, role: mostRecent.role, status: mostRecent.status, date: mostRecent.date },
    });
  }
  companiesNeedingContacts.sort((a, b) => (b.mostRecentApp.date || '').localeCompare(a.mostRecentApp.date || ''));

  return { toArchive, companiesNeedingContacts };
}
