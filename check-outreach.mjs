#!/usr/bin/env node
/**
 * check-outreach.mjs — command-line gate for the outreach caps.
 *
 * The caps (gap between touches, 30-day ceiling, awaiting-reply hold, cold
 * outreach cap, per-company daily cap, InMail budget) live in code:
 * dashboard-web/server/lib/outreach-policy.mjs `canContact`, driven by the
 * `outreach:` block of config/profile.yml. The dashboard routes already call it.
 * Anything that drafts outreach from the command line (a headless agent running
 * the contacto mode, a script) did NOT, so for that path the limit was only a
 * request in an instruction file. This script is the same verdict, callable from a shell.
 *
 * Usage:
 *   node check-outreach.mjs --source ta|referral|influencer --id <n> [--channel email|linkedin|both] [--json]
 *   node check-outreach.mjs --new --company "<name>" [--channel ...] [--json]
 *
 * The second form is for someone not in the books yet (a first touch). They have
 * no history, so only the company-wide rules can apply: how many people at that
 * company you have already reached today.
 *
 * Exit codes (callers must treat anything but 0 as "do not draft or send"):
 *   0  allowed
 *   1  blocked by a cap (reasons and next eligible date are printed)
 *   2  could not decide (bad arguments, contact not found, read error) — fails CLOSED
 *
 * There is intentionally no override flag. A person can override in the
 * dashboard, where it is logged to data/outreach-overrides.tsv; an agent cannot.
 *
 * Not evaluated here (both are soft "save it for someone better" rules that need
 * the follow-up queue's influence ranking): sameDayStakeholderGap and
 * inmailReserve. Every hard cap is evaluated.
 */
import fs from 'fs';
import path from 'path';
const SOURCES = new Set(['ta', 'referral', 'influencer']);
const CHANNELS = new Set(['email', 'linkedin', 'both']);

export function parseArgs(argv) {
  const out = { channel: 'email', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--new') out.isNew = true;
    else if (a === '--company') out.company = argv[++i];
    else if (a === '--source') out.source = argv[++i];
    else if (a === '--id') out.id = argv[++i];
    else if (a === '--channel') out.channel = argv[++i];
    else return { error: `Unknown argument: ${a}` };
  }
  if (!CHANNELS.has(out.channel)) return { error: '--channel must be email, linkedin or both' };
  if (out.isNew) {
    if (!String(out.company || '').trim()) return { error: '--new needs --company "<name>"' };
    return out;
  }
  if (!SOURCES.has(out.source)) return { error: '--source must be ta, referral or influencer' };
  if (!/^\d+$/.test(String(out.id ?? ''))) return { error: '--id must be a number' };
  return out;
}

// Everything that touches the dashboard code is imported lazily. A static import
// that fails (missing dependency, syntax error) would crash the process with
// exit 1, which a caller reads as "blocked". Loading inside check() lets the
// failure surface as an error result and exit 2, and keeps parseArgs importable
// by tests without loading the dashboard at all.
async function load() {
  const [cfg, policy, profile, person, tt, refs, fu, inmail, ident, identity, localDate] = await Promise.all([
    import('./dashboard-web/server/config.mjs'),
    import('./dashboard-web/server/lib/outreach-policy.mjs'),
    import('./dashboard-web/server/lib/profile.mjs'),
    import('./dashboard-web/server/lib/person-context.mjs'),
    import('./dashboard-web/server/lib/target-talent.mjs'),
    import('./dashboard-web/server/lib/referrals.mjs'),
    import('./dashboard-web/server/lib/followups.mjs'),
    import('./dashboard-web/server/lib/inmail-budget.mjs'),
    import('./dashboard-web/server/lib/contact-identity.mjs'),
    import('./lib/identity.mjs'),
    import('./lib/local-date.mjs'),
  ]);
  return { cfg, policy, profile, person, tt, refs, fu, inmail, ident, identity, localDate };
}

export async function check({ source, id, channel, isNew, company }, now = new Date()) {
  const m = await load();
  const { canContact } = m.policy;
  const { getOutreachPolicy } = m.profile;
  const { getPersonContext } = m.person;
  const { parseTargetTalentMd } = m.tt;
  const { parseReferralsMd } = m.refs;
  const { buildCompanyTouchIndex, _companyOutreachFor } = m.fu;
  const { getInmailBudget } = m.inmail;
  const { contactRef } = m.ident;
  const { normalizeCompany } = m.identity;
  const { localToday } = m.localDate;
  const readInfluencers = () => {
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(m.cfg.LINKEDIN_SSI_DIR, 'influencers.json'), 'utf8'));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };
  const books = { ta: parseTargetTalentMd(), referrals: parseReferralsMd(), influencers: readInfluencers() };
  let person, timeline, selfKey;
  if (isNew) {
    // No history to read. selfKey matches nothing in the index, so every touch at
    // the company counts toward its daily cap, which is the point.
    person = { company: String(company).trim() };
    timeline = [];
    selfKey = 'new:first-touch';
  } else {
    const context = getPersonContext(source, Number(id), books);
    if (!context?.person) return { status: 'error', error: `No contact found for ${source}:${id}` };
    ({ person, timeline } = context);
    selfKey = contactRef(source, Number(id));
  }
  const today = localToday(now);
  const touchIdx = buildCompanyTouchIndex(books);
  const companyTouches = touchIdx.get(normalizeCompany(person.company)) || [];
  const companyOutreach = _companyOutreachFor(selfKey, companyTouches, today);

  const slt = companyOutreach.selfLastTouch;
  const budget = getInmailBudget();
  const decision = canContact({
    timeline,
    channel,
    source: isNew ? 'ta' : source,   // a first touch is a cold one: the per-company cap applies
    company: person.company,
    companyTouches: {
      count: companyOutreach.companyContactsSentToday || 0,
      selfSentToday: !!companyOutreach.selfSentToday,
      influentialSentToday: !!companyOutreach.influentialSentToday,
    },
    inmail: {
      exhausted: budget.remaining === 0,
      alreadyInvited: slt?.channel === 'linkedin',
      freeDm: timeline.some(e => e.kind === 'invite-accepted'),
      remaining: budget.remaining,
    },
    policy: getOutreachPolicy(),
    now,
  });
  return {
    status: decision.allowed ? 'allowed' : 'blocked',
    contact: selfKey,
    company: person.company || '',
    channel,
    blocks: decision.blocks,
    nextEligible: decision.nextEligible,
  };
}

function render(result) {
  if (result.status === 'allowed') return `ALLOWED  ${result.contact} on ${result.channel}`;
  if (result.status === 'error') return `ERROR    ${result.error}`;
  const lines = [`BLOCKED  ${result.contact} on ${result.channel}`];
  for (const b of result.blocks) lines.push(`  - ${b.rule}: ${b.reason}${b.until ? ` (until ${b.until})` : ''}`);
  lines.push(result.nextEligible ? `  next eligible: ${result.nextEligible}` : '  next eligible: not until they reply');
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.error) result = { status: 'error', error: args.error };
  else {
    try { result = await check(args); } catch (err) { result = { status: 'error', error: err?.message || String(err) }; }
  }
  console.log(args.json ? JSON.stringify(result) : render(result));
  process.exit(result.status === 'allowed' ? 0 : result.status === 'blocked' ? 1 : 2);
}
