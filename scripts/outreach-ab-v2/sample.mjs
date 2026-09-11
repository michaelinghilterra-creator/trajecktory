import fs from 'node:fs';
import path from 'node:path';
import { config, loadHarnessModules } from './bootstrap.mjs';

const helpers = await loadHarnessModules();
const { isLinkedInInvite, isLinkedInEntry } = await import('../../dashboard-web/server/lib/channels.mjs');
const { readConnects } = await import('../../dashboard-web/server/lib/connects.mjs');
const { parseFollowupsMd } = await import('../../dashboard-web/server/lib/followups.mjs');
const { canContact } = await import('../../dashboard-web/server/lib/outreach-policy.mjs');
const { getOutreachPolicy } = await import('../../dashboard-web/server/lib/profile.mjs');
const { getInmailBudget } = await import('../../dashboard-web/server/lib/inmail-budget.mjs');

const DEFAULT_EXCLUDE_FILE = path.join(config.OUTPUT_DIR, 'outreach-ab', 'v2', 'exclude.json');
const KINDS = ['li_followup', 'connect_note', 'ta_dm', 'ta_email', 'referral_dm', 'referral_email', 'app_followup'];
const DAY_MS = 86400000;

export function normalizeExclusions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Exclusion JSON must be an object');
  for (const source of ['ta', 'referral']) {
    if (value[source] !== undefined && !Array.isArray(value[source])) throw new Error(`Exclusion field ${source} must be an array`);
  }
  return {
    ta: new Set((value.ta || []).map(String)),
    referral: new Set((value.referral || []).map(String)),
  };
}

export function loadExclusions(excludeFile = null) {
  const file = excludeFile ? path.resolve(excludeFile) : (fs.existsSync(DEFAULT_EXCLUDE_FILE) ? DEFAULT_EXCLUDE_FILE : null);
  if (!file) return normalizeExclusions();
  return normalizeExclusions(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function isExcludedContact(exclusions, source, id) {
  if (source === 'ta') return exclusions.ta.has(String(id));
  if (source === 'referral') return exclusions.referral.has(String(id));
  return false;
}

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(values, seed) {
  const out = [...values];
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function entriesOf(weights) {
  if (Array.isArray(weights)) {
    return weights.map((item, index) => ({
      key: String(item.kind ?? item.tier ?? item.key ?? index),
      weight: Number(item.count ?? item.weight ?? item.value ?? 0),
    }));
  }
  return Object.entries(weights || {}).map(([key, value]) => ({ key, weight: Number(value) || 0 }));
}

export function allocateLargestRemainder(weights, total) {
  const entries = entriesOf(weights).filter(item => item.weight > 0);
  const result = Object.fromEntries(entries.map(item => [item.key, 0]));
  const sum = entries.reduce((value, item) => value + item.weight, 0);
  if (!entries.length || total <= 0 || !sum) return result;
  const shares = entries.map((item, index) => {
    const exact = item.weight * total / sum;
    const floor = Math.floor(exact);
    result[item.key] = floor;
    return { ...item, index, remainder: exact - floor };
  });
  let left = total - Object.values(result).reduce((a, b) => a + b, 0);
  shares.sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index);
  for (let i = 0; i < left; i++) result[shares[i % shares.length].key]++;
  return result;
}

export function allocateQuotas(weights, total = 60, minimum = 2) {
  const entries = entriesOf(weights).filter(item => item.weight > 0);
  if (entries.length * minimum > total) throw new Error(`Cannot allocate minimum ${minimum} across ${entries.length} categories in ${total} slots`);
  const quotas = allocateLargestRemainder(Object.fromEntries(entries.map(item => [item.key, item.weight])), total);
  for (const item of entries) {
    while (quotas[item.key] < minimum) {
      const donor = entries
        .filter(candidate => candidate.key !== item.key && quotas[candidate.key] > minimum)
        .sort((a, b) => (quotas[b.key] - minimum) - (quotas[a.key] - minimum) || b.weight - a.weight)[0];
      if (!donor) throw new Error('Minimum quota cannot be satisfied');
      quotas[donor.key]--;
      quotas[item.key]++;
    }
  }
  return quotas;
}

const tierOf = row => helpers.resolveInfluenceTier({ notes: row?.notes, title: row?.title || helpers.referralTitle(row?.notes) }).tier;
const ymd = value => String(value || '').slice(0, 10);

function withinWindow(value, cutoff) {
  const date = ymd(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= cutoff;
}

function increment(mix, kind, tier) {
  mix[kind] ||= { total: 0, tiers: {} };
  mix[kind].total++;
  mix[kind].tiers[tier] = (mix[kind].tiers[tier] || 0) + 1;
}

export function measureMix({ now = new Date(), fixture = null } = {}) {
  const cutoff = new Date(now.getTime() - 60 * DAY_MS).toISOString().slice(0, 10);
  const mix = {};
  const taRows = fixture?.taRows ?? helpers.parseTargetTalentMd();
  const referralRows = fixture?.referralRows ?? helpers.parseReferralsMd();
  const readTaCorrespondence = fixture?.readTTCorrespondence || helpers.readTTCorrespondence;
  const readReferralCorrespondence = fixture?.readReferralCorrespondence || helpers.readReferralCorrespondence;
  const resolveReferralLink = fixture?.resolveReferralLink || helpers.resolveReferralLink;
  const connects = fixture?.connects ?? readConnects() ?? [];
  const followups = fixture?.followups ?? parseFollowupsMd();
  const excluded = {
    followupsCrossLogged: 0,
    followupsBackfill: 0,
    ledgerAlreadyRepresented: 0,
    ledgerDuplicates: 0,
  };
  const recordedInviteKeys = new Set();
  const ledgerInviteKeys = new Set();
  let taDmIndex = 0;

  const taTouches = [];
  for (const row of taRows) {
    for (const message of readTaCorrespondence(row.id)) {
      if (message.direction !== 'Sent' || !withinWindow(message.timestamp, cutoff)) continue;
      taTouches.push({ row, message });
      if (isLinkedInInvite(message.subject)) recordedInviteKeys.add(`${ymd(message.timestamp)}|${row.id}`);
    }
  }
  taTouches.sort((a, b) => String(a.message.timestamp).localeCompare(String(b.message.timestamp)) || a.row.id - b.row.id);
  for (const { row, message } of taTouches) {
    const tier = tierOf(row);
    if (isLinkedInInvite(message.subject)) increment(mix, 'connect_note', tier);
    else if (isLinkedInEntry(message)) increment(mix, taDmIndex++ % 2 === 0 ? 'li_followup' : 'ta_dm', tier);
    else increment(mix, 'ta_email', tier);
  }

  for (const row of referralRows) {
    if (resolveReferralLink(row, taRows)) continue;
    const tier = tierOf(row);
    for (const message of readReferralCorrespondence(row.id)) {
      if (message.direction !== 'Sent' || !withinWindow(message.timestamp, cutoff)) continue;
      increment(mix, isLinkedInEntry(message) ? 'referral_dm' : 'referral_email', tier);
    }
  }

  for (const entry of connects) {
    if (!withinWindow(entry.date, cutoff) || entry.id == null) continue;
    const key = `${ymd(entry.date)}|${entry.id}`;
    if (recordedInviteKeys.has(key)) {
      excluded.ledgerAlreadyRepresented++;
      continue;
    }
    if (ledgerInviteKeys.has(key)) {
      excluded.ledgerDuplicates++;
      continue;
    }
    ledgerInviteKeys.add(key);
    const row = taRows.find(candidate => String(candidate.id) === String(entry.id));
    if (row) increment(mix, 'connect_note', tierOf(row));
  }

  for (const followup of followups) {
    if (!withinWindow(followup.date, cutoff)) continue;
    const notes = String(followup.notes || '');
    if (/cross-logged/i.test(notes)) {
      excluded.followupsCrossLogged++;
      continue;
    }
    if (/backfill/i.test(notes)) {
      excluded.followupsBackfill++;
      continue;
    }
    increment(mix, 'app_followup', 'application');
  }
  return { cutoff, days: 60, kinds: mix, excluded };
}

function companyKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildCompanyState(taRows, referralRows, now) {
  const today = now.toISOString().slice(0, 10);
  const companies = new Map();
  const seenPeople = new Set();
  for (const [source, rows] of [['ta', taRows], ['referral', referralRows]]) {
    for (const row of rows) {
      const link = source === 'referral' ? helpers.resolveReferralLink(row, taRows) : null;
      const personKey = link?.contact ? `ta:${link.contact.id}` : `${source}:${row.id}`;
      if (seenPeople.has(personKey)) continue;
      seenPeople.add(personKey);
      const company = source === 'ta' ? row.company : row.where;
      const key = companyKey(company);
      if (!key) continue;
      const context = helpers.getPersonContext(source, row.id, { taRows, referralRows });
      for (const event of context?.timeline || []) {
        if (event.direction !== 'Sent' || ymd(event.at) !== today) continue;
        if (!companies.has(key)) companies.set(key, []);
        companies.get(key).push({ personKey, tier: tierOf(row) });
      }
    }
  }
  return companies;
}

export function isAlreadyContactedTa(row, { timeline = [], linkedinState = '' } = {}) {
  const status = String(row?.status || '').trim();
  // Production references:
  // - dashboard-web/src/connect.jsx:186-205 selects follow-up messaging for a
  //   connected contact, a LinkedIn self-touch, or a contacted CRM status.
  // - dashboard-web/server/lib/followups.mjs:563-568 labels every populated TA
  //   status except "Not Contacted" as Follow up; :590-612 builds its touch index
  //   from sent/received correspondence. The person timeline also carries invite
  //   sent/accepted events, so those are explicit prior-outreach signals here.
  return (!!status && !/^not\s+contacted$/i.test(status))
    || linkedinState === 'Connected'
    || timeline.some(event => event.kind === 'invite-sent' || event.kind === 'invite-accepted' || event.direction === 'Sent');
}

function contactAllowed(source, row, kind, now, inmailBudget, policy, companyState) {
  const context = helpers.getPersonContext(source, row.id);
  const timeline = context?.timeline || [];
  const channel = kind.includes('email') ? 'email' : 'linkedin';
  const tier = tierOf(row);
  const inviteSent = timeline.some(event => event.kind === 'invite-sent');
  const linkedinState = source === 'ta' ? helpers.getLinkedInStatus(Number(row.id)) : '';
  const freeDm = timeline.some(event => event.kind === 'invite-accepted') || linkedinState === 'Connected';
  const alreadyContacted = source === 'ta'
    ? isAlreadyContactedTa(row, { timeline, linkedinState })
    : inviteSent || freeDm;
  const link = source === 'referral' ? helpers.resolveReferralLink(row, helpers.parseTargetTalentMd()) : null;
  const personKey = link?.contact ? `ta:${link.contact.id}` : `${source}:${row.id}`;
  const company = source === 'ta' ? row.company : row.where;
  const companyToday = companyState?.get(companyKey(company)) || [];
  const selfSentToday = companyToday.some(entry => entry.personKey === personKey);
  const influentialSentToday = companyToday.some(entry => entry.personKey !== personKey && ['hm', 'exec', 'peer'].includes(entry.tier));
  const decision = canContact({
    timeline,
    channel,
    source,
    company,
    companyTouches: { count: new Set(companyToday.map(entry => entry.personKey)).size, selfSentToday, influentialSentToday },
    canInfluence: tier === 'hm' || tier === 'exec' || tier === 'peer',
    inmail: {
      exhausted: inmailBudget.remaining === 0,
      alreadyInvited: alreadyContacted,
      freeDm,
      remaining: inmailBudget.remaining,
      canInfluence: tier === 'hm' || tier === 'exec' || tier === 'peer',
    },
    policy,
    now,
  });
  return { allowed: decision.allowed, inviteSent, freeDm, alreadyContacted };
}

export function eligibleCases({ now = new Date(), exclusions = normalizeExclusions() } = {}) {
  const taRows = helpers.parseTargetTalentMd();
  const referralRows = helpers.parseReferralsMd();
  const apps = helpers.parseApplicationsMd();
  const inmailBudget = getInmailBudget();
  const policy = getOutreachPolicy();
  const companyState = buildCompanyState(taRows, referralRows, now);
  const pools = Object.fromEntries(KINDS.map(kind => [kind, []]));

  for (const row of taRows) {
    if (row.status === 'Archived' || !String(row.title || '').trim() || isExcludedContact(exclusions, 'ta', row.id)) continue;
    const li = contactAllowed('ta', row, 'ta_dm', now, inmailBudget, policy, companyState);
    if (String(row.linkedin || '').trim() && li.allowed) {
      const kind = li.alreadyContacted ? 'li_followup' : 'connect_note';
      pools[kind].push({ source: 'ta', id: row.id, kind, tier: tierOf(row) });
      pools.ta_dm.push({ source: 'ta', id: row.id, kind: 'ta_dm', tier: tierOf(row) });
    }
    if (String(row.email || '').trim() && contactAllowed('ta', row, 'ta_email', now, inmailBudget, policy, companyState).allowed) {
      pools.ta_email.push({ source: 'ta', id: row.id, kind: 'ta_email', tier: tierOf(row) });
    }
  }

  for (const row of referralRows) {
    const title = helpers.referralTitle(row.notes);
    if (row.status === 'Archived' || !title || isExcludedContact(exclusions, 'referral', row.id)) continue;
    const link = helpers.resolveReferralLink(row, taRows);
    const personKey = link?.contact ? `ta:${link.contact.id}` : `referral:${row.id}`;
    if (String(row.linkedin || '').trim() && contactAllowed('referral', row, 'referral_dm', now, inmailBudget, policy, companyState).allowed) {
      pools.referral_dm.push({ source: 'referral', id: row.id, kind: 'referral_dm', tier: tierOf(row), personKey });
    }
    if (String(row.email || '').trim() && contactAllowed('referral', row, 'referral_email', now, inmailBudget, policy, companyState).allowed) {
      pools.referral_email.push({ source: 'referral', id: row.id, kind: 'referral_email', tier: tierOf(row), personKey });
    }
  }

  const followups = parseFollowupsMd();
  for (const app of apps) {
    if (!helpers.findSubmittedApplication([app])) continue;
    const timeline = followups.filter(row => Number(row.appNum) === Number(app.id)).map(row => ({
      at: row.date,
      direction: 'Sent',
      channel: row.channel || 'Email',
      subject: 'Application follow-up',
      body: row.notes || '',
    }));
    const companyToday = companyState.get(companyKey(app.company)) || [];
    const decision = canContact({
      timeline,
      channel: 'email',
      source: 'application',
      company: app.company,
      companyTouches: { count: new Set(companyToday.map(entry => entry.personKey)).size },
      policy,
      now,
    });
    if (decision.allowed) pools.app_followup.push({ source: 'application', id: app.id, kind: 'app_followup', tier: 'application' });
  }
  return pools;
}

function chooseCases(pools, quotas, tierQuotas, seed) {
  const picked = [];
  const used = new Set();
  const orderedKinds = [...KINDS].sort((a, b) => {
    const uniqueA = new Set((pools[a] || []).map(item => item.personKey || `${item.source}:${item.id}`)).size;
    const uniqueB = new Set((pools[b] || []).map(item => item.personKey || `${item.source}:${item.id}`)).size;
    return uniqueA - uniqueB || KINDS.indexOf(a) - KINDS.indexOf(b);
  });
  for (let kindIndex = 0; kindIndex < orderedKinds.length; kindIndex++) {
    const kind = orderedKinds[kindIndex];
    const quota = quotas[kind] || 0;
    const byTier = tierQuotas[kind] || {};
    const candidates = seededShuffle(pools[kind] || [], Number(seed) + kindIndex * 101);
    for (const [tier, count] of Object.entries(byTier)) {
      for (const candidate of candidates) {
        if (picked.filter(item => item.kind === kind && item.tier === tier).length >= count) break;
        const personKey = candidate.personKey || `${candidate.source}:${candidate.id}`;
        if (candidate.tier !== tier || used.has(personKey)) continue;
        picked.push(candidate);
        used.add(personKey);
      }
    }
    for (const candidate of candidates) {
      if (picked.filter(item => item.kind === kind).length >= quota) break;
      const personKey = candidate.personKey || `${candidate.source}:${candidate.id}`;
      if (used.has(personKey)) continue;
      picked.push(candidate);
      used.add(personKey);
    }
  }
  return { picked, used };
}

function assignTranches(cases, seed) {
  const tranches = [[], [], []];
  const strata = new Map();
  for (const item of cases) {
    const key = `${item.kind}|${item.tier}`;
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(item);
  }
  let offset = Number(seed) % 3;
  for (const [index, group] of [...strata.values()].entries()) {
    const shuffled = seededShuffle(group, Number(seed) + index * 17);
    for (const item of shuffled) {
      const choices = tranches.map((items, tranche) => ({ tranche, size: items.length, rotate: (tranche - offset + 3) % 3 }))
        .filter(choice => choice.size < 20)
        .sort((a, b) => a.size - b.size || a.rotate - b.rotate);
      tranches[choices[0].tranche].push(item);
      offset = (choices[0].tranche + 1) % 3;
    }
  }
  const numbered = [];
  for (let tranche = 0; tranche < 3; tranche++) {
    for (const item of seededShuffle(tranches[tranche], Number(seed) + tranche + 900)) {
      numbered.push({ ...item, tranche: tranche + 1 });
    }
  }
  numbered.forEach((item, index) => {
    item.number = index + 1;
    item.label = `C${String(index + 1).padStart(2, '0')}`;
  });
  return numbered;
}

export function sampleCases({ seed = 1, total = 60, mix = null, pools = null, now = new Date(), exclusions = normalizeExclusions() } = {}) {
  const measured = mix || measureMix({ now });
  const available = pools || eligibleCases({ now, exclusions });
  const weights = Object.fromEntries(Object.entries(measured.kinds || {}).map(([kind, value]) => [kind, value.total || 0]));
  const requestedQuotas = allocateQuotas(weights, total, 2);
  const requestedTierQuotas = {};
  for (const [kind, quota] of Object.entries(requestedQuotas)) {
    requestedTierQuotas[kind] = allocateLargestRemainder(measured.kinds[kind]?.tiers || {}, quota);
  }
  const { picked, used } = chooseCases(available, requestedQuotas, requestedTierQuotas, seed);
  const shuffledPools = Object.fromEntries(KINDS.map((kind, index) => [kind, seededShuffle(available[kind] || [], Number(seed) + 7000 + index)]));
  // Refill shortfalls within the same channel first. Connection notes are the
  // largest LinkedIn kind but only uncontacted people qualify, so without this
  // their unfilled slots flow to email and the sample stops mirroring the
  // user's LinkedIn vs email split.
  const channelOf = kind => (['ta_email', 'referral_email', 'app_followup'].includes(kind) ? 'email' : 'linkedin');
  const channelWeights = {};
  for (const kind of KINDS) channelWeights[channelOf(kind)] = (channelWeights[channelOf(kind)] || 0) + (weights[kind] || 0);
  while (picked.length < total) {
    const actual = Object.fromEntries(KINDS.map(kind => [kind, picked.filter(item => item.kind === kind).length]));
    const actualChannel = {};
    for (const item of picked) actualChannel[channelOf(item.kind)] = (actualChannel[channelOf(item.kind)] || 0) + 1;
    const candidates = KINDS.map((kind, index) => {
      const candidate = shuffledPools[kind].find(item => !used.has(item.personKey || `${item.source}:${item.id}`));
      const channelPressure = ((actualChannel[channelOf(kind)] || 0) + 1) / Math.max(1, channelWeights[channelOf(kind)] || 0);
      return { kind, candidate, index, channelPressure, pressure: candidate ? (actual[kind] + 1) / Math.max(1, weights[kind] || 0) : Infinity };
    }).filter(item => item.candidate);
    if (!candidates.length) break;
    candidates.sort((a, b) => a.channelPressure - b.channelPressure || a.pressure - b.pressure || (weights[b.kind] || 0) - (weights[a.kind] || 0) || a.index - b.index);
    const chosen = candidates[0].candidate;
    const key = chosen.personKey || `${chosen.source}:${chosen.id}`;
    picked.push(chosen);
    used.add(key);
  }
  if (picked.length !== total) throw new Error(`Only ${picked.length} eligible unique contacts are available for ${total} cases`);
  const quotas = Object.fromEntries(KINDS.map(kind => [kind, picked.filter(item => item.kind === kind).length]).filter(([, count]) => count));
  const tierQuotas = {};
  for (const item of picked) {
    tierQuotas[item.kind] ||= {};
    tierQuotas[item.kind][item.tier] = (tierQuotas[item.kind][item.tier] || 0) + 1;
  }
  return {
    cases: assignTranches(picked, seed),
    mix: {
      ...measured,
      total,
      requestedQuotas,
      requestedTierQuotas,
      quotas,
      tierQuotas,
    }
  };
}

export function renderMixMd(data) {
  const lines = ['# Outreach A/B v2 measured mix', '', `Window: ${data.days} days from ${data.cutoff}`, '', '| Kind | Observed | Quota | Tier quotas |', '|---|---:|---:|---|'];
  for (const kind of KINDS) {
    const observed = data.kinds?.[kind]?.total || 0;
    if (!observed && !data.quotas?.[kind]) continue;
    const tiers = Object.entries(data.tierQuotas?.[kind] || {}).map(([tier, count]) => `${tier}: ${count}`).join(', ');
    lines.push(`| ${kind} | ${observed} | ${data.quotas?.[kind] || 0} | ${tiers || '-'} |`);
  }
  lines.push('', '## Excluded duplicate records', '', `- Cross-logged follow-up rows: ${data.excluded?.followupsCrossLogged || 0}`, `- Backfill follow-up rows: ${data.excluded?.followupsBackfill || 0}`, `- LinkedIn ledger rows already represented by correspondence: ${data.excluded?.ledgerAlreadyRepresented || 0}`, `- Duplicate LinkedIn ledger rows: ${data.excluded?.ledgerDuplicates || 0}`);
  return lines.join('\n') + '\n';
}

export function writeSample({ seed = 1, runDir = null, now = new Date(), excludeFile = null } = {}) {
  const exclusions = loadExclusions(excludeFile);
  const { cases, mix } = sampleCases({ seed, now, exclusions });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(runDir || path.join(config.OUTPUT_DIR, 'outreach-ab', 'v2', stamp));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'mix.json'), JSON.stringify({ ...mix, seed }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'mix.md'), renderMixMd(mix));
  return { runDir: dir, cases, mix };
}
