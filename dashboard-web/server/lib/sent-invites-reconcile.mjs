/**
 * lib/sent-invites-reconcile.mjs — capture LinkedIn invites you sent DIRECTLY on
 * LinkedIn (outside the app), so the follow-up queue stops re-pitching people who
 * already have a pending invite out.
 *
 * WHY THIS EXISTS
 * The app only records a LinkedIn invite when you click "Mark sent". Invites you
 * send on LinkedIn itself leave no trace in our files, so the queue reads them as
 * never-invited (an invite sent directly on LinkedIn left no app record). LinkedIn
 * has no API for this, and the data
 * export is rate-limited to ~weekly. But LinkedIn's "My Network → Manage
 * invitations → Sent" page lists every pending sent invite live. This module
 * parses that page's copied text (name + headline, anchored on the "Withdraw"
 * control each row carries) or any linkedin.com/in/ URLs in it, matches each to a
 * target-talent contact, and reports which to mark 'Invite Pending'.
 *
 * PURE (no I/O) so it is unit-testable. The route does the correspondence write +
 * markInvitePending for confident matches; matching never guesses — an ambiguous
 * name (two contacts, no company tiebreak) is reported, never auto-applied.
 */
import { normalizeCompany } from '../../../lib/identity.mjs';
import { linkedinKey, cleanName, nameTokens } from './contact-identity.mjs';

// Lines that are LinkedIn UI chrome, a relative timestamp, or connection metadata —
// never a name/headline. Skipped while collecting the name + headline above a "Sent"
// row so interleaved noise the real clipboard carries ("· 2nd", "Message", "View
// profile", a mutual-connections line) does not get read as the name.
// "sent\b" catches BOTH "Sent 2w" and word-times like "Sent yesterday"; the "\d(st|nd
// |rd|th)" and leading "·" catch degree markers like "2nd" / "· 3rd".
const UI_LINE = /^(withdraw|pending|message|connect|following|follow|ignore|accept|remove|report|block|sent\b|·|status is reachable|\d+(?:st|nd|rd|th)\b|\d+\s*(sec|min|hour|h|d|w|mo|yr|day|week|month|year)s?(\s+ago)?|and\s+\d+\s+others?|(see|view)\s+profile|\d+\s+mutual connection)/i;

/**
 * Parse copied "Sent invitations" text into candidate invites. Confirmed against a
 * real copy: each pending invite is laid out as
 *     <Name> profile picture   (avatar alt — sometimes absent, e.g. no photo)
 *     <Name>
 *                              (blank)
 *     <Headline>               (a single line)
 *                              (blank)
 *     Sent <when>
 *                              (blank)
 *     Withdraw
 *     <the invite message>
 * so the two nearest NON-BLANK lines above a "Sent <when>" row (itself confirmed by a
 * "Withdraw" just below) are the NAME (upper) and HEADLINE (lower). The blank-line
 * separation is what makes this reliable — no need to guess which line is a name.
 * Profile URLs, if the copy carries any, are matched separately as a reliable bonus.
 * @returns {{name:string, headline:string, handle:string}[]}
 */
export function parseSentInvites(text) {
  // Bound user-controlled input up front: a real Sent list is a few thousand lines, so
  // cap raw size, line count, and per-line length. This stops a huge or crafted paste
  // from driving unbounded iteration (loop-bound injection) or slow regex backtracking.
  const raw = String(text || '').slice(0, 500_000);
  const lines = raw.split(/\r?\n/).slice(0, 20_000).map(l => l.trim().slice(0, 300));
  const invites = [];
  const seen = new Set();
  const push = (inv) => {
    const key = inv.handle || cleanName(inv.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    invites.push(inv);
  };

  const SENT = /^sent\s+(yesterday|today|just now|a\b|an\b|about\b|over\b|last\b|\d)/i;
  const withdrawBelow = (i) => {
    for (let j = i + 1, seenLines = 0; j < lines.length && seenLines < 3; j++) {
      if (!lines[j]) continue;
      seenLines++;
      if (/^withdraw$/i.test(lines[j])) return true;
    }
    return false;
  };

  // Explicit constant upper bound on the iteration (lines is already sliced to this,
  // but Math.min(len, CONST) is what makes the bound provable to static analysis).
  for (let i = 0, n = Math.min(lines.length, 20_000); i < n; i++) {
    if (!SENT.test(lines[i]) || !withdrawBelow(i)) continue;   // an invite row's timestamp
    // The two nearest MEANINGFUL lines above are [name, headline]. Skip blanks AND
    // interleaved UI/metadata (a "· 2nd" degree, a "Message" button, a mutual-
    // connections line) so the name is not misread. Bounded so a block with no real
    // name above (unusual) doesn't run up into the previous invite's message.
    const above = [];
    for (let j = i - 1; j >= 0 && above.length < 2 && (i - j) <= 12; j--) {
      const ln = lines[j];
      if (!ln || UI_LINE.test(ln)) continue;
      above.unshift(ln);
    }
    if (above.length < 2) continue;
    // Recover the name even if the copy dropped the blank and left the avatar-alt
    // ("Xxx's profile picture") or an "open to work"/"hiring" badge on the name line.
    const name = above[0]
      .replace(/[’']s?\s{1,10}profile picture$/i, '')
      .replace(/\s{1,10}(hiring|open to work),?\s{0,10}$/i, '')
      .trim();
    push({ name, headline: above[1], handle: '' });
  }

  // URL bonus: match any profile URLs the copy happens to include.
  const urlRe = /linkedin\.com\/in\/[A-Za-z0-9\-_%.]+/gi;
  let m;
  while ((m = urlRe.exec(raw)) !== null) {
    const handle = linkedinKey(m[0]);
    if (handle) push({ name: '', headline: '', handle });
  }
  return invites;
}

/**
 * Match parsed invites against target-talent rows.
 * @param {{name:string, headline:string, handle:string}[]} invites
 * @param {{id:any, first:string, last:string, company:string, linkedin:string}[]} taRows
 * @returns {{matched:{invite,contact}[], ambiguous:{invite,candidates}[], unmatched:object[]}}
 */
export function matchSentInvites(invites, taRows) {
  const rows = (taRows || []).map(r => ({
    r,
    handle: linkedinKey(r.linkedin),
    first: cleanName(r.first),
    last: cleanName(r.last),
    company: normalizeCompany(r.company || ''),
  }));
  const byHandle = new Map();
  for (const x of rows) if (x.handle) byHandle.set(x.handle, x);

  const matched = [], ambiguous = [], unmatched = [];
  for (const inv of invites) {
    // 1. Definitive: profile-URL handle match.
    if (inv.handle && byHandle.has(inv.handle)) { matched.push({ invite: inv, contact: byHandle.get(inv.handle).r }); continue; }
    // 2. Name match: first AND last both present in the invite's name tokens.
    const toks = new Set(nameTokens(inv.name));
    if (toks.size) {
      let cands = rows.filter(x => x.first && x.last && toks.has(x.first) && toks.has(x.last));
      if (cands.length > 1) {
        // Disambiguate by company appearing in the invite headline.
        const head = cleanName(inv.headline);
        const byCo = cands.filter(x => x.company && head.includes(x.company));
        if (byCo.length === 1) cands = byCo;
      }
      if (cands.length === 1) { matched.push({ invite: inv, contact: cands[0].r }); continue; }
      if (cands.length > 1) { ambiguous.push({ invite: inv, candidates: cands.map(x => x.r) }); continue; }
    }
    unmatched.push(inv);
  }
  return { matched, ambiguous, unmatched };
}
