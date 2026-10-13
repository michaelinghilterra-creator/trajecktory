import { runAudit } from '../audit-unlogged-mail.mjs';

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.log(`  FAIL ${message}`);
  }
}

function gmailMessage(id, { from = '', to = '', cc = '', subject, date }) {
  const headers = [
    { name: 'From', value: from },
    { name: 'To', value: to },
    { name: 'Subject', value: subject },
    { name: 'Date', value: date },
  ];
  if (cc) headers.push({ name: 'Cc', value: cc });
  return { id, payload: { headers } };
}

const taRows = [
  { id: 900001, first: 'Example', last: 'Personone', company: 'Zorblax Widgetry', email: 'personone@zorblax.example.test [v:valid:fixture:2032-01-01:99]' },
  { id: 900002, first: 'Example', last: 'Persontwo', company: 'Quennox Ratchet Works', email: 'persontwo@quennox.example.test' },
];
const referralRows = [
  { id: 900003, name: 'Example Persontwo', where: 'Quennox Ratchet Works', email: 'persontwo@referral.example.test', notes: 'from TA Outreach #900002' },
];

async function audit({ sentPages = [[]], inboxPages = [[]], raw = {}, correspondence = {}, followups = [], appNotes = {}, detailResponse, sleep = async () => {}, ta = taRows, referrals = referralRows, candidateEmail = '', gmailProfileEmail = '' }) {
  const listCalls = [];
  const detailCalls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const detailMatch = parsed.pathname.match(/\/messages\/([^/]+)$/);
    if (detailMatch) {
      const id = decodeURIComponent(detailMatch[1]);
      detailCalls.push({ id, url: parsed });
      if (detailResponse) return detailResponse(id, detailCalls.filter(call => call.id === id).length);
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => raw[id],
      };
    }
    const sent = parsed.searchParams.get('q')?.startsWith('in:sent');
    const pages = sent ? sentPages : inboxPages;
    const page = parsed.searchParams.get('pageToken') ? 1 : 0;
    listCalls.push({ sent, page });
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        messages: pages[page] || [],
        ...(page === 0 && pages.length > 1 ? { nextPageToken: 'page-two' } : {}),
      }),
    };
  };
  const result = await runAudit({
    since: '2032-01-01',
    now: new Date('2032-02-01T12:00:00Z'),
    fetchImpl,
    getToken: async () => 'fixture-token',
    getProfileEmail: async () => gmailProfileEmail,
    sleep,
    readers: {
      readTa: () => ta,
      readReferrals: () => referrals,
      readTaCorrespondence: id => correspondence[`ta:${id}`] || [],
      readReferralCorrespondence: id => correspondence[`referral:${id}`] || [],
      readFollowups: () => followups,
      readAppNotes: () => appNotes,
      readCandidateEmail: () => candidateEmail,
      resolveReferralLink: row => row.id === 900003 ? { source: 'ta', contact: taRows[1] } : null,
    },
  });
  return { result, listCalls, detailCalls };
}

{
  const raw = {
    sent1: gmailMessage('sent1', { to: 'Example Personone <personone@zorblax.example.test>', subject: 'Role details', date: 'Tue, 10 Feb 2032 09:00:00 +0000' }),
  };
  const { result } = await audit({
    sentPages: [[{ id: 'sent1' }]], raw,
    correspondence: { 'ta:900001': [{ direction: 'Sent', timestamp: '2032-02-10T08:00:00Z' }] },
  });
  check(result.checked === 1 && result.missing.length === 0, 'same day TA correspondence logs a sent message');
}

{
  const raw = {
    sent2: gmailMessage('sent2', { to: 'Example Personone <personone@zorblax.example.test>', subject: 'Unlogged note', date: 'Wed, 11 Feb 2032 09:00:00 +0000' }),
  };
  const { result } = await audit({ sentPages: [[{ id: 'sent2' }]], raw });
  check(result.checked === 1 && result.missing[0]?.ref === 'ta:900001', 'sent mail with no matching log is reported');
}

{
  const raw = {
    sent3: gmailMessage('sent3', { to: 'Example Personone <personone@zorblax.example.test>', subject: 'Follow up', date: 'Thu, 12 Feb 2032 09:00:00 +0000' }),
  };
  const { result } = await audit({
    sentPages: [[{ id: 'sent3' }]], raw,
    followups: [{ date: '2032-02-13', contact: 'Example Personone (Recruiter)' }],
  });
  check(result.missing.length === 0, 'a follow up row naming the person logs sent mail');
}

{
  const raw = {
    inbox1: gmailMessage('inbox1', { from: 'Example Personone <personone@zorblax.example.test>', subject: 'Re: Role details', date: 'Fri, 13 Feb 2032 09:00:00 +0000' }),
    inbox2: gmailMessage('inbox2', { from: 'Example Personone <personone@recruiting.zorblax.example.test>', subject: 'Another reply', date: 'Sat, 14 Feb 2032 09:00:00 +0000' }),
  };
  const { result } = await audit({
    inboxPages: [[{ id: 'inbox1' }, { id: 'inbox2' }]], raw,
    appNotes: { 900004: [{ msgId: 'inbox1', timestamp: '2032-02-13T10:00:00Z' }] },
  });
  check(result.checked === 2 && result.missing.length === 1 && result.missing[0].subject === 'Another reply', 'app note logs one inbound reply and a subdomain alias is reported');
}

{
  const raw = {
    unknown: gmailMessage('unknown', { to: 'Example Persontwo <persontwo@unknown.example.test>', subject: 'Unknown', date: 'Sun, 15 Feb 2032 09:00:00 +0000' }),
  };
  const { result } = await audit({ sentPages: [[{ id: 'unknown' }]], raw });
  check(result.checked === 0 && result.missing.length === 0, 'addresses outside the contact index are ignored');
}

{
  const raw = {
    referral1: gmailMessage('referral1', { to: 'Example Persontwo <persontwo@referral.example.test>', subject: 'Introduction', date: 'Mon, 16 Feb 2032 09:00:00 +0000' }),
  };
  const { result } = await audit({
    sentPages: [[{ id: 'referral1' }]], raw,
    correspondence: { 'ta:900002': [{ direction: 'Sent', timestamp: '2032-02-15T15:00:00Z' }] },
  });
  check(result.checked === 1 && result.missing.length === 0, 'a referral checks its TA twin correspondence');
}

{
  const raw = {
    page1: gmailMessage('page1', { to: 'Example Personone <personone@zorblax.example.test>', subject: 'First page', date: 'Tue, 17 Feb 2032 09:00:00 +0000' }),
    page2: gmailMessage('page2', { to: 'Example Persontwo <persontwo@quennox.example.test>', subject: 'Second page', date: 'Wed, 18 Feb 2032 09:00:00 +0000' }),
  };
  const { result, listCalls } = await audit({ sentPages: [[{ id: 'page1' }], [{ id: 'page2' }]], raw });
  check(result.checked === 2 && result.missing.length === 2
    && listCalls.some(call => call.sent && call.page === 1), 'pagination processes both fake list pages');
}

{
  const delays = [];
  const raw = {
    retry1: gmailMessage('retry1', { to: 'Example Personone <personone@zorblax.example.test>', subject: 'Retry success', date: 'Thu, 19 Feb 2032 09:00:00 +0000' }),
  };
  const quota = JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }], message: 'Quota exceeded for query cost' } });
  const { result, detailCalls } = await audit({
    sentPages: [[{ id: 'retry1' }]], raw,
    sleep: async ms => { delays.push(ms); },
    detailResponse: async (id, attempt) => attempt <= 2
      ? { ok: false, status: 403, text: async () => quota }
      : { ok: true, status: 200, text: async () => '', json: async () => raw[id] },
  });
  const metadata = detailCalls[0]?.url;
  check(result.checked === 1 && result.unchecked === 0 && result.missing[0]?.subject === 'Retry success'
    && detailCalls.length === 3 && delays.join(',') === '1000,2000'
    && metadata?.searchParams.get('format') === 'metadata'
    && metadata?.searchParams.getAll('metadataHeaders').join(',') === 'From,To,Cc,Subject,Date',
  'quota failures retry with backoff and metadata-only message fetches');
}

{
  const delays = [];
  const quota = JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }], message: 'Quota exceeded' } });
  const { result, detailCalls } = await audit({
    inboxPages: [[{ id: 'retry2' }]],
    sleep: async ms => { delays.push(ms); },
    detailResponse: async () => ({ ok: false, status: 403, text: async () => quota }),
  });
  check(result.checked === 0 && result.unchecked === 1 && result.missing.length === 0
    && detailCalls.length === 6 && delays.join(',') === '1000,2000,4000,8000,16000',
  'permanent quota failure is counted unchecked and the audit completes');
}

{
  const ids = Array.from({ length: 7 }, (_, index) => `gentle${index + 1}`);
  let active = 0;
  let peak = 0;
  const raw = Object.fromEntries(ids.map((id, index) => [id, gmailMessage(id, {
    to: 'Example Personone <personone@zorblax.example.test>',
    subject: `Gentle fetch ${index + 1}`,
    date: `Fri, ${20 + index} Feb 2032 09:00:00 +0000`,
  })]));
  const { result } = await audit({
    sentPages: [ids.map(id => ({ id }))], raw,
    detailResponse: async id => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return { ok: true, status: 200, text: async () => '', json: async () => raw[id] };
    },
  });
  check(result.checked === 7 && peak === 3, 'message metadata fetches use at most three concurrent workers');
}

{
  const selfRows = [
    ...taRows,
    { id: 900005, first: 'Example', last: 'Personone', company: 'Quennox Ratchet Works', email: 'personone@owner.example.test' },
    { id: 900006, first: 'Example', last: 'Persontwo', company: 'Quennox Ratchet Works', email: 'persontwo@mailbox.example.test' },
  ];
  const raw = {
    selfSent: gmailMessage('selfSent', { to: 'Example Personone <personone@owner.example.test>', subject: 'Copy to myself', date: 'Thu, 27 Feb 2032 09:00:00 +0000' }),
    knownSent: gmailMessage('knownSent', { to: 'Example Personone <personone@zorblax.example.test>', subject: 'Known contact', date: 'Fri, 28 Feb 2032 09:00:00 +0000' }),
    selfInbox: gmailMessage('selfInbox', { from: 'Example Persontwo <persontwo@mailbox.example.test>', subject: 'Mailbox copy', date: 'Sat, 29 Feb 2032 09:00:00 +0000' }),
  };
  const { result } = await audit({
    sentPages: [[{ id: 'selfSent' }, { id: 'knownSent' }]],
    inboxPages: [[{ id: 'selfInbox' }]],
    raw,
    ta: selfRows,
    candidateEmail: 'PERSONONE@owner.example.test',
    gmailProfileEmail: 'persontwo@mailbox.example.test',
  });
  check(result.checked === 1 && result.missing.length === 1 && result.missing[0]?.subject === 'Known contact',
    'candidate and connected Gmail addresses are excluded as contacts, recipients, and senders');
}

console.log(`\naudit-unlogged-mail: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
