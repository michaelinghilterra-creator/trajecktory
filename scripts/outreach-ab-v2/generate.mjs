import fs from 'node:fs';
import path from 'node:path';
import { loadHarnessModules } from './bootstrap.mjs';
import { ARMS, buildPrompt } from './arms.mjs';
import { buildPacket, renderKit } from './packet.mjs';
import { buildPanelKey, renderPanel } from './panel.mjs';
import { parseDraftText, finishOptionsFor } from '../../lib/outreach-voice.mjs';

export { parseDraftText, finishOptionsFor } from '../../lib/outreach-voice.mjs';

const { generateText, draftModel, gradeModel } = await loadHarnessModules();
const { gradeIndependently } = await import('../../dashboard-web/server/lib/draft-grader.mjs');
const { finishDraft } = await import('../../dashboard-web/server/lib/finish-draft.mjs');
const { fitConnectNote } = await import('../../dashboard-web/server/lib/linkedin-ssi.mjs');

const RETRY_DELAY_MS = 20_000;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function limiter(max) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { work, resolve, reject } = queue.shift();
    Promise.resolve().then(work).then(resolve, reject).finally(() => {
      active--;
      runNext();
    });
  };
  return work => new Promise((resolve, reject) => {
    queue.push({ work, resolve, reject });
    runNext();
  });
}

async function withRetry(call, limitedCall, valid = value => value !== null && value !== undefined) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const value = await limitedCall(call);
      if (!valid(value)) throw new Error('Model returned no usable result');
      return value;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await wait(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

async function generateDraft(arm, packet, limitedCall) {
  const prompt = buildPrompt(arm, packet);
  const started = performance.now();
  const base = { arm, ms: 0, promptChars: prompt.length, subject: '', body: '', grade: null, status: 'failed' };
  try {
    const raw = await withRetry(
      () => generateText(prompt, { model: draftModel(), maxTokens: 900, label: `abv2:${arm}:${packet.kind}` }),
      limitedCall,
      value => typeof value === 'string' && value.trim().length > 0,
    );
    const parsed = parseDraftText(raw);
    if (!parsed?.body) throw new Error('Draft response could not be parsed');
    const finished = await finishDraft({
      body: parsed.body,
      subject: parsed.subject,
      surface: packet.surfaceId,
      cadence: false,
      ...finishOptionsFor(packet),
    });
    let body = finished.body;
    if (packet.kind === 'connect_note') body = fitConnectNote(body, packet.sender.firstName).text;
    base.subject = finished.subject || '';
    base.body = body;
    base.status = 'ok';
  } catch (error) {
    base.error = error?.message || String(error);
  }
  base.ms = Math.round(performance.now() - started);

  if (base.status === 'ok') {
    try {
      base.grade = await withRetry(
        () => gradeIndependently(base.body, packet.surfaceId, {
          model: gradeModel(),
          subject: base.subject,
          cvExcerpt: packet.sender.cv,
          proofPoints: packet.sender.proofPoints,
          companyResearch: packet.research,
          recipientRole: packet.recipient.title,
          recipientTier: packet.recipient.tier,
          appliedRole: packet.application?.role || '',
          appliedDate: packet.application?.date || '',
        }),
        limitedCall,
      );
      base.gradeStatus = 'ok';
    } catch (error) {
      base.gradeStatus = 'failed';
      base.gradeError = error?.message || String(error);
    }
  } else {
    base.gradeStatus = 'skipped';
  }
  return base;
}

export async function generatePacket(packet, { concurrency = 2 } = {}) {
  const max = Number(concurrency);
  if (!Number.isInteger(max) || max < 1) throw new Error('Concurrency must be a positive integer');
  const limitedCall = limiter(max);
  return Promise.all(ARMS.map(arm => generateDraft(arm, packet, limitedCall)));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function prepareTrancheGeneration({ runDir, tranche, force = false, onCleared = null } = {}) {
  const dir = path.resolve(runDir || '');
  if (!runDir || !fs.existsSync(path.join(dir, 'cases.json'))) throw new Error('Run directory must contain cases.json');
  const trancheNumber = Number(tranche);
  if (![1, 2, 3].includes(trancheNumber)) throw new Error('Tranche must be 1, 2, or 3');
  const trancheDir = path.join(dir, `tranche-${trancheNumber}`);
  const picksFile = path.join(trancheDir, 'picks.json');
  if (fs.existsSync(picksFile)) {
    if (!force) throw new Error(`Tranche ${trancheNumber} already has picks.json; use --force to regenerate`);
    fs.unlinkSync(picksFile);
    if (onCleared) onCleared(`Cleared ${picksFile}`);
    return { dir, trancheNumber, trancheDir, picksFile, clearedPicks: true };
  }
  return { dir, trancheNumber, trancheDir, picksFile, clearedPicks: false };
}

export async function generateTranche({ runDir, tranche, concurrency = 2, force = false, onCleared = null } = {}) {
  const max = Number(concurrency);
  if (!Number.isInteger(max) || max < 1) throw new Error('Concurrency must be a positive integer');
  const prepared = prepareTrancheGeneration({ runDir, tranche, force, onCleared });
  const { dir, trancheNumber, trancheDir } = prepared;

  const selected = readJson(path.join(dir, 'cases.json')).filter(item => Number(item.tranche) === trancheNumber);
  const packets = selected.map(item => ({ ...item, packet: buildPacket(item) }));
  const limitedCall = limiter(max);
  const generated = await Promise.all(packets.map(async entry => ({
    ...entry,
    kit: renderKit(entry.packet),
    drafts: await Promise.all(ARMS.map(arm => generateDraft(arm, entry.packet, limitedCall))),
  })));

  fs.mkdirSync(trancheDir, { recursive: true });
  writeJson(path.join(trancheDir, 'packets.json'), packets.map(entry => ({
    number: entry.number, label: entry.label, kind: entry.kind, tier: entry.tier, packet: entry.packet,
  })));
  writeJson(path.join(trancheDir, 'kits.json'), generated.map(entry => ({ number: entry.number, label: entry.label, kit: entry.kit })));
  writeJson(path.join(trancheDir, 'drafts.json'), generated);

  const seed = readJson(path.join(dir, 'mix.json')).seed ?? 1;
  const trancheKey = buildPanelKey(generated, seed);
  const keyFile = path.join(dir, 'key.json');
  const existingKey = fs.existsSync(keyFile) ? readJson(keyFile) : {};
  writeJson(keyFile, { ...existingKey, ...trancheKey });
  fs.writeFileSync(path.join(trancheDir, 'panel.html'), renderPanel({ cases: generated, key: trancheKey, seed }), 'utf8');
  return { tranche: trancheNumber, cases: generated, key: trancheKey, dir: trancheDir, clearedPicks: prepared.clearedPicks };
}
