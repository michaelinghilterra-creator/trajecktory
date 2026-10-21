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

// The row to reuse, or null. A live row beats an archived one, a referral row
// beats a TA-book row (the higher bucket), then the oldest id wins, so every
// caller lands on the same representative.
export function findExistingContact(candidate, rows) {
  const hits = (rows || []).filter(row => sameContact(candidate, row));
  if (!hits.length) return null;
  hits.sort((x, y) =>
    (x.status === 'Archived') - (y.status === 'Archived') ||
    (x.source !== 'referral') - (y.source !== 'referral') ||
    (Number(x.id) || 0) - (Number(y.id) || 0));
  return hits[0];
}

// Every row an ADD path must check before it files someone, in the one shape
// sameContact reads. One bucket per contact: a person who is already a live
// referral is the highest bucket, so a TA or DM importer treats that row as
// "already on file" instead of filing a second, cold row for the same human.
// Referral rows come back tagged source: 'referral' (their id is a referral id,
// not a TA id); TA-book rows are passed through untouched. Archived referrals do
// not hold a bucket, so they do not block an add.
export function heldContactRows({ ta = [], referrals = [] } = {}) {
  const live = (referrals || [])
    .filter(row => String(row?.status || '').trim() !== 'Archived')
    .map(row => {
      const parts = String(row.name || '').trim().split(/s+/).filter(Boolean);
      return {
        id: row.id, source: 'referral', status: row.status || '',
        first: parts[0] || '', last: parts.slice(1).join(' '),
        company: row.where || '', linkedin: row.linkedin || '',
      };
    });
  return [...live, ...(ta || [])];
}

// A stored address can carry a verification tag, "name@host [v:ok:...]". Cut the tag out with plain string
// searches, not a regex: whitespace around the tag made the regex form quadratic on long input.
function cleanEmail(value) {
  const text = String(value || '');
  const start = text.toLowerCase().indexOf('[v:');
  if (start < 0) return text.trim().toLowerCase();
  const end = text.indexOf(']', start);
  return (text.slice(0, start) + (end < 0 ? '' : text.slice(end + 1))).trim().toLowerCase();
}

export function findExistingPerson(candidate, { ta = [], referrals = [] } = {}) {
  const candidateEmail = cleanEmail(candidate?.email);
  const candidateLinkedin = linkedinKey(candidate?.linkedin);
  const candidateName = cleanName(candidate?.name);
  const matches = (row, source) => {
    const rowEmail = cleanEmail(row?.email);
    if (candidateEmail && rowEmail && candidateEmail === rowEmail) return true;
    const rowLinkedin = linkedinKey(row?.linkedin);
    if (candidateLinkedin && candidateLinkedin === rowLinkedin) return true;
    const rowName = source === 'ta' ? fullName(row) : cleanName(row?.name);
    const rowCompany = source === 'ta' ? row?.company : row?.where;
    return !!candidateName && candidateName === rowName
      && companyCompatible(candidate?.company, rowCompany);
  };
  const hits = [
    ...ta.filter(row => matches(row, 'ta')).map(row => ({ source: 'ta', row })),
    ...referrals.filter(row => matches(row, 'referral')).map(row => ({ source: 'referral', row })),
  ];
  if (!hits.length) return null;
  hits.sort((a, b) =>
    (a.row.status === 'Archived') - (b.row.status === 'Archived')
    || (a.source === 'referral') - (b.source === 'referral')
    || Number(a.row.id) - Number(b.row.id));
  return hits[0];
}
