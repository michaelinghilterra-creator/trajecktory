import express from 'express';
import { parseTargetTalentMd } from '../lib/target-talent.mjs';
import { appendReferralRows, parseReferralsMd, REFERRAL_STATUSES } from '../lib/referrals.mjs';
import { extractEmail, isAtsRelayAddress } from '../lib/google.mjs';
import { readInfluencers } from '../lib/linkedin-ssi.mjs';
import { resolvePeople } from '../lib/contact-identity.mjs';
import { readPins, pinTogether, pinAlone } from '../lib/contact-links.mjs';
import { suggestMerges } from '../lib/contact-merge-suggest.mjs';
import { findExistingPerson } from '../../../lib/contact-match.mjs';
import { localToday } from '../../../lib/local-date.mjs';
import { logWriteRouteError } from '../../../lib/log-writes.mjs';

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

function requiredText(value, field) {
  if (typeof value !== 'string') return { error: `${field} is required.` };
  const text = value.trim().split(/\s/).filter(Boolean).join(' ');
  if (!text) return { error: `${field} is required.` };
  if (text.length > 120) return { error: `${field} must be at most 120 characters.` };
  return { value: text };
}

router.post('/api/people/create', (req, res) => {
  try {
    const body = req.body || {};
    const nameResult = requiredText(body.name, 'Name');
    if (nameResult.error) return res.status(400).json({ error: nameResult.error });
    const companyResult = requiredText(body.company, 'Company');
    if (companyResult.error) return res.status(400).json({ error: companyResult.error });

    const emailInput = body.email == null ? '' : body.email;
    if (typeof emailInput !== 'string') {
      return res.status(400).json({ error: 'Email must be a valid address.' });
    }
    const email = emailInput.trim().toLowerCase();
    if (email && extractEmail(email) !== email) {
      return res.status(400).json({ error: 'Email must be a valid address.' });
    }
    if (email && isAtsRelayAddress(email)) {
      return res.status(400).json({ error: "That is a relay address (Jobvite or similar), not the person's own email. Leave it blank." });
    }

    const statusInput = body.status == null ? '' : body.status;
    if (typeof statusInput !== 'string') {
      return res.status(400).json({ error: 'Status is not valid.' });
    }
    const status = statusInput.trim() || 'Responded';
    if (!REFERRAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status is not valid.' });
    }

    const candidate = {
      name: nameResult.value,
      company: companyResult.value,
      email,
      linkedin: String(body.linkedin || '').trim(),
    };
    const hit = findExistingPerson(candidate, {
      ta: parseTargetTalentMd(),
      referrals: parseReferralsMd(),
    });
    if (hit) {
      const name = hit.source === 'ta'
        ? `${hit.row.first || ''} ${hit.row.last || ''}`.trim()
        : hit.row.name;
      const company = hit.source === 'ta' ? hit.row.company : hit.row.where;
      return res.json({ ok: true, existed: true, ref: `${hit.source}:${hit.row.id}`, name, company });
    }

    const title = String(body.title || '').trim();
    const notes = String(body.notes || '').trim();
    const [created] = appendReferralRows([{
      name: candidate.name,
      where: candidate.company,
      target: String(body.target || '').trim() || candidate.company,
      how: String(body.how || '').trim() || 'Created from Reply Review',
      status,
      lastTouch: localToday(),
      notes: [title, notes].filter(Boolean).join(' · '),
      linkedin: candidate.linkedin,
      email,
    }]);
    return res.json({ ok: true, existed: false, ref: `referral:${created.id}`, name: candidate.name, company: candidate.company });
  } catch (error) {
    return logWriteRouteError(res, error);
  }
});

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
