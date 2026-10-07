// contact-match.mjs: is this candidate someone we already hold a row for?
//
// Every path that ADDS a contact asks this one question before it writes, so a
// second application at the same employer reuses the person instead of filing
// them again as a stranger. The old per-route keys compared the exact
// normalized company string, so "Acme" and "Acme Commerce" were two
// different companies and the same human got a second row: Not Contacted, no
// correspondence, and a fresh LinkedIn invite offered on top of one already
// pending.
//
// Two signals, strongest first:
//   1. The same LinkedIn profile (linkedinKey), whatever the company cell says.
//      The same person can be filed under a parent brand and a product brand.
//   2. The same full name at a COMPATIBLE company: equal after normalizing, or
//      one a prefix of the other ("Acme" / "Acme (Parent Group)",
//      "Acme" / "Acme.io"). The prefix test is only ever combined with an
//      exact name match, never used on its own.
// Differing LinkedIn URLs do not veto a name + company match. That is the old
// behaviour (an exact name + company key skipped the add regardless of URL), and
// a row filed with a wrong profile must not let the right profile in as a twin.
import { linkedinKey, cleanName } from '../dashboard-web/server/lib/contact-identity.mjs';
import { normalizeCompany } from './identity.mjs';

const MIN_PREFIX = 3;

export function companyCompatible(a, b) {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_PREFIX && long.startsWith(short);
}

const fullName = row => cleanName(`${row?.first ?? ''} ${row?.last ?? ''}`);

export function sameContact(a, b) {
  const ka = linkedinKey(a?.linkedin);
  if (ka && ka === linkedinKey(b?.linkedin)) return true;
  const na = fullName(a);
  return !!na && na === fullName(b) && companyCompatible(a?.company, b?.company);
}

// The row to reuse, or null. A live row beats an archived one, then the oldest
// id wins, so every caller lands on the same representative.
export function findExistingContact(candidate, rows) {
  const hits = (rows || []).filter(row => sameContact(candidate, row));
  if (!hits.length) return null;
  hits.sort((x, y) =>
    (x.status === 'Archived') - (y.status === 'Archived') ||
    (Number(x.id) || 0) - (Number(y.id) || 0));
  return hits[0];
}
