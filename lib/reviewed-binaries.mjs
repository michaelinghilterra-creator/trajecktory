import { execFileSync } from 'node:child_process';

export const BINARY_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'docx', 'xlsx',
  'pptx', 'zip', 'gz', 'woff', 'woff2', 'ttf', 'otf', 'exe',
];

const BINARY_SUFFIX = new RegExp(`\\.(${BINARY_EXTENSIONS.join('|')})$`, 'i');

export function listTrackedBinaries(cwd) {
  const output = execFileSync('git', ['ls-files', '-s', '-z'], {
    cwd,
    encoding: 'utf8',
  });

  return output.split('\0').filter(Boolean).flatMap((entry) => {
    const match = entry.match(/^\d+\s+([0-9a-f]{40,64})\s+\d+\t([\s\S]+)$/i);
    if (!match || !BINARY_SUFFIX.test(match[2])) return [];
    return [{ blob: match[1], path: match[2] }];
  });
}

export function parseReviewed(text) {
  const rows = [];
  let sawHeader = false;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!sawHeader && line === 'blob\tpath\tnote') {
      sawHeader = true;
      continue;
    }
    const [blob = '', path = '', ...noteParts] = rawLine.split('\t');
    rows.push({ blob, path, note: noteParts.join('\t') });
  }

  return rows;
}

export function checkReviewedBinaries(binaries, reviewed) {
  const trackedByPath = new Map(binaries.map((entry) => [entry.path, entry]));
  const reviewedByPath = new Map(reviewed.map((entry) => [entry.path, entry]));

  return {
    unreviewed: binaries.filter((entry) => !reviewedByPath.has(entry.path)),
    changed: binaries.flatMap((entry) => {
      const row = reviewedByPath.get(entry.path);
      return row && row.blob !== entry.blob ? [{ ...entry, reviewedBlob: row.blob }] : [];
    }),
    stale: reviewed.filter((entry) => !trackedByPath.has(entry.path)),
  };
}
