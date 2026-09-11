import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { caseNumber, escapeHtml, fixedGreeting } from './panel.mjs';
import { recordPicks } from './score.mjs';

const LETTERS = ['A', 'B', 'C'];
const CHOICES = [...LETTERS, 'None'];

export function createRateToken() {
  return randomBytes(32).toString('hex');
}

function headerValue(headers, name) {
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : String(value ?? '').trim();
}

function hasHeader(headers, name) {
  return Object.keys(headers || {}).some(key => key.toLowerCase() === name);
}

export function isLoopbackHost(hostHeader) {
  const host = String(hostHeader || '').toLowerCase().trim();
  let bare = host;
  if (host.startsWith('[')) bare = host.slice(0, host.indexOf(']') + 1);
  else if (host.includes(':')) bare = host.slice(0, host.indexOf(':'));
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '[::1]';
}

export function isLoopbackOrigin(origin) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(origin || '').trim());
}

function rateTokenMatches(provided, expected) {
  const providedDigest = createHash('sha256').update(String(provided || '')).digest();
  const expectedDigest = createHash('sha256').update(String(expected || '')).digest();
  const equal = timingSafeEqual(providedDigest, expectedDigest);
  return Boolean(provided) && Boolean(expected) && equal;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function jsonResponse(status, value) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(value),
  };
}

function htmlResponse(status, body) {
  return { status, headers: { 'content-type': 'text/html; charset=utf-8' }, body };
}

function lines(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function layout(title, content) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f5f6f8;--card:#fff;--text:#202124;--muted:#5f6368;--border:#d8dce2;--accent:#2563eb;--danger:#b91c1c;--danger-bg:#fff1f2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(860px,calc(100% - 28px));margin:24px auto 64px}a{color:var(--accent)}h1{font-size:22px;margin:0}h2{font-size:18px;margin:0 0 12px}.sticky{position:sticky;top:0;z-index:2;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);padding:12px 0;margin-bottom:18px}.sticky-inner{width:min(860px,calc(100% - 28px));margin:auto;display:flex;align-items:center;justify-content:space-between;gap:16px}.count{color:var(--muted);white-space:nowrap}.case,.index-row{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:18px}.case.unanswered{border:2px solid var(--danger);background:var(--danger-bg)}.kit{background:var(--bg);border-radius:9px;padding:11px 13px;color:var(--muted);font-size:14px}.version{border-top:1px solid var(--border);padding:14px 0}.version-label,.question{font-weight:650;margin-bottom:7px}.subject{margin-bottom:6px}.body{white-space:normal}.question{display:block;margin-top:12px}.choices{display:flex;flex-wrap:wrap;gap:9px;margin-bottom:14px}.choice{display:flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:999px;padding:8px 13px;cursor:pointer}.choice:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}input[type=radio]{width:19px;height:19px;margin:0;accent-color:var(--accent)}button{font:inherit;font-weight:650;color:#fff;background:var(--accent);border:0;border-radius:8px;padding:9px 16px;cursor:pointer}button:disabled{opacity:.55;cursor:default}.note,.message{border:1px solid var(--border);border-radius:9px;background:var(--card);padding:10px 13px}.error{color:var(--danger)}.index-row{display:flex;justify-content:space-between;align-items:center;gap:16px}.status{color:var(--muted);font-size:14px}
@media(prefers-color-scheme:dark){:root{--bg:#15171a;--card:#202327;--text:#f2f3f5;--muted:#b0b5bd;--border:#3b4048;--accent:#78a9ff;--danger:#ff9ca4;--danger-bg:#321f22}}
</style>
</head>
<body>${content}</body>
</html>`;
}

export function findTranches(runDir) {
  const dir = path.resolve(runDir || '');
  if (!runDir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^tranche-\d+$/.test(entry.name))
    .map(entry => {
      const tranche = Number(entry.name.slice('tranche-'.length));
      const trancheDir = path.join(dir, entry.name);
      return {
        tranche,
        drafts: fs.existsSync(path.join(trancheDir, 'drafts.json')),
        picks: fs.existsSync(path.join(trancheDir, 'picks.json')),
      };
    })
    .sort((a, b) => a.tranche - b.tranche);
}

export function renderIndexPage({ runDir, tranches = findTranches(runDir) } = {}) {
  const rows = tranches.map(item => `<div class="index-row"><div><strong>Tranche ${item.tranche}</strong><div class="status">Drafts: ${item.drafts ? 'ready' : 'missing'} · Picks: ${item.picks ? 'recorded' : 'not recorded'}</div></div><a href="/t/${item.tranche}">Open</a></div>`).join('');
  return layout('Outreach ratings', `<main><h1>Outreach ratings</h1><p class="status">Choose a tranche to review.</p>${rows || '<p class="note">No tranches found.</p>'}</main>`);
}

export function loadRatingData(runDir, tranche) {
  const dir = path.resolve(runDir || '');
  const trancheNumber = Number(tranche);
  const trancheDir = path.join(dir, `tranche-${trancheNumber}`);
  const draftsFile = path.join(trancheDir, 'drafts.json');
  const kitsFile = path.join(trancheDir, 'kits.json');
  const keyFile = path.join(dir, 'key.json');
  if (!runDir || ![1, 2, 3].includes(trancheNumber) || !fs.existsSync(draftsFile) || !fs.existsSync(kitsFile) || !fs.existsSync(keyFile)) {
    throw Object.assign(new Error(`Tranche ${trancheNumber || tranche} is not ready`), { status: 404 });
  }
  const cases = readJson(draftsFile);
  const kits = readJson(kitsFile);
  const key = readJson(keyFile);
  const picksFile = path.join(trancheDir, 'picks.json');
  const picks = fs.existsSync(picksFile) ? readJson(picksFile) : null;
  return { runDir: dir, tranche: trancheNumber, cases, kits, key, picks };
}

function letterForArm(mapping, arm) {
  if (arm == null) return 'None';
  return LETTERS.find(letter => mapping?.[letter] === arm) || null;
}

function radioGroup(number, field, selected, readOnly) {
  return `<div class="choices">${CHOICES.map(choice => `<label class="choice"><input type="radio" name="c${number}_${field}" value="${choice}"${selected === choice ? ' checked' : ''}${readOnly ? ' disabled' : ''}>${choice}</label>`).join('')}</div>`;
}

function kitBlock(kit) {
  const rows = [
    ['Who', kit?.who],
    ['What they do', kit?.whatTheyDo],
    ['History', kit?.history],
    ['Application', kit?.application],
    ['Goal', kit?.goal],
    ['Channel', kit?.channel],
  ];
  return `<div class="kit">${rows.map(([label, value]) => `<div><strong>${label}:</strong> ${lines(value || '')}</div>`).join('')}</div>`;
}

function versionBlock(letter, draft, item) {
  if (!draft || draft.status !== 'ok') return `<section class="version"><div class="version-label">Version ${letter}</div><div>Draft unavailable.</div></section>`;
  const subject = draft.subject ? `<div class="subject"><strong>Subject:</strong> ${escapeHtml(draft.subject)}</div>` : '';
  const greeting = fixedGreeting(item);
  return `<section class="version"><div class="version-label">Version ${letter}</div>${subject}${greeting ? `<div>${escapeHtml(greeting)}</div>` : ''}<div class="body">${lines(draft.body || '')}</div></section>`;
}

export function renderRatingPage({ runDir, tranche, cases = [], kits = [], key = {}, picks = null, rateToken = '' } = {}) {
  const readOnly = picks !== null;
  const kitByNumber = new Map(kits.map((item, index) => [caseNumber(item, index), item.kit || {}]));
  const ordered = [...cases].sort((a, b) => Number(caseNumber(a, 0)) - Number(caseNumber(b, 0)));
  const cards = ordered.map((item, index) => {
    const number = caseNumber(item, index);
    const mapping = key[number];
    if (!mapping || LETTERS.some(letter => !mapping[letter])) throw new Error(`Missing version mapping for case ${number}`);
    const byArm = new Map((item.drafts || []).map(draft => [draft.arm, draft]));
    const versions = LETTERS.map(letter => versionBlock(letter, byArm.get(mapping[letter]), item)).join('');
    const favorite = readOnly && Object.hasOwn(picks[number] || {}, 'favorite') ? letterForArm(mapping, picks[number].favorite) : null;
    const second = readOnly && Object.hasOwn(picks[number] || {}, 'second') ? letterForArm(mapping, picks[number].second) : null;
    return `<article class="case" data-case="${number}"><h2>Case ${number}</h2>${kitBlock(kitByNumber.get(number))}${versions}<span class="question">Which one would you send?</span>${radioGroup(number, 'favorite', favorite, readOnly)}<span class="question">Any close second?</span>${radioGroup(number, 'second', second, readOnly)}</article>`;
  }).join('');
  const storageKey = `outreach-ab-v2:${createHash('sha256').update(path.resolve(runDir || '')).digest('hex').slice(0, 16)}:${Number(tranche)}`;
  const recordedCount = readOnly ? ordered.filter((item, index) => Object.hasOwn(picks[caseNumber(item, index)] || {}, 'favorite')).length : 0;
  const headerAction = readOnly ? `<span class="count"><strong>${recordedCount}</strong>/${ordered.length} answered</span>` : `<span><span class="count"><strong data-answered>0</strong>/${ordered.length} answered</span> <button type="button" data-submit>Submit</button></span>`;
  const note = readOnly ? '<p class="note">These picks have already been recorded. This view is read-only.</p>' : '<p class="message" data-message hidden></p>';
  const script = readOnly ? '' : `<script>
const caseNumbers=${JSON.stringify(ordered.map((item, index) => caseNumber(item, index)))};
const storageKey=${JSON.stringify(storageKey)};
const rateToken=${JSON.stringify(rateToken)};
const allowed=new Set(['A','B','C','None']);
const cards=[...document.querySelectorAll('[data-case]')];
const answered=document.querySelector('[data-answered]');
const submit=document.querySelector('[data-submit]');
const message=document.querySelector('[data-message]');
function selected(number,field){return document.querySelector('input[name="c'+number+'_'+field+'"]:checked')?.value||null}
function syncSecond(number){const favorite=selected(number,'favorite');for(const input of document.querySelectorAll('input[name="c'+number+'_second"]')){input.disabled=favorite==='None'||input.value===favorite;if(input.disabled&&input.checked)input.checked=false}}
function update(){answered.textContent=String(caseNumbers.filter(number=>selected(number,'favorite')).length)}
function save(){const state={};for(const number of caseNumbers){const favorite=selected(number,'favorite');const second=selected(number,'second');if(favorite||second)state[number]={favorite,second}}localStorage.setItem(storageKey,JSON.stringify(state));update()}
try{const state=JSON.parse(localStorage.getItem(storageKey)||'{}');for(const number of caseNumbers){for(const field of ['favorite','second']){const value=state?.[number]?.[field];if(!allowed.has(value))continue;const input=document.querySelector('input[name="c'+number+'_'+field+'"][value="'+value+'"]');if(input)input.checked=true}}}catch{localStorage.removeItem(storageKey)}
for(const number of caseNumbers)syncSecond(number);save();
document.addEventListener('change',event=>{const card=event.target.closest('[data-case]');if(card)syncSecond(card.dataset.case);save()});
submit.addEventListener('click',async()=>{const missing=[];for(const card of cards){card.classList.remove('unanswered');const number=card.dataset.case;if(!selected(number,'favorite')){card.classList.add('unanswered');missing.push(card)}}if(missing.length){message.hidden=false;message.className='message error';message.textContent='Choose a favorite for every case.';missing[0].scrollIntoView({behavior:'smooth',block:'center'});return}const answers={};for(const number of caseNumbers){const favorite=selected(number,'favorite');const second=selected(number,'second');answers[number]={favorite:favorite==='None'?null:favorite,second:!second||second==='None'?null:second}}submit.disabled=true;try{const response=await fetch(location.pathname+'/submit',{method:'POST',headers:{'Content-Type':'application/json','x-rate-token':rateToken},body:JSON.stringify(answers)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save picks.');localStorage.removeItem(storageKey);message.hidden=false;message.className='message';message.textContent='Saved. '+result.recorded+' cases recorded.';document.querySelectorAll('input[type=radio]').forEach(input=>{input.disabled=true});submit.remove();answered.parentElement.textContent='Recorded'}catch(error){message.hidden=false;message.className='message error';message.textContent=error.message;submit.disabled=false}});
</script>`;
  return layout(`Tranche ${Number(tranche)} ratings`, `<div class="sticky"><div class="sticky-inner"><h1>Tranche ${Number(tranche)}</h1>${headerAction}</div></div><main>${note}${cards}</main>${script}`);
}

export function validateSubmission(answers, caseNumbers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw Object.assign(new Error('Submission must be a JSON object'), { status: 400 });
  const expected = new Set(caseNumbers);
  for (const number of Object.keys(answers)) {
    if (!expected.has(number)) throw Object.assign(new Error(`Unknown case: ${number}`), { status: 400 });
  }
  const normalized = {};
  const duplicateCases = [];
  const secondAfterNoneCases = [];
  for (const number of caseNumbers) {
    const answer = answers[number];
    if (!answer || typeof answer !== 'object' || Array.isArray(answer) || !Object.hasOwn(answer, 'favorite')) {
      throw Object.assign(new Error(`Case ${number} is missing a favorite`), { status: 400 });
    }
    if (![...LETTERS, null].includes(answer.favorite)) throw Object.assign(new Error(`Case ${number} has an invalid favorite`), { status: 400 });
    if (Object.hasOwn(answer, 'second') && ![...LETTERS, null].includes(answer.second)) throw Object.assign(new Error(`Case ${number} has an invalid close second`), { status: 400 });
    normalized[number] = { favorite: answer.favorite, second: answer.second ?? null };
    if (normalized[number].favorite !== null && normalized[number].second === normalized[number].favorite) duplicateCases.push(number);
    if (normalized[number].favorite === null && normalized[number].second !== null) secondAfterNoneCases.push(number);
  }
  const conflicts = [];
  if (duplicateCases.length) conflicts.push(`${duplicateCases.map(number => `Case ${number}`).join(', ')}: close second cannot equal favorite`);
  if (secondAfterNoneCases.length) conflicts.push(`${secondAfterNoneCases.map(number => `Case ${number}`).join(', ')}: close second must be None when favorite is None`);
  if (conflicts.length) throw Object.assign(new Error(conflicts.join('; ')), { status: 400 });
  return normalized;
}

export function handleSubmit({ runDir, tranche, answers } = {}) {
  const data = loadRatingData(runDir, tranche);
  const target = path.join(data.runDir, `tranche-${data.tranche}`, 'picks.json');
  if (fs.existsSync(target)) throw Object.assign(new Error('Picks have already been recorded'), { status: 409 });
  const numbers = data.cases.map((item, index) => caseNumber(item, index)).sort((a, b) => Number(a) - Number(b));
  const normalized = validateSubmission(answers, numbers);
  const result = recordPicks(data.runDir, data.tranche, normalized);
  fs.writeFileSync(path.join(path.dirname(result.target), 'submission.json'), JSON.stringify(answers, null, 2) + '\n', 'utf8');
  return {
    recorded: Object.keys(result.picks).length,
    total: numbers.length,
    favorites: numbers.length,
    seconds: Object.values(normalized).filter(answer => answer.second !== null).length,
    picks: result.picks,
  };
}

export function handleRequest({ runDir, rateToken = '', method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  if (!isLoopbackHost(headerValue(headers, 'host'))) {
    return jsonResponse(403, { error: 'Forbidden: unexpected Host header (rating server is loopback-only).' });
  }
  const requestUrl = new URL(url, 'http://127.0.0.1');
  try {
    if (method === 'GET' && requestUrl.pathname === '/') return htmlResponse(200, renderIndexPage({ runDir }));
    const page = requestUrl.pathname.match(/^\/t\/(\d+)$/);
    if (method === 'GET' && page) return htmlResponse(200, renderRatingPage({ ...loadRatingData(runDir, Number(page[1])), rateToken }));
    const submit = requestUrl.pathname.match(/^\/t\/(\d+)\/submit$/);
    if (method === 'POST' && submit) {
      const origin = headerValue(headers, 'origin');
      if (hasHeader(headers, 'origin') && !isLoopbackOrigin(origin)) return jsonResponse(403, { error: 'Forbidden: unexpected Origin header.' });
      const contentType = headerValue(headers, 'content-type').split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') return jsonResponse(415, { error: 'Content-Type must be application/json.' });
      if (!rateTokenMatches(headerValue(headers, 'x-rate-token'), rateToken)) return jsonResponse(403, { error: 'Forbidden: missing or invalid rating token.' });
      let answers;
      try { answers = typeof body === 'string' || Buffer.isBuffer(body) ? JSON.parse(String(body)) : body; }
      catch { return jsonResponse(400, { error: 'Invalid JSON submission' }); }
      const result = handleSubmit({ runDir, tranche: Number(submit[1]), answers });
      return jsonResponse(200, { recorded: result.recorded, total: result.total, favorites: result.favorites, seconds: result.seconds });
    }
    if ((page || submit) && !['GET', 'POST'].includes(method)) return jsonResponse(405, { error: 'Method not allowed' });
    return htmlResponse(404, layout('Not found', '<main><h1>Not found</h1><p>The requested page does not exist.</p></main>'));
  } catch (error) {
    const status = Number(error.status) || (/already exists/i.test(error.message) ? 409 : 500);
    return jsonResponse(status, { error: status === 500 ? 'Could not process the request' : error.message });
  }
}

export function createRatingServer({ runDir, rateToken = createRateToken() } = {}) {
  return http.createServer((request, response) => {
    if (!isLoopbackHost(headerValue(request.headers, 'host'))) {
      const result = jsonResponse(403, { error: 'Forbidden: unexpected Host header (rating server is loopback-only).' });
      response.writeHead(result.status, { ...result.headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(result.body);
      request.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size <= 1024 * 1024) chunks.push(chunk);
    });
    request.on('end', () => {
      const result = size > 1024 * 1024
        ? jsonResponse(413, { error: 'Submission is too large' })
        : handleRequest({ runDir, rateToken, method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(result.status, { ...result.headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(result.body);
    });
  });
}

export function startRatingServer({ runDir, port = process.env.PORT || 4110, rateToken = createRateToken() } = {}) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 0 || numericPort > 65535) throw new Error('--port must be an integer from 0 to 65535');
  const server = createRatingServer({ runDir, rateToken });
  server.listen(numericPort, '127.0.0.1');
  return server;
}
