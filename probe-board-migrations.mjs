import { localToday } from './lib/local-date.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { normalizeCompany } from './lib/identity.mjs';
import {
  atsSlug,
  buildPortalsEntry,
  normalizeToken,
} from './lib/portals.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_ROOT = path.dirname(SCRIPT_FILE);

export const ATS_PROBES = [
  {
    ats: 'greenhouse',
    apiUrl: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    careersUrl: (slug) => `https://job-boards.greenhouse.io/${slug}`,
    countJobs: (json) => Array.isArray(json?.jobs) ? json.jobs.length : 0,
    companyName: () => '',
  },
  {
    ats: 'ashby',
    apiUrl: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    careersUrl: (slug) => `https://jobs.ashbyhq.com/${slug}`,
    countJobs: (json) => Array.isArray(json?.jobs) ? json.jobs.length : 0,
    companyName: (json) => json?.organizationName || json?.companyName || json?.company?.name || '',
  },
  {
    ats: 'lever',
    apiUrl: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    careersUrl: (slug) => `https://jobs.lever.co/${slug}`,
    countJobs: (json) => Array.isArray(json) ? json.length : 0,
    companyName: (json) => json?.companyName || '',
  },
  {
    ats: 'workable',
    apiUrl: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
    careersUrl: (slug) => `https://apply.workable.com/${slug}`,
    countJobs: (json) => Array.isArray(json?.jobs) ? json.jobs.length : 0,
    companyName: (json) => json?.name || json?.companyName || json?.company?.name || '',
  },
];

export function isDead(entry, minZero = 10) {
  return (entry?.lastOutcome === 'http_404' || entry?.lastOutcome === '404')
    || (entry?.lastOutcome === 'zero' && (entry.consecutiveZero || 0) >= minZero);
}

export function candidateSlugs(name) {
  const base = String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[.,]/g, '')
    .replace(/\b(?:inc|llc|ltd|corp|corporation|co|company|gmbh|plc|limited|technologies|labs)\b/g, ' ');
  const words = base.split(/[^a-z0-9]+/).filter(Boolean);
  const joined = words.join('');
  return [...new Set([
    joined,
    words.join('-'),
    words.length === 1 ? words[0] : '',
    `${joined}hq`,
    `${joined}inc`,
  ].filter((candidate) => candidate.length >= 2))];
}

export async function probeCompany(name, currentAts, fetchFn, currentSlug) {
  const matches = [];
  const slugs = [...new Set([currentSlug, ...candidateSlugs(name)].filter(Boolean))];
  for (const slug of slugs) {
    for (const probe of ATS_PROBES) {
      if (probe.ats === currentAts && slug === currentSlug) continue;
      try {
        const res = await fetchFn(probe.apiUrl(slug));
        if (!res?.ok) continue;
        const body = await res.json();
        const jobs = probe.countJobs(body);
        if (jobs > 0) {
          let boardName = probe.companyName(body);
          if (probe.ats === 'greenhouse') {
            try {
              const identity = await fetchFn(`https://boards-api.greenhouse.io/v1/boards/${slug}`);
              if (identity?.ok) boardName = (await identity.json())?.name || '';
            } catch {
              boardName = '';
            }
          }
          matches.push({
            ats: probe.ats,
            slug,
            careersUrl: probe.careersUrl(slug),
            jobs,
            confidence: boardName && normalizeCompany(boardName) === normalizeCompany(name)
              ? 'name-verified'
              : 'slug-only',
          });
        }
      } catch {
        // A failed probe is not a migration match.
      }
    }
  }
  return matches.sort((a, b) => {
    const confidence = Number(b.confidence === 'name-verified') - Number(a.confidence === 'name-verified');
    return confidence || b.jobs - a.jobs;
  });
}

export function slugFromApiUrl(url) {
  const match = String(url ?? '').match(/\/(?:boards|job-board|postings|accounts)\/([^/?]+)/);
  return match ? match[1] : null;
}

function entrySlugs(entry) {
  return [entry?.careers_url, entry?.api]
    .map(atsSlug)
    .filter(Boolean)
    .map(normalizeToken);
}

function entryAts(entry) {
  const urls = [entry?.careers_url, entry?.api].filter(Boolean).join(' ');
  if (/greenhouse\.io\//i.test(urls)) return 'greenhouse';
  if (/ashbyhq\.com\//i.test(urls)) return 'ashby';
  if (/lever\.co\//i.test(urls)) return 'lever';
  if (/workable\.com\//i.test(urls)) return 'workable';
  return '';
}

function sameSourceEntry(candidate, source) {
  return normalizeCompany(candidate?.name) === normalizeCompany(source?.name)
    && entryAts(candidate) === entryAts(source)
    && ['careers_url', 'api'].some((field) => source?.[field] && candidate?.[field] === source[field]);
}

function appendEntry(portalsRaw, result, match, today) {
  const note = `Migrated from ${result.oldAts}:${slugFromApiUrl(result.oldApiUrl) || 'unknown'} on ${today}.`;
  let yamlBlock;
  if (['greenhouse', 'ashby', 'lever'].includes(match.ats)) {
    yamlBlock = buildPortalsEntry(
      { type: match.ats, slug: match.slug },
      { today, note, companyHint: result.name },
    ).yaml;
  } else {
    const safeName = String(result.name).replace(/[\r\n:]+/g, ' ').trim();
    yamlBlock = `\n  - name: ${safeName}\n    careers_url: ${match.careersUrl}\n    notes: "${note}"\n    enabled: true`;
  }
  const eol = portalsRaw.includes('\r\n') ? '\r\n' : '\n';
  return portalsRaw.trimEnd() + eol + yamlBlock.split('\n').join(eol) + eol;
}

export function migratePortalsText(portalsRaw, result, { allowSlugOnly = false, today = '' } = {}) {
  if (result.matches.length !== 1) {
    return { ok: false, reason: result.matches.length ? `${result.matches.length} matches are ambiguous` : 'no match found' };
  }
  const match = result.matches[0];
  if (match.confidence !== 'name-verified' && !allowSlugOnly) {
    return { ok: false, reason: 'match is slug-only; pass --allow-slug-only to approve it' };
  }

  const config = yaml.load(portalsRaw) || {};
  const companies = config.tracked_companies || [];
  const oldEntry = companies.find((entry) => entryAts(entry) === result.oldAts
    && normalizeCompany(entry.name) === normalizeCompany(result.name));
  if (!oldEntry) return { ok: false, reason: 'old company entry is not tracked' };

  const normalizedNewSlug = normalizeToken(match.slug);
  const newHit = companies.find((entry) => entry !== oldEntry
    && entryAts(entry) === match.ats
    && (
      entrySlugs(entry).includes(normalizedNewSlug)
      || (entry.enabled !== false && normalizeCompany(entry.name) === normalizeCompany(result.name))
    ));
  if (newHit) {
    return { ok: false, reason: `new slug ${match.slug} is already tracked` };
  }

  const eol = portalsRaw.includes('\r\n') ? '\r\n' : '\n';
  const lines = portalsRaw.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const found = lines[i].match(/^ {2}- name:\s*(.+?)\s*$/);
    if (found) starts.push({ line: i, name: found[1].replace(/^['"]|['"]$/g, '') });
  }
  const oldStartIndex = starts.findIndex((item, index) => {
    if (normalizeCompany(item.name) !== normalizeCompany(result.name)) return false;
    const end = starts[index + 1]?.line ?? lines.length;
    try {
      const parsed = yaml.load(`tracked_companies:${eol}${lines.slice(item.line, end).join(eol)}`);
      return sameSourceEntry(parsed?.tracked_companies?.[0], oldEntry);
    } catch {
      return false;
    }
  });
  if (oldStartIndex === -1) return { ok: false, reason: 'old company text block could not be located' };
  const start = starts[oldStartIndex].line;
  const end = starts[oldStartIndex + 1]?.line ?? lines.length;
  const block = lines.slice(start, end);
  const movedNote = `Moved to ${match.ats}:${match.slug}.`;

  const enabledAt = block.findIndex((line) => /^\s+enabled:/.test(line));
  if (enabledAt === -1) block.push('    enabled: false');
  else block[enabledAt] = block[enabledAt].replace(/^(\s*enabled:)\s*[^#]*(#.*)?$/, '$1 false$2');

  const notesAt = block.findIndex((line) => /^\s+notes:/.test(line));
  const existingNote = String(oldEntry.notes || '').trim();
  const safeNote = `${existingNote ? `${existingNote} ` : ''}${movedNote}`.replace(/"/g, "'");
  const noteLine = `    notes: "${safeNote}"`;
  if (notesAt === -1) block.splice(enabledAt === -1 ? block.length - 1 : enabledAt, 0, noteLine);
  else block[notesAt] = noteLine;

  lines.splice(start, end - start, ...block);
  const tombstoned = lines.join(eol);
  return { ok: true, text: appendEntry(tombstoned, result, match, today), match };
}

export async function main(argv, { fetchFn = fetch, root = SCRIPT_ROOT } = {}) {
  let minZero = 10;
  let jsonOutput = false;
  let noDelay = false;
  let apply = false;
  let allowSlugOnly = false;
  const only = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--min-zero') minZero = Number(argv[++i]);
    else if (argv[i] === '--json') jsonOutput = true;
    else if (argv[i] === '--no-delay') noDelay = true;
    else if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--allow-slug-only') allowSlugOnly = true;
    else if (argv[i] === '--only') only.push(String(argv[++i] || '').trim());
  }

  const coverage = JSON.parse(fs.readFileSync(path.join(root, 'data/scan-coverage.json'), 'utf8'));
  const onlyKeys = new Set(only.map(normalizeCompany));
  const deadBoards = Object.entries(coverage).filter(([, entry]) =>
    isDead(entry, minZero) && (!onlyKeys.size || onlyKeys.has(normalizeCompany(entry.name))));
  const results = [];

  for (let i = 0; i < deadBoards.length; i++) {
    const [oldApiUrl, entry] = deadBoards[i];
    const matches = await probeCompany(
      entry.name,
      entry.ats,
      fetchFn,
      slugFromApiUrl(oldApiUrl),
    );
    const result = { name: entry.name, oldApiUrl, oldAts: entry.ats, matches };
    results.push(result);

    if (!jsonOutput) {
      const best = matches[0];
      const summary = best
        ? `${best.ats}:${best.slug} (${best.jobs} jobs, ${best.confidence}) ${best.careersUrl}`
        : 'no live board found';
      console.log(`DEAD ${entry.name} [${entry.ats}] -> ${summary}`);
    }

    if (!noDelay && i < deadBoards.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (apply && only.length) {
    const portalsPath = path.join(root, 'portals.yml');
    const original = fs.readFileSync(portalsPath, 'utf8');
    let staged = original;
    let changed = 0;
    const today = localToday();
    for (const requested of only) {
      const result = results.find((item) => normalizeCompany(item.name) === normalizeCompany(requested));
      if (!result) {
        console.log(`REFUSE ${requested}: no dead board with that company name`);
        continue;
      }
      const migration = migratePortalsText(staged, result, { allowSlugOnly, today });
      if (!migration.ok) {
        console.log(`REFUSE ${requested}: ${migration.reason}`);
        continue;
      }
      staged = migration.text;
      changed += 1;
      console.log(`APPLY ${requested}: ${migration.match.ats}:${migration.match.slug}`);
    }
    if (changed) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(`${portalsPath}.bak-probe-${stamp}`, original, 'utf8');
      fs.writeFileSync(portalsPath, staged, 'utf8');
    }
  } else if (apply && !only.length && !jsonOutput) {
    console.log('No changes: --apply requires at least one --only company.');
  }

  if (jsonOutput) console.log(JSON.stringify(results));
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_FILE)) {
  await main(process.argv.slice(2));
}
