#!/usr/bin/env node

import { looseRoleKey, findRelatedRoles } from '../lib/prior-roles.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok ${msg}`); passed++; }
  else { console.log(`  fail ${msg}`); failed++; }
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function sameKey(a, b) {
  return sameSet(a.core, b.core) && sameSet(a.levels, b.levels);
}

function row(num, company, role, score, status, url) {
  return { num, date: `2030-01-${String(num).slice(-2).padStart(2, '0')}`, company, role, score, status, url, report: `reports/${num}.md` };
}

console.log('prior-roles.test.mjs');

{
  const a = looseRoleKey('Senior Manager of Widget Analytics - Mobile');
  const b = looseRoleKey('Sr. Manager of Widget Analytics');
  check(sameKey(a, b), 'loose role key folds senior abbreviation and qualifier');
}

{
  const rows = [
    row(900001, 'Zorblax Widgetry', 'Senior Manager of Widget Analytics', 3.2, 'Evaluated', 'https://jobs.example.test/globex/old'),
    row(900002, 'Zorblax Widgetry', 'Senior Manager of Widget Analytics', 4.1, 'Evaluated', 'https://jobs.example.test/globex/new'),
  ];
  const fromOld = findRelatedRoles(rows, rows[0]);
  const fromNew = findRelatedRoles(rows, rows[1]);
  check(fromOld.length === 1 && fromOld[0].num === 900002 && fromOld[0].direction === 'later', 'same company and title with a new URL relates from older row');
  check(fromNew.length === 1 && fromNew[0].num === 900001 && fromNew[0].direction === 'earlier', 'same company and title with a new URL relates from newer row');
  check(fromOld[0].scoreDelta === 0.9 && fromNew[0].scoreDelta === 0.9, 'positive score delta is stable on both rows');
}

{
  const rows = [
    row(900101, 'Quennox Ratchet Works', 'Director of Widget Analytics', 4.0, 'Evaluated', 'https://jobs.example.test/initech/director'),
    row(900102, 'Quennox Ratchet Works', 'Senior Manager of Widget Analytics', 4.1, 'Evaluated', 'https://jobs.example.test/initech/manager'),
  ];
  check(findRelatedRoles(rows, rows[0]).length === 0, 'different explicit levels are not related');
}

{
  const rows = [
    row(900201, 'Zorblax Widgetry', 'Lead Widget Analyst', 3.2, 'Evaluated', 'https://jobs.example.test/contoso/one?utm_source=x'),
    row(900202, 'Zorblax Widgetry', 'Lead Widget Analyst', 3.8, 'Applied', 'https://jobs.example.test/contoso/one'),
  ];
  check(findRelatedRoles(rows, rows[0]).length === 0, 'same canonical URL is not a repeat posting');
}

{
  const rows = [
    row(900301, 'Zorblax Widgetry', 'Staff Widget Engineer', 4.0, 'Evaluated', 'https://jobs.example.test/globex/staff'),
    row(900302, 'Quennox Ratchet Works', 'Staff Widget Engineer', 4.2, 'Evaluated', 'https://jobs.example.test/initech/staff'),
  ];
  check(findRelatedRoles(rows, rows[0]).length === 0, 'different company with the same title is not related');
}

{
  const rows = [
    row(900401, 'Zorblax Widgetry', 'Principal Widget Engineer', null, 'Evaluated', 'https://jobs.example.test/contoso/p1'),
    row(900402, 'Zorblax Widgetry', 'Principal Widget Engineer', 4.2, 'Applied', 'https://jobs.example.test/contoso/p2'),
  ];
  const related = findRelatedRoles(rows, rows[0]);
  check(related.length === 1 && related[0].scoreDelta === null, 'missing score gives null delta without throwing');
}

{
  const rows = [
    row(900501, 'Zorblax Widgetry', 'Senior Widget Analytics Platform Manager', 3.0, 'Evaluated', 'https://jobs.example.test/globex/a'),
    row(900502, 'Zorblax Widgetry', 'Senior Widget Analytics Platform Manager Data', 3.4, 'Evaluated', 'https://jobs.example.test/globex/b'),
    row(900503, 'Zorblax Widgetry', 'Senior Widget Analytics', 3.6, 'Evaluated', 'https://jobs.example.test/globex/c'),
  ];
  check(findRelatedRoles(rows.slice(0, 2), rows[0]).length === 1, 'three token subset core matches');
  check(findRelatedRoles([rows[1], rows[2]], rows[2]).length === 0, 'two token subset core does not match');
}

{
  const rows = [
    row(900601, 'Quennox Ratchet Works', 'Lead Widget Analyst', 3.3, 'Evaluated', 'https://jobs.example.test/initech/a'),
    row(900602, 'Quennox Ratchet Works', 'Lead Widget Analyst', 4.4, 'Evaluated', 'https://jobs.example.test/initech/b'),
  ];
  const related = findRelatedRoles(rows, rows[0]);
  check(related[0].scoreDelta === 1.1, 'score delta rounds to one decimal');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
