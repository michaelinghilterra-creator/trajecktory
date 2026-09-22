#!/usr/bin/env node
/**
 * gate-local-snapshot.test.mjs — the liveness gate must follow a local snapshot
 * row back to the URL it came from.
 *
 * WHY THIS EXISTS:
 * resolve-jds.mjs repoints a pipeline row from its URL to `local:jds/<file>.md`
 * so the eval agents can read SPA postings that a plain fetch renders blank.
 * gate-pipeline.mjs matched only `http(s)` rows, so once a queue was resolved the
 * gate matched ZERO rows, printed "nothing to gate", and exited 0.
 *
 * Two documented steps in the batch workflow cancelled each other out, and the
 * one that lost is the step AGENTS.md calls the most important: without it you
 * spend evaluation budget on dead postings. It failed SILENTLY and reported
 * success, which is exactly why it survived unnoticed — a gate that finds nothing
 * is indistinguishable from a queue with nothing wrong. It was caught only when
 * 107 pending rows, every one resolved to a snapshot, produced "nothing to gate".
 *
 * The URL is not lost, only moved: resolve-jds.mjs writes a "**Source URL:**"
 * line into each snapshot.
 *
 * Run: node tests/gate-local-snapshot.test.mjs   (exit 0 = pass, 1 = fail)
 */

// Imported from lib/, NOT from gate-pipeline.mjs: that file has no main guard,
// so importing it to reach a helper executes the entire gate as a side effect.
import { sourceUrlFromSnapshot } from '../lib/snapshot-url.mjs';

let passed = 0, failed = 0;
const check = (c, l) => { if (c) passed++; else { failed++; console.error(`  FAIL: ${l}`); } };
const section = (n) => console.log(`\n${n}`);

// No sandbox and no disk access: the reader is injected, so the suite never
// depends on the repo's own jds/ contents and never creates a temp directory.
const readFrom = (files) => (p) => {
  const key = String(p).replace(/\\/g, '/').split('/').pop();
  // Must carry .code: sourceUrlFromSnapshot deliberately swallows only real
  // file-read errors and rethrows anything else, so that a programming mistake
  // cannot masquerade as "no URL found". A codeless Error here would (correctly)
  // propagate rather than become a null.
  if (!(key in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
  return files[key];
};

section('the labelled Source URL is recovered');
{
  const files = {
    'acme.md': '# Acme — Director\n\n**Source URL:** https://boards.greenhouse.io/acme/jobs/12345\n\nBody text.\n',
  };
  check(sourceUrlFromSnapshot('local:jds/acme.md', readFrom(files))
    === 'https://boards.greenhouse.io/acme/jobs/12345', 'labelled URL recovered');
  check(sourceUrlFromSnapshot('jds/acme.md', readFrom(files))
    === 'https://boards.greenhouse.io/acme/jobs/12345', 'the local: prefix is optional');
}

section('the LABELLED url wins over any other url in the body');
{
  // A JD body is full of URLs -- company site, privacy policy, benefits pages.
  // Picking the wrong one would gate a live posting against an unrelated page.
  const files = {
    'b.md': [
      '# Beta',
      '',
      'Visit https://beta.example.com/about for more.',
      'Our privacy policy: https://beta.example.com/privacy',
      '',
      '**Source URL:** https://jobs.lever.co/beta/9f8e7d',
      '',
      'Apply at https://beta.example.com/careers',
    ].join('\n'),
  };
  check(sourceUrlFromSnapshot('local:jds/b.md', readFrom(files))
    === 'https://jobs.lever.co/beta/9f8e7d', 'the labelled line wins over earlier and later URLs');
}

section('fallback to the first bare URL when unlabelled');
{
  const files = { 'c.md': '# Gamma\n\nhttps://jobs.ashbyhq.com/gamma/abc-123\n\nBody.\n' };
  check(sourceUrlFromSnapshot('local:jds/c.md', readFrom(files))
    === 'https://jobs.ashbyhq.com/gamma/abc-123', 'bare URL used when no label present');
}

section('FAILS OPEN — null, never a wrong URL');
{
  const files = { 'd.md': '# Delta\n\nNo links at all in this body.\n' };
  check(sourceUrlFromSnapshot('local:jds/d.md', readFrom(files)) === null, 'no URL anywhere -> null');
  check(sourceUrlFromSnapshot('local:jds/missing.md', readFrom(files)) === null, 'unreadable file -> null');
  check(sourceUrlFromSnapshot('', readFrom(files)) === null, 'empty ref -> null');
}
{
  // A null must leave the row PENDING. Gating it as dead on an unreadable
  // snapshot would discard a possibly-live posting, which is the expensive error.
  const files = { 'e.md': 'no url here' };
  check(sourceUrlFromSnapshot('local:jds/e.md', readFrom(files)) === null,
    'the caller receives null and is expected to leave the row pending');
}

section('trailing punctuation and whitespace do not leak into the URL');
{
  const files = { 'f.md': '**Source URL:**    https://boards.greenhouse.io/f/jobs/77   \n\nmore\n' };
  check(sourceUrlFromSnapshot('local:jds/f.md', readFrom(files))
    === 'https://boards.greenhouse.io/f/jobs/77', 'surrounding whitespace trimmed');
}

section('http is accepted, not just https');
{
  const files = { 'g.md': '**Source URL:** http://legacy.example.com/jobs/1\n' };
  check(sourceUrlFromSnapshot('local:jds/g.md', readFrom(files))
    === 'http://legacy.example.com/jobs/1', 'http scheme recovered');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
