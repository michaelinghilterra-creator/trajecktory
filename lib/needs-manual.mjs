import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from './atomic-write.mjs';
import { appendGateHistory } from './gate-history.mjs';
import { updatePipelineRows } from './pipeline.mjs';
import { canonicalUrl } from './identity.mjs';
import { probePostingGone } from './ats-gone.mjs';

function parseRows(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const header = lines.shift() ?? '';
  const rows = [];
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const cells = raw.replace(/\r$/, '').split('\t');
    const url = String(cells[0] || '').trim();
    if (!/^https?:\/\//.test(url)) continue;
    rows.push({ index, raw, url, company: String(cells[1] || '').trim(), role: String(cells[2] || '').trim() });
  }
  return { header, lines, rows };
}

export async function clearClosedFromNeedsManual({
  needsManualPath,
  pipelinePath,
  gateHistoryPath,
  probe = probePostingGone,
  apply = false,
  today,
} = {}) {
  const empty = { checked: 0, closed: [], kept: 0, unknown: 0 };
  if (!needsManualPath || !existsSync(needsManualPath)) return empty;
  const original = readFileSync(needsManualPath, 'utf8');
  if (!original.trim()) return empty;

  const parsed = parseRows(original);
  if (!parsed.rows.length) return empty;
  const verdicts = new Map();
  for (const row of parsed.rows) {
    if (verdicts.has(row.url)) continue;
    try {
      verdicts.set(row.url, await probe(row.url));
    } catch (error) {
      verdicts.set(row.url, { verdict: 'unknown', reason: `probe failed: ${error?.message || error}` });
    }
  }

  const closed = [];
  let unknown = 0;
  let kept = 0;
  for (const row of parsed.rows) {
    const result = verdicts.get(row.url) || { verdict: 'unknown', reason: 'probe returned no result' };
    if (result.verdict === 'gone') {
      closed.push({ url: row.url, company: row.company, role: row.role, reason: result.reason });
    } else {
      kept++;
      if (result.verdict === 'unknown') unknown++;
    }
  }

  const output = { checked: verdicts.size, closed, kept, unknown };
  if (!apply || !closed.length) return output;

  const closedUrls = new Set(closed.map((row) => row.url));
  let firstError = null;
  try {
    const closedIndexes = new Set(parsed.rows.filter((row) => closedUrls.has(row.url)).map((row) => row.index));
    const remaining = parsed.lines.filter((_row, index) => !closedIndexes.has(index));
    const content = [parsed.header, ...remaining].join('\n') + '\n';
    writeFileAtomic(needsManualPath, content);
  } catch (error) {
    firstError ||= error;
  }

  try {
    appendGateHistory(gateHistoryPath, closed.map((row) => ({
      url: row.url,
      company: row.company,
      role: row.role,
      result: 'expired',
      reason: `ats-gone: ${row.reason}`,
    })), today);
  } catch (error) {
    firstError ||= error;
  }

  try {
    const canonicalClosed = new Set(closed.map((row) => canonicalUrl(row.url)).filter(Boolean));
    updatePipelineRows(pipelinePath, (row) => {
      if (row.state === 'dead' || !canonicalClosed.has(row.canonical)) return null;
      const rest = row.rest.includes('— gated:') ? row.rest : `${row.rest} — gated: closed (posting removed)`;
      return { box: '!', rest };
    });
  } catch (error) {
    firstError ||= error;
  }

  if (firstError) output.error = firstError;
  return output;
}
