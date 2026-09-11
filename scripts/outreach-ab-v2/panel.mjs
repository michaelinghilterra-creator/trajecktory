import { seededShuffle } from './sample.mjs';

const ICON = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M11.586 2a1.5 1.5 0 0 1 1.06.44l2.914 2.914a1.5 1.5 0 0 1 .44 1.06V16.5a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.492-1.347L4 16.5v-13A1.5 1.5 0 0 1 5.5 2zM5.5 3a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7h-2.5A1.5 1.5 0 0 1 11 5.5V3zm7.04 10.304a.5.5 0 0 1 .92.392c-.295.69-.871 1.304-1.66 1.304-.487 0-.892-.234-1.2-.574-.309.34-.713.574-1.2.574-.486 0-.892-.233-1.2-.574-.31.34-.714.574-1.2.574a.5.5 0 0 1 0-1c.212 0 .52-.18.74-.696l.034-.067a.5.5 0 0 1 .886.067c.221.516.528.696.74.696.213 0 .52-.18.74-.696l.035-.067a.5.5 0 0 1 .885.067c.22.516.527.696.74.696s.519-.18.74-.696m0-4a.5.5 0 0 1 .92.392c-.295.69-.871 1.304-1.66 1.304-.487 0-.892-.234-1.2-.574-.309.34-.713.574-1.2.574-.486 0-.892-.233-1.2-.574-.31.34-.714.574-1.2.574a.5.5 0 0 1 0-1c.212 0 .52-.18.74-.696l.034-.067a.5.5 0 0 1 .886.067c.221.516.528.696.74.696.213 0 .52-.18.74-.696l.035-.067a.5.5 0 0 1 .885.067c.22.516.527.696.74.696s.519-.18.74-.696M12 5.5a.5.5 0 0 0 .5.5h2.293L12 3.207z"/></svg>';
const LETTERS = ['A', 'B', 'C'];
const FIXED_GREETING_KINDS = new Set(['ta_dm', 'ta_email', 'referral_dm', 'referral_email', 'app_followup']);

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function caseNumber(item, index) {
  const raw = item?.number ?? String(item?.label || '').replace(/^C/i, '') ?? index + 1;
  return String(raw || index + 1).padStart(2, '0');
}

export function buildPanelKey(cases, seed = 1) {
  const key = {};
  for (const [index, item] of (cases || []).entries()) {
    const number = caseNumber(item, index);
    const order = seededShuffle(['august', 'lap7', 'august_plus'], Number(seed) + Number(number));
    key[number] = Object.fromEntries(LETTERS.map((letter, i) => [letter, order[i]]).filter(([, arm]) => arm));
  }
  return key;
}

function lines(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function kitHtml(kit) {
  const rows = [
    ['Who', kit?.who],
    ['What they do', kit?.whatTheyDo],
    ['History', kit?.history],
    ['Application', kit?.application],
    ['Goal', kit?.goal],
    ['Channel', kit?.channel],
  ];
  return `<div class="elicit-kit" style="background:var(--surface-1);border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.5;font-weight:400;color:var(--text-secondary)">${rows.map(([label, value]) => `<div>${label}: ${lines(value || '')}</div>`).join('')}</div>`;
}

function versionHtml(letter, draft, item) {
  const blockStyle = 'border-top:0.5px solid var(--border);padding:12px 0;font-size:13px;font-weight:500;color:var(--text-primary)';
  const label = `<div class="elicit-version-label">Version ${letter}</div>`;
  if (!draft || draft.status !== 'ok') return `<div class="elicit-version" style="${blockStyle}">${label}<div class="elicit-version-body" style="font-size:14px;line-height:1.6;font-weight:400;color:var(--text-primary)">Draft unavailable.</div></div>`;
  const subject = draft.subject ? `<div class="elicit-subject" style="font-size:13px;font-weight:400;margin-bottom:6px;color:var(--text-primary)">Subject: ${escapeHtml(draft.subject)}</div>` : '';
  const greeting = FIXED_GREETING_KINDS.has(item.kind)
    ? `<div class="elicit-version-body" style="font-size:14px;line-height:1.6;font-weight:400;color:var(--text-primary)">Hi ${escapeHtml(item.packet?.recipient?.first || item.recipient?.first || '')},</div>`
    : '';
  return `<div class="elicit-version" style="${blockStyle}">${label}${subject}${greeting}<div class="elicit-version-body" style="font-size:14px;line-height:1.6;font-weight:400;color:var(--text-primary)">${lines(draft.body || '')}</div></div>`;
}

function pills(name) {
  return `<div class="elicit-pills" data-name="${name}" data-multi="false">${['A', 'B', 'C', 'None'].map(value => `<button type="button" class="elicit-pill" data-value="${value}">${value}</button>`).join('')}</div>`;
}

export function renderPanel(tranche, suppliedKey = null) {
  const cases = Array.isArray(tranche) ? tranche : (tranche?.cases || []);
  const key = suppliedKey || tranche?.key || buildPanelKey(cases, tranche?.seed || 1);
  const groups = cases.map((item, index) => {
    const number = caseNumber(item, index);
    const byArm = new Map((item.drafts || []).map(draft => [draft.arm, draft]));
    const versions = LETTERS.map(letter => versionHtml(letter, byArm.get(key[number]?.[letter]), item)).join('');
    return `<div class="elicit-group"><div class="elicit-case-label" style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text-primary)">Case ${number}</div>${kitHtml(item.kit)}${versions}<label class="elicit-question">Which one would you send?</label>${pills(`c${number}_favorite`)}<label class="elicit-question">Any close second?</label>${pills(`c${number}_second`)}</div>`;
  }).join('');
  return `<form class="elicit"><div class="elicit-header">${ICON}<span>Outreach rating details</span></div><div class="elicit-body">${groups}</div><div class="elicit-footer"><button type="button" class="elicit-skip">Skip</button><button type="button" class="elicit-submit">Submit ratings</button></div></form>`;
}
