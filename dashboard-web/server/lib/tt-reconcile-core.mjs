// tt-reconcile-core.mjs — the ONE decision for TA reconcile, shared by the
// dashboard route (routes/tt-reconcile.mjs) and the headless CLI
// (reconcile-ta.mjs) so the two can never drift. Pure: takes parsed apps + TA
// rows, returns what to archive, which active companies lack a contact, and
// which contacted companies still lack a hiring principal.
//
// Rule: a TA contact is archived when their company has logged applications and
// NONE of them are still worth keeping — i.e. none are active (Evaluated..Offer)
// AND none are "No Response". Recruiters are external firms, not tied to one
// opportunity, and are never considered here.
import { OUTREACH_ELIGIBLE_STATUSES, OUTREACH_DEAD_STATUSES } from './statuses.mjs';
import { parseInfluenceTier, INFLUENCE_RANK } from '../../../lib/influence-tier.mjs';

// The outreach rule lives in statuses.mjs as the single source of truth, shared
// with the follow-up queues so the two can never disagree:
//   ELIGIBLE = live funnel (Applied..Offer) + No Response — worth a contact.
//   DEAD     = {Rejected, Discarded, SKIP, Closed, Not a Fit} — safe to archive.
// Evaluated is in NEITHER set on purpose: an evaluated-not-applied company is
// pre-application limbo, so reconcile neither sources a contact for it nor
// archives one it already has (you may apply next). See OUTREACH_* in statuses.mjs.

export function normCompany(s) {
  // Drop a " — City" / " - City" suffix and common legal suffixes before
  // stripping non-alphanumerics, so "Stripe" and "Stripe, Inc." normalize to the
  // same key. This stays an EXACT match on the normalized form (not loose token
  // matching), so it fixes suffix variants without risking archiving a contact
  // whose company only loosely resembles a dead application's company.
  return (s || '')
    .toLowerCase()
    .split(/\s[—–-]\s/)[0]
    .replace(/\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|company|co|plc|gmbh|s\.a|sa|ag|nv|bv|pty)\b\.?/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

// apps: parseApplicationsMd() output. ttRows: parseTargetTalentMd() output ALREADY
// filtered to non-Archived. Returns { toArchive, companiesNeedingContacts,
// companiesNeedingPrincipal }, the exact shape the preview endpoint returns.
export function reconcilePreview(apps, ttRows) {
  const appsByCompany = new Map();
  for (const a of apps) {
    const k = normCompany(a.company);
    if (!k) continue;
    if (!appsByCompany.has(k)) appsByCompany.set(k, []);
    appsByCompany.get(k).push(a);
  }

  // Archive a contact only when their company is DEFINITIVELY dead: it has apps
  // and EVERY one is terminal (Rejected/Discarded/SKIP/Closed/Not a Fit). Any
  // live/No-Response app keeps the contact; an Evaluated-only company is limbo and
  // is left alone (the `every` is false when any app is Evaluated), so a contact
  // sourced just before you apply is never wiped. This replaced a "none are
  // keep-worthy" test, which would have archived Evaluated-only contacts.
  const toArchive = [];
  for (const c of ttRows) {
    const companyApps = appsByCompany.get(normCompany(c.company)) || [];
    if (companyApps.length === 0) continue;               // no apps logged — leave alone
    if (!companyApps.every(a => OUTREACH_DEAD_STATUSES.includes(a.status))) continue; // any live/limbo app — keep
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

  // Companies worth a contact (>=1 outreach-eligible app: currently-live funnel or
  // a ghosted No Response) that have no TA contact yet — the discover targets. An
  // Evaluated-only company is excluded here: no application means no reason to
  // source a contact yet. Uses the SAME eligible set as the follow-up queues.
  const ttCompaniesNorm = new Set(ttRows.map(c => normCompany(c.company)));
  const companiesNeedingContacts = [];
  for (const [k, companyApps] of appsByCompany.entries()) {
    if (ttCompaniesNorm.has(k)) continue;
    const active = companyApps.filter(a => OUTREACH_ELIGIBLE_STATUSES.includes(a.status));
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

  // A mapped company still needs a principal when every known contact sits
  // below the influence line. This is distinct from contact discovery because
  // it records what is present while exposing the missing decision-maker.
  const companiesNeedingPrincipal = [];
  for (const [k, companyApps] of appsByCompany.entries()) {
    const active = companyApps.filter(a => OUTREACH_ELIGIBLE_STATUSES.includes(a.status));
    if (active.length === 0) continue;
    const contacts = ttRows.filter(row => normCompany(row.company) === k);
    if (contacts.length === 0) continue;
    const canInfluence = contacts.some(row => {
      const tier = row.influenceTier || parseInfluenceTier(row.notes);
      return (INFLUENCE_RANK[tier] ?? INFLUENCE_RANK.ta) >= INFLUENCE_RANK.peer;
    });
    if (canInfluence) continue;
    const mostRecent = active.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    companiesNeedingPrincipal.push({
      company: mostRecent.company,
      exampleRole: mostRecent.role,
      appCount: active.length,
      mostRecentApp: { id: mostRecent.id, role: mostRecent.role, status: mostRecent.status, date: mostRecent.date },
      contactCount: contacts.length,
    });
  }
  companiesNeedingPrincipal.sort((a, b) => (b.mostRecentApp.date || '').localeCompare(a.mostRecentApp.date || ''));

  return { toArchive, companiesNeedingContacts, companiesNeedingPrincipal };
}
