// Universal search — one read endpoint that spans the curated contact books and
// the pipeline so the top-bar dropdown can find a person or company wherever it
// lives, without the user hunting through TA Outreach / Recruiters / Referrals /
// Pipeline by hand. Pure read: it reuses the existing parsers (no new file
// formats, no external calls), normalizes every hit into one shape, and returns
// people + companies grouped. Deliberately NOT a side-effect GET, so it stays
// token-free like the rest of the UI's read endpoints.
import express from 'express';
import { parseTargetTalentMd } from '../lib/target-talent.mjs';
import { parseReferralsMd } from '../lib/referrals.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';

export const router = express.Router();

const PER_GROUP = 12;                 // cap each of people / companies
const safe = (fn) => { try { return fn() || []; } catch { return []; } };
const lc = (s) => String(s || '').toLowerCase();

// Match when EVERY whitespace-separated term in the query appears somewhere in
// the haystack — so "smith john" finds "John Smith" and "acme director" narrows.
function makeMatcher(q) {
  const terms = lc(q).split(/\s+/).filter(Boolean);
  return (...fields) => {
    const hay = lc(fields.filter(Boolean).join(' '));
    return terms.every(t => hay.includes(t));
  };
}

// GET /api/search?q= — { people:[...], companies:[...] }, each item a flat
// { type, id, name, company, subtitle } the client maps to a deep-link.
router.get('/api/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ q, people: [], companies: [] });
    const match = makeMatcher(q);
    const people = [];

    for (const r of safe(parseTargetTalentMd)) {
      const name = `${r.first || ''} ${r.last || ''}`.trim();
      if (!match(name, r.company, r.title)) continue;
      people.push({
        type: 'ta', id: r.id, name, company: r.company || '',
        subtitle: [r.title, r.isPrincipal ? 'hiring principal' : ''].filter(Boolean).join(' · '),
      });
    }
    for (const r of safe(parseReferralsMd)) {
      if (!match(r.name, r.where, r.target, r.how)) continue;
      people.push({
        type: 'referral', id: r.id, name: r.name || '', company: r.where || '',
        subtitle: [r.target ? `target: ${r.target}` : r.how, 'referral'].filter(Boolean).join(' · '),
      });
    }

    // Companies = pipeline rows (one per role). Match on company or role so typing
    // an employer surfaces every open posting there.
    const companies = [];
    for (const a of safe(parseApplicationsMd)) {
      if (!match(a.company, a.role)) continue;
      companies.push({
        type: 'company', id: a.id, name: a.role || a.company || '',
        company: a.company || '', subtitle: a.status || '',
      });
    }

    res.json({ q, people: people.slice(0, PER_GROUP), companies: companies.slice(0, PER_GROUP) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
