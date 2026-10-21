// lib/person-context.mjs: the I/O half of person identity.
//
// contact-identity.mjs and contact-timeline.mjs are deliberately pure so they
// stay unit-testable. This is the layer that actually reads the three stores and
// the pins sidecar, resolves the ref to a person, and builds both timeline views.
// Routes call this; they do not assemble it themselves, or the read order and the
// influencer fallback would drift between endpoints.
//
// It is ADDITIVE by contract. The two contact detail endpoints worked before any
// of this existed, and they must keep working if it breaks: resolution runs inside
// a try/catch and a failure logs once and yields null, so the endpoint returns
// exactly the payload it always returned, minus the new fields. A merged view is
// an enhancement. The contact card is the product.
//
// The endpoints get the DISPLAY timeline, which may collapse an obvious
// cross-store duplicate, because a human reads it and the enforcement view keeps
// near-duplicates on purpose. Anything deciding whether outreach is allowed must
// call buildTimeline directly instead.

import fs from 'fs';
import path from 'path';
import { LINKEDIN_SSI_DIR } from '../config.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';
import { parseReferralsMd, readReferralCorrespondence } from './referrals.mjs';
import { readLinkedInMap } from './tt-linkedin.mjs';
import { readEngagementLog } from './engagement-log.mjs';
import { contactRef, resolvePeople } from './contact-identity.mjs';
import { readPins } from './contact-links.mjs';
import { parseFollowupsMd } from './followups.mjs';
import { readAppNotes } from './notes.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { buildTimeline, buildDisplayTimeline, personLastTouch, buildApplicationMessages, mergeDisplayTimeline } from './contact-timeline.mjs';

function readInfluencers() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(LINKEDIN_SSI_DIR, 'influencers.json'), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

// One bucket per contact: the row whose book owns this person's messaging. A draft
// request that names the lower row of a person (the TA row of someone who is also a
// referral) is answered for the row that holds their bucket, so the tone and the
// thread come from the highest bucket and never from the cold one. Falls back to
// exactly what was asked for when the person cannot be resolved.
export function bucketOwner(source, id, opts = {}) {
  const asked = { source, id, bucket: null };
  try {
    const ref = contactRef(source, id);
    const person = resolvePeople({
      ta: opts.ta ?? parseTargetTalentMd(),
      referrals: opts.referrals ?? parseReferralsMd(),
      influencers: opts.influencers ?? readInfluencers(),
      pins: opts.pins ?? readPins(),
    }).find(candidate => candidate.refs.includes(ref));
    if (!person?.bucketRef) return asked;
    const [ownerSource, ownerId] = person.bucketRef.split(':');
    return { source: ownerSource, id: Number(ownerId), bucket: person.bucket };
  } catch {
    return asked;
  }
}

export function getPersonContext(source, id, opts = {}) {
  try {
    const ta = opts.ta ?? opts.taRows ?? parseTargetTalentMd();
    const referrals = opts.referrals ?? opts.referralRows ?? parseReferralsMd();
    const influencers = opts.influencers ?? readInfluencers();
    const pins = opts.pins ?? readPins();
    const ref = contactRef(source, id);
    const person = resolvePeople({ ta, referrals, influencers, pins })
      .find(candidate => candidate.refs.includes(ref));
    if (!person) return null;

    // The three views each rebuild the timeline, so read each store once and share it.
    const base = opts.timelineOpts || {};
    const correspondence = new Map();
    const timelineOpts = {
      ...base,
      linkedinMap: base.linkedinMap || readLinkedInMap(),
      engagementLog: base.engagementLog || readEngagementLog(),
      readCorrespondence: base.readCorrespondence || ((src, row, ref) => {
        if (!correspondence.has(ref)) {
          correspondence.set(ref, src === 'ta' ? readTTCorrespondence(row.id) : src === 'referral' ? readReferralCorrespondence(row.id) : []);
        }
        return correspondence.get(ref);
      }),
    };
    const timeline = buildTimeline(person, timelineOpts);
    const lastTouch = personLastTouch(person, timelineOpts);
    let displayTimeline;
    const context = { person, timeline, lastTouch };
    Object.defineProperty(context, 'displayTimeline', {
      enumerable: true,
      get() {
        if (displayTimeline !== undefined) return displayTimeline;
        displayTimeline = buildDisplayTimeline(person, timelineOpts);
        try {
          const followups = opts.followups ?? (opts.readFollowups || parseFollowupsMd)();
          const appNotes = opts.appNotes ?? (opts.readAppNotes || readAppNotes)();
          const apps = (opts.apps ?? (opts.readApps || parseApplicationsMd)())
            .map(app => ({ id: app.id, company: app.company, role: app.role }));
          const appMessages = buildApplicationMessages(person, { followups, appNotes, apps });
          displayTimeline = mergeDisplayTimeline(displayTimeline, appMessages);
        } catch (err) {
          console.error(`Application message timeline failed: ${err?.message || err}`);
        }
        return displayTimeline;
      },
    });
    return context;
  } catch (err) {
    console.error(`Person context resolution failed: ${err?.message || err}`);
    return null;
  }
}
