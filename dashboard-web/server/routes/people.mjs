import express from 'express';
import { parseTargetTalentMd } from '../lib/target-talent.mjs';
import { parseReferralsMd } from '../lib/referrals.mjs';
import { readInfluencers } from '../lib/linkedin-ssi.mjs';
import { resolvePeople } from '../lib/contact-identity.mjs';
import { readPins, pinTogether, pinAlone } from '../lib/contact-links.mjs';
import { suggestMerges } from '../lib/contact-merge-suggest.mjs';

export const router = express.Router();
const REF = /^(ta|referral|influencer):\d+$/;

function validRefs(...refs) {
  return refs.every(ref => typeof ref === 'string' && REF.test(ref));
}

function currentPeople() {
  return resolvePeople({
    ta: parseTargetTalentMd(),
    referrals: parseReferralsMd(),
    influencers: readInfluencers(),
    pins: readPins(),
  });
}

router.get('/api/people/suggestions', (_req, res) => {
  const people = currentPeople();
  const byRef = new Map(people.flatMap(person => person.refs.map(ref => [ref, person])));
  const suggestions = suggestMerges(people).map(suggestion => ({
    ...suggestion,
    left: { name: byRef.get(suggestion.a)?.name || '', company: byRef.get(suggestion.a)?.company || '', store: suggestion.a.split(':')[0] },
    right: { name: byRef.get(suggestion.b)?.name || '', company: byRef.get(suggestion.b)?.company || '', store: suggestion.b.split(':')[0] },
  }));
  res.json({ suggestions });
});

router.post('/api/people/merge', (req, res) => {
  const { a, b, note } = req.body || {};
  if (!validRefs(a, b)) return res.status(400).json({ error: 'Invalid contact ref.' });
  pinTogether(a, b, note);
  res.json({ ok: true });
});

router.post('/api/people/unmerge', (req, res) => {
  const { ref } = req.body || {};
  if (!validRefs(ref)) return res.status(400).json({ error: 'Invalid contact ref.' });
  pinAlone(ref);
  res.json({ ok: true });
});

router.post('/api/people/suggestions/reject', (req, res) => {
  const { a, b } = req.body || {};
  if (!validRefs(a, b)) return res.status(400).json({ error: 'Invalid contact ref.' });
  pinAlone(a);
  res.json({ ok: true });
});
