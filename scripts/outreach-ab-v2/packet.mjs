import { config, loadHarnessModules } from './bootstrap.mjs';

const helpers = await loadHarnessModules();

export const SURFACE_BY_KIND = Object.freeze({
  li_followup: 'li_followup',
  connect_note: 'connect_note_influencer',
  ta_dm: 'ta_dm',
  ta_email: 'ta_email',
  referral_dm: 'referral_dm',
  referral_email: 'referral_email',
  app_followup: 'app_followup',
});

const TIER_LABELS = Object.freeze({
  hm: 'likely hiring manager',
  exec: 'senior executive',
  peer: 'functional peer',
  ta: 'recruiter or talent partner',
  agency: 'external recruiter',
  application: 'application follow-up',
});

function compact(value, limit = Infinity) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function stripNotesTags(value) {
  return compact(String(value || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s*·\s*·\s*/g, ' · '), 240);
}

function dateOf(event) {
  return String(event?.at || event?.timestamp || '').slice(0, 10);
}

function toMessages(timeline) {
  return (timeline || [])
    .filter(event => event && (event.direction === 'Sent' || event.direction === 'Received'))
    .map(event => ({
      timestamp: event.at || event.timestamp || '',
      direction: event.direction,
      channel: event.channel || '',
      subject: event.subject || '',
      body: event.body || '',
    }));
}

function senderNameFromCv(cv) {
  const firstLine = String(cv || '').split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim())
    .find(Boolean) || '';
  const plausible = firstLine.length <= 100 && /^[\p{L}][\p{L} .,'’-]+$/u.test(firstLine);
  const fullName = plausible ? firstLine : '';
  return { fullName, firstName: fullName.split(/\s+/)[0] || '' };
}

function goalFor({ kind, tier, application, thread }) {
  if (kind === 'referral_dm' || kind === 'referral_email') {
    if (!thread?.count || !thread?.recentPitch) return 'Reconnect warmly; no ask.';
    return 'Reopen the conversation warmly without guilt or pressure.';
  }
  if (kind === 'connect_note') return 'Earn acceptance of the LinkedIn connection request with one relevant reason to connect.';
  if (kind === 'app_followup') {
    return application?.role
      ? `Get a useful update on the ${application.role} application without asking for a meeting.`
      : 'Get a useful update on the opportunity without asking for a meeting.';
  }
  if (!application) return 'Learn whether the team is hiring for a relevant role.';
  if (tier === 'exec') return `Learn who is leading the hiring for the ${application.role} role.`;
  if (tier === 'hm' || tier === 'peer') return `Get a look at the application for the ${application.role} role.`;
  return `Get the application for the ${application.role} role in front of the hiring manager.`;
}

function applicationPacket(app) {
  return app ? {
    submitted: true,
    role: app.role || '',
    date: app.date || '',
    status: app.status || '',
  } : null;
}

function loadResearch(app) {
  return helpers.loadCompanyResearch(app?.report, { bodyLimit: 1200 }).slice(0, 1200);
}

function buildRelationship({ kind, connected, inviteSent, inviteDate, timeline }) {
  const messages = toMessages(timeline);
  const summary = helpers.summarizeThread(messages);
  const recentTouches = [...(timeline || [])]
    .filter(event => event && (event.direction === 'Sent' || event.direction === 'Received'))
    .slice(-3)
    .reverse()
    .map(event => ({
      date: dateOf(event),
      channel: event.channel || (/invite|dm/i.test(event.kind || '') ? 'LinkedIn' : 'Email'),
      direction: event.direction,
    }));
  return {
    channelKind: kind.includes('email') || kind === 'app_followup' ? 'Email' : 'LinkedIn',
    connected: !!connected,
    inviteSent: !!inviteSent,
    inviteDate: inviteDate || '',
    threadBlock: summary.threadBlock,
    stateLine: summary.stateLine,
    recentPitch: summary.recentPitch,
    lastTouchDate: recentTouches[0]?.date || '',
    recentTouches,
  };
}

export function buildPacket({ source, id, kind }) {
  if (!['ta', 'referral', 'application'].includes(source)) throw new Error(`Unsupported packet source: ${source}`);
  if (!SURFACE_BY_KIND[kind]) throw new Error(`Unsupported outreach kind: ${kind}`);

  const taRows = helpers.parseTargetTalentMd();
  const referralRows = helpers.parseReferralsMd();
  const apps = helpers.parseApplicationsMd();
  let row;
  let name;
  let title;
  let company;
  let notes;
  let tier;
  let timeline;
  let connected = false;
  let inviteSent = false;
  let inviteDate = '';
  let relatedApps;

  if (source === 'ta') {
    row = taRows.find(candidate => String(candidate.id) === String(id));
    if (!row) throw new Error(`TA contact ${id} not found`);
    name = compact(`${row.first || ''} ${row.last || ''}`);
    title = row.title || '';
    company = row.company || '';
    notes = row.notes || '';
    tier = helpers.resolveInfluenceTier({ notes, title }).tier;
    const context = helpers.getPersonContext('ta', row.id, { taRows, referralRows });
    timeline = context?.timeline || [];
    connected = timeline.some(event => event.kind === 'invite-accepted')
      || helpers.getLinkedInStatus(Number(row.id)) === 'Connected';
    const invite = timeline.find(event => event.kind === 'invite-sent');
    inviteSent = !!invite;
    inviteDate = dateOf(invite);
    relatedApps = helpers.findRelatedApps(company);
  } else if (source === 'referral') {
    row = referralRows.find(candidate => String(candidate.id) === String(id));
    if (!row) throw new Error(`Referral ${id} not found`);
    name = row.name || '';
    title = helpers.referralTitle(row.notes);
    company = row.where || '';
    notes = row.notes || '';
    tier = helpers.resolveInfluenceTier({ notes: row.notes, title }).tier;
    const context = helpers.getPersonContext('referral', row.id, { taRows, referralRows });
    timeline = context?.timeline || [];
    connected = timeline.some(event => event.kind === 'invite-accepted');
    const link = helpers.resolveReferralLink(row, taRows);
    if (!connected && link?.contact) connected = helpers.getLinkedInStatus(Number(link.contact.id)) === 'Connected';
    const invite = timeline.find(event => event.kind === 'invite-sent');
    inviteSent = !!invite;
    inviteDate = dateOf(invite);
    relatedApps = helpers.findRelatedApps(company);
  } else {
    row = apps.find(candidate => String(candidate.id) === String(id));
    if (!row) throw new Error(`Application ${id} not found`);
    name = 'Hiring team';
    title = 'Application contact';
    company = row.company || '';
    notes = row.notes || '';
    tier = 'application';
    relatedApps = [row];
    timeline = helpers.parseFollowupsMd()
      .filter(followup => Number(followup.appNum) === Number(row.id))
      .map(followup => ({
        at: followup.date,
        direction: 'Sent',
        channel: followup.channel || 'Email',
        subject: 'Application follow-up',
        body: followup.notes || '',
      }));
  }

  const submitted = helpers.findSubmittedApplication(relatedApps);
  const application = applicationPacket(submitted);
  const relationship = buildRelationship({ kind, connected, inviteSent, inviteDate, timeline });
  const cv = helpers.readOptionalProjectFile(config.ROOT_DIR, 'cv.md');
  const articleDigest = helpers.readOptionalProjectFile(config.ROOT_DIR, 'article-digest.md').slice(0, 900);
  const narrative = helpers.getNarrative();
  const senderName = senderNameFromCv(cv);
  const identity = helpers.getIdentity();
  const packet = {
    recipient: {
      name: compact(name),
      first: compact(name).split(/\s+/)[0] || 'there',
      title: compact(title),
      company: compact(company),
      notesExcerpt: stripNotesTags(notes),
      tier,
      tierLabel: TIER_LABELS[tier] || tier,
    },
    relationship,
    application,
    research: loadResearch(submitted || relatedApps[0]),
    sender: {
      fullName: identity.fullName || senderName.fullName,
      firstName: identity.firstName || senderName.firstName,
      cv,
      articleDigest,
      proofPoints: narrative.proofPoints || [],
    },
    goal: '',
    kind,
    surfaceId: SURFACE_BY_KIND[kind],
  };
  packet.goal = goalFor({ kind, tier, application, thread: relationship });
  return packet;
}

function proofLines(points) {
  if (!Array.isArray(points) || !points.length) return '(none on file)';
  return points.map(point => `- ${compact(point?.name)}: ${compact(point?.heroMetric)}`).join('\n');
}

export function renderFactBlock(packet) {
  const r = packet.recipient || {};
  const rel = packet.relationship || {};
  const sender = packet.sender || {};
  const connection = rel.connected
    ? 'You are connected on LinkedIn.'
    : rel.inviteSent
      ? `Your connection request${rel.inviteDate ? ` from ${rel.inviteDate}` : ''} has not been accepted; you are not connected.`
      : 'You are not connected on LinkedIn, and no connection request is on file.';
  const application = packet.application?.submitted
    ? `He submitted an application for the ${packet.application.role} role on ${packet.application.date} (status: ${packet.application.status}).`
    : 'He has not submitted an application at this company; do not claim he applied.';
  return [
    '== SHARED FACT PACKET ==',
    'Use only these facts. Do not invent or infer missing details.',
    '',
    'RECIPIENT',
    `Name: ${r.name || '(unknown)'}`,
    `Title: ${r.title || '(unknown)'}`,
    `Company: ${r.company || '(unknown)'}`,
    `Persona: ${r.tierLabel || r.tier || '(unknown)'}`,
    `Notes: ${r.notesExcerpt || '(none)'}`,
    '',
    'RELATIONSHIP',
    connection,
    `Thread so far:\n${rel.threadBlock || '(no prior messages on file)'}`,
    `Thread state: ${rel.stateLine || 'No prior messages on file.'}`,
    '',
    'APPLICATION',
    application,
    '',
    'COMPANY RESEARCH',
    packet.research || '(none on file)',
    '',
    'SENDER BACKGROUND',
    `Name: ${sender.fullName || '(not available)'}`,
    `CV:\n${sender.cv || '(not available)'}`,
    `Article digest:\n${sender.articleDigest || '(not available)'}`,
    `Proof points:\n${proofLines(sender.proofPoints)}`,
    '',
    `GOAL: ${packet.goal}`,
    `CHANNEL: ${rel.channelKind || ''}`,
  ].join('\n');
}

export function renderKit(packet) {
  const r = packet.recipient || {};
  const rel = packet.relationship || {};
  const touches = (rel.recentTouches || []).slice(0, 3)
    .map(touch => `${touch.date || 'unknown date'}, ${touch.channel || 'unknown channel'}, ${touch.direction || 'unknown direction'}`);
  const application = packet.application?.submitted
    ? `${packet.application.role}, submitted ${packet.application.date}, ${packet.application.status}`
    : 'No submitted application at this company.';
  return {
    who: [r.name, r.title, r.company, r.tierLabel].filter(Boolean).join(' · '),
    whatTheyDo: r.notesExcerpt || 'No notes on file.',
    history: [rel.stateLine || 'No prior messages on file.', ...touches].join('\n'),
    application,
    goal: packet.goal || '',
    channel: rel.channelKind || '',
  };
}
