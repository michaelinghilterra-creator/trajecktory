import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEGACY_JSON_FILES,
  LEGACY_TABLE_FILES,
  listLegacyFiles,
  renderLegacyFile,
  splitLegacyLines,
} from '../legacy-files.mjs';

function byteComparison(original, rendered) {
  const originalLines = original === null ? [] : splitLegacyLines(original);
  const renderedLines = rendered === null ? [] : splitLegacyLines(rendered);
  const length = Math.max(originalLines.length, renderedLines.length);
  let firstDifferingLine = null;
  let lineEndingsDiffer = false;
  for (let index = 0; index < length; index++) {
    const left = originalLines[index];
    const right = renderedLines[index];
    if (left?.eol !== right?.eol) lineEndingsDiffer = true;
    if (firstDifferingLine === null
      && (!left || !right || left.text !== right.text || left.eol !== right.eol)) {
      firstDifferingLine = index + 1;
    }
  }
  return {
    match: original === rendered,
    original_lines: originalLines.length,
    rendered_lines: renderedLines.length,
    first_differing_line: firstDifferingLine,
    line_endings_differ: lineEndingsDiffer,
  };
}

export function verifyImport(store, imported, _dataDir, _outputDir) {
  const tables = Object.fromEntries(LEGACY_TABLE_FILES.map(file => [
    file,
    byteComparison(imported.texts[file], renderLegacyFile(store, file)),
  ]));
  const json = Object.fromEntries(LEGACY_JSON_FILES.map(file => {
    const original = imported.texts[file];
    const rendered = renderLegacyFile(store, file);
    return [file, {
      match: original === rendered,
      absent: original === null,
      original_bytes: original === null ? 0 : Buffer.byteLength(original, 'utf8'),
      rendered_bytes: rendered === null ? 0 : Buffer.byteLength(rendered, 'utf8'),
    }];
  }));
  const correspondence = {};
  for (const [dir, input] of Object.entries(imported.reports.correspondenceInputs)) {
    const known = new Set([
      ...Object.keys(input).map(file => `${dir}/${file}`),
      ...listLegacyFiles(store).filter(file => file.startsWith(`${dir}/`)),
    ]);
    const comparisons = [...known].sort().map(file => byteComparison(
      input[file.slice(dir.length + 1)] ?? null,
      renderLegacyFile(store, file),
    ));
    correspondence[dir] = {
      files: known.size,
      differing_files: comparisons.filter(result => !result.match).length,
      original_lines: comparisons.reduce((sum, result) => sum + result.original_lines, 0),
      rendered_lines: comparisons.reduce((sum, result) => sum + result.rendered_lines, 0),
      first_differing_line: comparisons.find(result => !result.match)?.first_differing_line ?? null,
      line_endings_differ: comparisons.some(result => result.line_endings_differ),
    };
  }

  const comparisons = {
    tracker: imported.reports.trackerComparison,
    apply: imported.reports.applyComparison,
    status: imported.reports.statusComparison,
    people: imported.reports.peopleComparison,
    followups: imported.reports.followupsComparison,
    correspondence: imported.reports.correspondenceComparison,
    linkedin: imported.reports.linkedinComparison,
    twc: imported.reports.twcComparison,
  };
  const bytes = { tables, correspondence, json };
  const bytesMatch = Object.values(tables).every(result => result.match)
    && Object.values(correspondence).every(result => result.differing_files === 0)
    && Object.values(json).every(result => result.match);
  const ok = Object.values(comparisons).every(result => result.match) && bytesMatch;
  return { comparisons, bytes, ok };
}

export function changedImportedFiles(store, imported, dataDir) {
  return listLegacyFiles(store).filter(file => {
    const expected = imported.texts[file] ?? null;
    const path = join(dataDir, file);
    if (expected === null) return existsSync(path);
    if (!existsSync(path)) return true;
    try {
      return Buffer.compare(readFileSync(path), Buffer.from(expected, 'utf8')) !== 0;
    } catch {
      return true;
    }
  });
}

export function printImportVerification(result, log = console.log) {
  const labels = [
    ['tracker', 'TRACKER'],
    ['apply', 'APPLY DATES'],
    ['status', 'STATUS HISTORY'],
    ['people', 'PEOPLE'],
    ['followups', 'FOLLOWUPS'],
    ['correspondence', 'CORRESPONDENCE'],
    ['linkedin', 'LINKEDIN'],
    ['twc', 'TWC'],
  ];
  for (const [key, label] of labels) {
    log(result.comparisons[key].match ? `${label} MATCH` : `${label} MISMATCH`);
  }
  for (const file of LEGACY_TABLE_FILES) {
    const item = result.bytes.tables[file];
    log(item.match
      ? `BYTES MATCH ${file}`
      : `BYTES DIFFER ${file} (original_lines=${item.original_lines} rendered_lines=${item.rendered_lines} first_differing_line=${item.first_differing_line} line_endings_differ=${item.line_endings_differ})`);
  }
  for (const dir of ['target-talent-correspondence', 'referral-correspondence']) {
    const item = result.bytes.correspondence[dir];
    log(item.differing_files === 0
      ? `BYTES MATCH ${dir} (${item.files} files)`
      : `BYTES DIFFER ${dir} (${item.differing_files} of ${item.files} files; original_lines=${item.original_lines} rendered_lines=${item.rendered_lines} first_differing_line=${item.first_differing_line} line_endings_differ=${item.line_endings_differ})`);
  }
  for (const file of LEGACY_JSON_FILES) {
    const item = result.bytes.json[file];
    log(item.match
      ? `BYTES MATCH ${file}${item.absent ? ' (absent)' : ''}`
      : `BYTES DIFFER ${file} (original_bytes=${item.original_bytes} rendered_bytes=${item.rendered_bytes})`);
  }
}
