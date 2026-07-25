// tt-reconcile-core.mjs — the ONE decision for TA reconcile, shared by the
// dashboard route (routes/tt-reconcile.mjs) and the headless CLI
// (reconcile-ta.mjs) so the two can never drift. Pure: takes parsed apps + TA
// rows, returns what to archive and which active companies lack a contact.
//
// Rule: a TA contact is archived when their company has logged applications and
// NONE of them are still active (Evaluated..Offer). Recruiters are external
// firms, not tied to one opportunity, and are never considered here.
import { ACTIVE_STATUSES } from './statuses.mjs';

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

  // Archive a contact when their company has apps and none are still active.
  const toArchive = [];
  for (const c of ttRows) {
    const companyApps = appsByCompany.get(normCompany(c.company)) || [];
    if (companyApps.length === 0) continue;               // no apps logged — leave alone
    if (companyApps.some(a => ACTIVE_STATUSES.includes(a.status))) continue; // still active — keep
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

  // Active companies (>=1 active app) with no TA contact yet — the discover targets.
  const ttCompaniesNorm = new Set(ttRows.map(c => normCompany(c.company)));
  const companiesNeedingContacts = [];
  for (const [k, companyApps] of appsByCompany.entries()) {
    if (ttCompaniesNorm.has(k)) continue;
    const active = companyApps.filter(a => ACTIVE_STATUSES.includes(a.status));
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
