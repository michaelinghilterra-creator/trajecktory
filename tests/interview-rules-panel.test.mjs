#!/usr/bin/env node
/**
 * interview-rules-panel.test.mjs — the in-app Live board must show the red
 * "Use once / do not get wrong" panel, the same as the standalone board.
 *
 * It did not: Board computed `rulesPanel` and then never rendered it (a one-line
 * removal in an unrelated PR), so the authored guardrails and the derived
 * collision warnings only existed in the standalone HTML. The in-app board kept
 * just the " · use once" tag on an answer box, and comments claimed more.
 *
 * This renders the real Board (server-side, no DOM) from invented fixtures and
 * checks it against render-runsheet.mjs's output for the same sheet.
 *
 * Run: node tests/interview-rules-panel.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { derive, render } from '../render-runsheet.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'dashboard-web', 'package.json'));
const { transformSync } = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
};

console.log('interview-rules-panel.test.mjs');

// interview.jsx is a browser script, not a module: Board is a top-level function
// that is never exported. Transform it with the same JSX settings as build.mjs and
// hand it a stub window, then read Board back out of the same scope.
const src = fs.readFileSync(path.join(root, 'dashboard-web/src/interview.jsx'), 'utf8');
const { code } = transformSync(src, {
  loader: 'jsx', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', target: 'es2019',
});
const Board = new Function('React', 'window', `${code}\nreturn Board;`)(React, {});

const answer = (title, story, extra = {}) =>
  ({ title, story, spoken: ['Example spoken line.'], notes: [], ...extra });

const sheet = (extra = {}) => ({
  company: 'Zorblax Widgetry',
  role: 'Example Widget Lead',
  session: { who: 'Example Personone' },
  sections: [
    { id: 'a', n: 1, title: 'Openers', cues: [
      { cue: 'Tell me about yourself', answer: 'intro' },
      { cue: 'A hard problem', answer: 'hard' },
    ] },
    { id: 'b', n: 2, title: 'Behavioral', cues: [
      { cue: 'Conflict with a peer', answer: 'conflict' },
      { cue: 'A time you led', answer: 'led' },
    ] },
  ],
  answers: {
    intro: answer('Intro', 1),
    hard: answer('Hard problem', 2),
    conflict: answer('Conflict', 2),
    led: answer('Led', 3),
  },
  ...extra,
});

const board = (d) => renderToStaticMarkup(
  React.createElement(Board, { data: d, derived: { ...derive(d), collidingKeys: [...derive(d).collidingKeys] }, cam: { boxTopVh: 34, camGapPx: 80 }, present: false, measureOnly: true }),
);
const rulesBlock = (html) => (html.match(/<section class="panel rules">[\s\S]*?<\/section>/) || [''])[0];

// Both: a derived collision (story #2 reachable twice) AND authored guardrails.
const both = sheet({ guardrails: ['Q3 only. Never quote Q4 numbers.', 'No comp talk with the panel.'] });
const html = board(both);
const rules = rulesBlock(html);
const stand = render(both, derive(both));
const standRules = rulesBlock(stand);

check(rules.includes('Use once / do not get wrong'), 'the in-app board renders the rules panel heading');
check(rules.includes('Q3 only. Never quote Q4 numbers.') && rules.includes('No comp talk with the panel.'),
  'every authored guardrail is on the in-app board');
check(/class="norow derived">Story #2 is reachable from 2 cues/.test(rules),
  'the derived collision warning is on the in-app board, marked derived');
check(rules.indexOf('norow derived') < rules.indexOf('norow">'),
  'derived warnings come before the authored guardrails');
check(standRules !== '' && standRules.includes('Use once / do not get wrong'), 'the standalone board still renders it (control)');
const rows = (s) => [...s.matchAll(/<div class="norow( derived)?">([^<]*)<\/div>/g)].map(m => `${m[1] ? 'D:' : ''}${m[2]}`);
check(JSON.stringify(rows(rules)) === JSON.stringify(rows(standRules)) && rows(rules).length === 3,
  'in-app and standalone boards list the same rows in the same order');

// It lives at the end of the right column, after the last section, as in the standalone board.
const colsTail = html.slice(html.lastIndexOf('<section class="panel'));
check(colsTail.startsWith('<section class="panel rules">'), 'the panel is the last section in the right column');

// Guardrails alone (no collision) still render.
const only = board(sheet({ answers: { ...sheet().answers, conflict: answer('Conflict', 4) }, guardrails: ['No comp talk.'] }));
check(rulesBlock(only).includes('No comp talk.') && !rulesBlock(only).includes('derived'), 'authored guardrails render without any derived warning');

// Warnings alone (no guardrails) still render.
check(rulesBlock(board(sheet())).includes('norow derived'), 'a derived warning renders without any authored guardrail');

// Nothing to say: no empty red box.
const clean = board(sheet({ answers: { ...sheet().answers, conflict: answer('Conflict', 4) } }));
check(rulesBlock(clean) === '', 'a clean sheet renders no rules panel at all');

// Authored text is never markup.
const evil = rulesBlock(board(sheet({ guardrails: ['<img src=x onerror=alert(1)>'] })));
check(!evil.includes('<img') && evil.includes('&lt;img'), 'guardrail text is escaped, never injected as markup');

console.log(`interview-rules-panel: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
