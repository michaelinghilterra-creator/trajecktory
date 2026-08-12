#!/usr/bin/env node
// clean-generated-text.mjs -- Tier-B text hygiene for agent-authored markdown.
//
// The dashboard's draft features run their model output through the hygiene layer
// in-process (dashboard-web/server/lib/text-hygiene.mjs). But evaluation reports
// (reports/*.md) and interview prep (interview-prep/**/*.md) are written by the
// `claude` agent SUBPROCESS -- that text never returns to Node, so it cannot be
// cleaned in-process. This is the post-write pass that closes that gap.
//
// Markdown-aware. It protects, leaving byte-exact:
//   - a leading frontmatter block (YAML, or the v1 report JSON block; both are
//     fenced by `---` lines at the very top of the file),
//   - fenced code blocks (``` or ~~~),
//   - inline `code` and URLs within a prose line (via the core's PROTECT_RE),
//   - thematic-break / table-separator lines (made of |,-,:),
// and it skips `.run.md` sidecars entirely (machine-verified frontmatter + a
// user-authored debrief body). Only unprotected prose lines are folded, via
// cleanMarkdownProse.
//
// Usage: node clean-generated-text.mjs <path|dir> [<path|dir> ...] [--apply]
//   Dry-run by default (prints what WOULD change). --apply writes in place.
//   Idempotent; only files whose content actually changes are rewritten, and the
//   file's existing line-ending style (CRLF vs LF) is preserved.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { cleanMarkdownProse } from './lib/text-hygiene-core.mjs';

const FENCE_RE = /^\s*(```|~~~)/;
const FRONTMATTER_DELIM_RE = /^---\s*$/;
// A thematic break or GFM table-separator row: only pipes, colons, hyphens, space.
const HR_OR_TABLE_SEP_RE = /^\s*[|:\-\s]{3,}$/;

// Clean ONE markdown document string. Pure and testable. Preserves the input's
// line-ending style (CRLF vs LF).
export function cleanMarkdown(text) {
  if (text == null) return text;
  const useCRLF = /\r\n/.test(text);
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  let i = 0;

  // 1) Skip a leading frontmatter block (--- ... ---): covers YAML and the v1
  //    report JSON block. Everything inside stays byte-exact.
  if (lines[0] !== undefined && FRONTMATTER_DELIM_RE.test(lines[0])) {
    out.push(lines[0]); i = 1;
    while (i < lines.length && !FRONTMATTER_DELIM_RE.test(lines[i])) { out.push(lines[i]); i++; }
    if (i < lines.length) { out.push(lines[i]); i++; } // closing ---
  }

  // 2) Walk the body, toggling fenced-code protection on the matching marker.
  let inFence = false, marker = '';
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE_RE);
    if (fence) {
      if (!inFence) { inFence = true; marker = fence[1]; }
      else if (fence[1] === marker) { inFence = false; marker = ''; }
      out.push(line);
    } else if (inFence || HR_OR_TABLE_SEP_RE.test(line)) {
      out.push(line);
    } else {
      out.push(cleanMarkdownProse(line));
    }
  }

  const result = out.join('\n');
  return useCRLF ? result.replace(/\n/g, '\r\n') : result;
}

function walk(target, acc) {
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(target)) walk(path.join(target, name), acc);
  } else if (st.isFile()) {
    acc.push(target);
  }
}

// .run.md sidecars are excluded on purpose (see header). Only .md is processed.
function shouldProcess(file) {
  return file.endsWith('.md') && !file.endsWith('.run.md');
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const targets = args.filter((a) => a !== '--apply');
  if (targets.length === 0) {
    console.error('usage: node clean-generated-text.mjs <path|dir> [...] [--apply]');
    process.exit(2);
  }
  const files = [];
  for (const t of targets) {
    if (!fs.existsSync(t)) { console.error(`skip (not found): ${t}`); continue; }
    walk(t, files);
  }
  let scanned = 0, changed = 0;
  for (const f of files) {
    if (!shouldProcess(f)) continue;
    scanned++;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const cleaned = cleanMarkdown(text);
    if (cleaned !== text) {
      changed++;
      if (apply) {
        try { fs.writeFileSync(f, cleaned); } catch (e) { console.error(`write failed: ${f}: ${e.message}`); }
      }
      console.log(`${apply ? 'cleaned' : 'would clean'}: ${f}`);
    }
  }
  console.log(`\n${scanned} scanned, ${changed} ${apply ? 'cleaned' : 'to clean'}${apply || changed === 0 ? '' : ' (dry-run; pass --apply to write)'}`);
}

// Only run the CLI when executed directly, so importing cleanMarkdown() in a test
// does not trigger main() (which would exit on no args).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
