import express from 'express';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { resolvePeople } from '../lib/contact-identity.mjs';
import { readPins } from '../lib/contact-links.mjs';
import { logPersonMessage } from '../lib/person-messages.mjs';
import { parseReferralsMd, referralTitle } from '../lib/referrals.mjs';
import { matchByCompany, parseTargetTalentMd } from '../lib/target-talent.mjs';
import { logWriteRouteError, renderPendingResponse } from '../../../lib/log-writes.mjs';

export const router = express.Router();

function cleanEmail(value) {
  return String(value || '').replace(/\s*\[v:[^\]]*\]\s*/gi, '').trim();
}

export function peopleByCompany(company) {
  const taRows = parseTargetTalentMd();
  const referralRows = parseReferralsMd();
  const matchingRefs = new Set([
    ...matchByCompany(taRows, company, row => row.company).map(row => `ta:${row.id}`),
    ...matchByCompany(referralRows, company, row => row.where).map(row => `referral:${row.id}`),
  ]);
  return resolvePeople({ ta: taRows, referrals: referralRows, influencers: [], pins: readPins() })
    .filter(person => person.refs.some(ref => matchingRefs.has(ref)))
    .map(person => {
      const ta = person.members.ta;
      const referral = person.members.referral;
      return {
        ref: ta ? `ta:${ta.id}` : `referral:${referral.id}`,
        refs: person.refs,
        name: person.name,
        title: ta?.title || referralTitle(referral?.notes),
        company: ta?.company || referral?.where || '',
        email: cleanEmail(ta?.email || referral?.email),
        linkedin: ta?.linkedin || referral?.linkedin || '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

router.get('/api/people/by-company/:company', (req, res) => {
  try {
    res.json({ people: peopleByCompany(req.params.company) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/applications/:id/messages', (req, res) => {
  try {
    const appNum = parseInt(req.params.id, 10);
    if (!parseApplicationsMd().some(app => app.id === appNum)) {
      return res.status(404).json({ error: `Application #${req.params.id} not found` });
    }
    let result;
    let renderPending = {};
    try {
      const { personRef, direction, channel, subject, body, backfill, sentAt, withFollowup } = req.body || {};
      result = logPersonMessage({ personRef, direction, channel, subject, body, backfill, sentAt, withFollowup, appNum });
    } catch (error) {
      if (error.code === 'BAD_PERSON' || error.code === 'BAD_INPUT') {
        return res.status(400).json({ error: error.message });
      }
      result = error.personMessageResult;
      renderPending = renderPendingResponse(error, 'person message');
    }
    res.json({ ...result, ...renderPending });
  } catch (error) {
    if (error.code === 'BAD_PERSON' || error.code === 'BAD_INPUT') {
      return res.status(400).json({ error: error.message });
    }
    logWriteRouteError(res, error);
  }
});
