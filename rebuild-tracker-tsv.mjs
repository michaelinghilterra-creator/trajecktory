import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseV1 } from './dashboard-web/server/v1-loader.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const ROOT = path.dirname(SCRIPT_FILE);

export function sanitizeCell(value) {
  return String(value ?? '')
    .replace(/[\t\r\n]/g, ' ')
    .replace(/\|/g, '/')
    .replace(/ +/g, ' ')
    .trim();
}

export function tsvFromReport(md, reportFileName) {
  if (!md.startsWith('---')) {
    return { ok: false, reason: 'not a v1 report' };
  }

  let data;
  try {
    ({ data } = parseV1(md));
  } catch {
    return { ok: false, reason: 'unparseable frontmatter' };
  }

  if (!Number.isInteger(data.id)) return { ok: false, reason: 'missing id' };
  if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    return { ok: false, reason: 'missing date' };
  }
  if (typeof data.company !== 'string' || !data.company.trim()) {
    return { ok: false, reason: 'missing company' };
  }
  if (typeof data.role !== 'string' || !data.role.trim()) {
    return { ok: false, reason: 'missing role' };
  }
  if (typeof data.score !== 'number' || !Number.isFinite(data.score)) {
    return { ok: false, reason: 'missing score' };
  }

  const num = data.id;
  const slug = data.company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const fileName = `${num}-${slug}.tsv`;
  const recommendation = sanitizeCell(data.recommendation);
  const note = (`[reinstated]${recommendation ? ` ${recommendation}` : ''}`).slice(0, 200);
  const line = [
    num,
    data.date,
    sanitizeCell(data.company),
    sanitizeCell(data.role),
    'Evaluated',
    `${data.score.toFixed(1)}/5`,
    '❌',
    `[${num}](reports/${reportFileName})`,
    note,
  ].join('\t');

  return { ok: true, num, line, fileName };
}

export function main(argv) {
  let write = false;
  let outDir = path.join(ROOT, 'batch/tracker-additions');
  const reportPaths = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') {
      write = true;
    } else if (argv[i] === '--out') {
      outDir = path.resolve(argv[++i]);
    } else {
      reportPaths.push(argv[i]);
    }
  }

  let okCount = 0;
  for (const reportPath of reportPaths) {
    const file = path.resolve(process.cwd(), reportPath);
    const result = tsvFromReport(fs.readFileSync(file, 'utf8'), path.basename(file));
    if (!result.ok) {
      console.log(`SKIP ${path.basename(file)}: ${result.reason}`);
      continue;
    }

    okCount += 1;
    if (write) {
      fs.mkdirSync(outDir, { recursive: true });
      const destination = path.join(outDir, result.fileName);
      if (fs.existsSync(destination)) {
        console.log(`EXISTS ${result.fileName}`);
        continue;
      }
      fs.writeFileSync(destination, `${result.line}\n`, 'utf8');
    }
    console.log(`OK ${result.num} ${result.fileName}`);
  }

  if (!write) console.log('dry run: pass --write to create the files');
  return okCount;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_FILE)) {
  main(process.argv.slice(2));
}
