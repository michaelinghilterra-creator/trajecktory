// contact-identity.mjs: the one place that decides whether two rows are the same
// PERSON, exactly as lib/identity.mjs is the one place that decides whether two
// rows are the same POSTING. Guarded by tests/identity-single-source.test.mjs.
//
// It exists because there were four answers to that question and they disagreed:
// canonicalLinkedinUrl, slugOf, a byte-identical redeclaration of slugOf in the
// referrals route, and profileHandle. A profile therefore keyed three different
// ways depending on which code path reached it, which is how the same human ended
// up filed twice with two separate outreach histories.
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
//   - Unicode. profileHandle's charset is ASCII-only, so it truncated
//     ".../in/josé-ex" to "jos", while slugOf left "%C3%A9" encoded. The encoded
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
