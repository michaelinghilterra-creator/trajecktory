// contact-identity.mjs: the one place that decides whether two rows are the same
import { normalizeCompany } from '../../../lib/identity.mjs';

// PERSON, exactly as lib/identity.mjs is the one place that decides whether two
// rows are the same POSTING. Guarded by tests/identity-single-source.test.mjs.
//
// It exists because there were four answers to that question and they disagreed:
// the CSV canonicalizer plus three separate profile parsers. A profile therefore
// keyed three different ways depending on which code path reached it, which is how
// the same human ended up filed twice with two separate outreach histories.
//
// WHY THIS IS NOT canonicalLinkedinUrl
//
// canonicalLinkedinUrl falls through: given a string with no /in/ segment it
// returns that string, stripped. That is correct for its own job, which is
// collapsing spellings of a URL for the CSV reconcile path, and it must keep
// doing it. It is catastrophic as an identity key, because the LinkedIn column is
// hand-maintained and full of "n/a", "-", and company pages. Group people on a
// truthy "n/a" and every contact who is not on LinkedIn merges into one person
// with one shared timeline. So linkedinKey returns '' for anything that is not a
// real profile, and that rule is the most important line in this file.
//
// Two more things it fixes, both of which cost real merges before:
//   - Whitespace. canonicalLinkedinUrl's capture excludes / ? # but not spaces,
//     so ".../in/jane-doe (personal)" keyed differently from ".../in/jane-doe".
//   - Unicode. One old parser's charset was ASCII-only, so it truncated
//     ".../in/josé-ex" to "jos", while another left "%C3%A9" encoded. The encoded
//     and literal spellings of one profile could never agree. The pre-pass below
//     percent-encodes non-ASCII before matching and decodes after, so both
//     spellings land on the same key.

// The identity key for a LinkedIn profile URL: a bare, lowercased /in/ slug, or
// '' when the input is not a profile URL. Never returns a truthy value it did not
// actually parse out of a /in/ segment.
export function linkedinKey(url) {
  const bounded = String(url ?? '').slice(0, 2000);
  let searchable = '';
  for (const character of bounded) {
    if (character.codePointAt(0) < 128) searchable += character;
    else {
      try { searchable += encodeURIComponent(character); }
      catch { searchable += character; }
    }
  }
  const match = searchable.match(/linkedin\.com\/in\/([A-Za-z0-9\-_%.]+)/i);
  if (!match) return '';
  let slug;
  try { slug = decodeURIComponent(match[1]); } catch { slug = match[1]; }
  let end = slug.length;
  while (end > 0 && slug.charCodeAt(end - 1) === 47) end--;
  return slug.slice(0, end).toLowerCase();
}

// Normalize a person name for matching: drop diacritics, parentheticals (maiden
// names), post-comma credentials (", MBA"), and emoji/symbols; lowercase; collapse
// whitespace. Returns the cleaned string.
export function cleanName(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/\([^)]*\)/g, ' ')                          // (maiden) / (nickname)
    .replace(/,.*$/, '')                                 // ", MBA" credentials
    .replace(/[^\p{L}\s'-]/gu, ' ')                      // drop emoji/symbols
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
export function nameTokens(s) { return cleanName(s).split(' ').filter(Boolean); }

// The stable address of one row: "ta:42", "referral:7", "influencer:3". The three
// stores each number from 1 with their own counter, so an id alone is ambiguous
// across them and a bare integer is never a safe key.
//
// A numeric STRING is accepted and normalized. Route params arrive as strings
// (req.params.id), and a version of this that returned '' for '42' would fail
// silently at exactly the call sites most likely to hit it. Anything that is not
// a whole number, including 4.5, NaN and 'abc', returns '' instead.
export function contactRef(source, id) {
  if (!source || id === null || id === undefined || id === '') return '';
  const n = Number(id);
  if (!Number.isInteger(n)) return '';
  return `${source}:${n}`;
}

const SOURCE_ORDER = { ta: 0, referral: 1, influencer: 2 };
const rowName = (source, row) => source === 'ta'
  ? [row.first, row.last].filter(Boolean).join(' ').trim()
  : String(row.name || '').trim();
const rowCompany = (source, row) => String(source === 'referral' ? row.where : (row.company || '')).trim();

export function resolvePeople({ ta = [], referrals = [], influencers = [], pins = {} } = {}) {
  const entries = [
    ...ta.map(row => ({ source: 'ta', row, ref: contactRef('ta', row.id) })),
    ...referrals.map(row => ({ source: 'referral', row, ref: contactRef('referral', row.id) })),
    ...influencers.map(row => ({ source: 'influencer', row, ref: contactRef('influencer', row.id) })),
  ].filter(entry => entry.ref).sort((a, b) => a.ref.localeCompare(b.ref));
  const byRef = new Map(entries.map(entry => [entry.ref, entry]));
  const alone = new Set(Object.entries(pins || {}).filter(([, pin]) => pin?.alone === true).map(([ref]) => ref));
  const claimed = new Set();
  const groups = [];
  const addGroup = (members, matchedBy) => {
    const unique = [...new Map(members.map(entry => [entry.ref, entry])).values()].sort((a, b) => a.ref.localeCompare(b.ref));
    if (!unique.length) return;
    unique.forEach(entry => claimed.add(entry.ref));
    groups.push({ entries: unique, matchedBy });
  };

  for (const ref of [...alone].sort()) {
    const entry = byRef.get(ref);
    if (entry) addGroup([entry], 'pin');
  }

  const adjacency = new Map();
  for (const [ref, pin] of Object.entries(pins || {})) {
    const other = pin?.with;
    if (!byRef.has(ref) || !byRef.has(other) || alone.has(ref) || alone.has(other)) continue;
    if (!adjacency.has(ref)) adjacency.set(ref, new Set());
    if (!adjacency.has(other)) adjacency.set(other, new Set());
    adjacency.get(ref).add(other);
    adjacency.get(other).add(ref);
  }
  for (const ref of [...adjacency.keys()].sort()) {
    if (claimed.has(ref)) continue;
    const stack = [ref];
    const component = [];
    while (stack.length) {
      const current = stack.pop();
      if (claimed.has(current)) continue;
      claimed.add(current);
      component.push(byRef.get(current));
      for (const next of adjacency.get(current) || []) if (!claimed.has(next)) stack.push(next);
    }
    addGroup(component, 'pin');
  }

  const taById = new Map(ta.map(row => [Number(row.id), byRef.get(contactRef('ta', row.id))]));
  for (const entry of entries.filter(item => item.source === 'referral')) {
    if (claimed.has(entry.ref)) continue;
    const match = String(entry.row.notes || '').match(/from\s+TA\s+Outreach\s+#(\d+)\b/i);
    const target = match ? taById.get(Number(match[1])) : null;
    if (target && !claimed.has(target.ref)) addGroup([entry, target], 'backref');
  }

  const keyed = new Map();
  for (const entry of entries) {
    if (claimed.has(entry.ref)) continue;
    const key = linkedinKey(entry.row.linkedin || entry.row.linkedinUrl);
    if (!key) continue;
    if (!keyed.has(key)) keyed.set(key, []);
    keyed.get(key).push(entry);
  }
  for (const members of keyed.values()) if (members.length > 1) addGroup(members, 'linkedinKey');
  for (const entry of entries) if (!claimed.has(entry.ref)) addGroup([entry], 'single');

  return groups.map(group => {
    const sorted = [...group.entries].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.ref.localeCompare(b.ref));
    const companyEntry = sorted.find(entry => normalizeCompany(rowCompany(entry.source, entry.row)));
    return {
      id: group.entries.map(entry => entry.ref).sort()[0],
      refs: group.entries.map(entry => entry.ref).sort(),
      matchedBy: group.matchedBy,
      linkedinKey: sorted.map(entry => linkedinKey(entry.row.linkedin || entry.row.linkedinUrl)).find(Boolean) || '',
      name: sorted.map(entry => rowName(entry.source, entry.row)).find(Boolean) || '',
      company: companyEntry ? rowCompany(companyEntry.source, companyEntry.row) : '',
      members: Object.fromEntries(sorted.map(entry => [entry.source, entry.row])),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
