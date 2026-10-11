#!/usr/bin/env node

import { looseRoleKey, findRelatedRoles, qualifierKey } from '../lib/prior-roles.mjs';

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
  const same = findRelatedRoles(rows, rows[0]);
  check(same.length === 1 && same[0].kind === 'same-posting', 'same canonical URL is flagged as the same posting');
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

{
  const rows = [
    row(900701, 'Zorblax Widgetry', 'Widget Strategy Manager (Alpha Team)', 3.0, 'Evaluated', 'https://jobs.example.test/globex/q1'),
    row(900702, 'Zorblax Widgetry', 'Manager, Widget Strategy - Beta Monetization', 3.2, 'Evaluated', 'https://jobs.example.test/globex/q2'),
    row(900703, 'Zorblax Widgetry', 'Widget Strategy Manager', 3.4, 'Evaluated', 'https://jobs.example.test/globex/q3'),
  ];
  check(findRelatedRoles(rows, rows[0]).every(r => r.num !== 900702), 'two different qualifiers are different jobs');
  check(findRelatedRoles(rows, rows[0]).some(r => r.num === 900703), 'a qualifier on only one side still relates');
  check(qualifierKey('Widget Analyst - Mobile') === 'mobile' && qualifierKey('Widget Analyst') === '', 'qualifierKey reads dash and absent qualifiers');
}

{
  const rows = [
    row(900801, 'Zorblax Widgetry', 'Lead Widget Analyst', 3.0, 'Evaluated', 'https://jobs.example.test/globex/x'),
    row(900802, 'Zorblax Widgetry Corporation', 'Lead Widget Analyst', 3.5, 'Evaluated', 'https://jobs.example.test/globex/x'),
  ];
  const rel = findRelatedRoles(rows, rows[0]);
  check(rel.length === 1 && rel[0].kind === 'same-posting', 'company spelling variants with the same posting are flagged');
}

{
  const rows = [
    row(900811, 'Zorblax Widgetry', 'Lead Widget Analyst', 3.0, 'Evaluated', ''),
    row(900812, 'Zorblax Widgetry', 'Lead Widget Analyst', 3.5, 'Evaluated', 'https://jobs.example.test/globex/y'),
  ];
  const rel = findRelatedRoles(rows, rows[1]);
  check(rel.length === 1 && rel[0].kind === 'repost', 'a row with no URL still relates by company and title');
}

{
  const rows = [
    row(900821, 'Ab', 'Lead Widget Analyst', 3.0, 'Evaluated', 'https://jobs.example.test/a/1'),
    row(900822, 'Abc', 'Lead Widget Analyst', 3.5, 'Evaluated', 'https://jobs.example.test/a/2'),
  ];
  check(findRelatedRoles(rows, rows[0]).length === 0, 'very short company names do not prefix match');
}

{
  const rows = [
    row(900831, 'Zorblax Widgetry', 'Lead Widget Analyst', 3.0, 'Evaluated', 'https://jobs.example.test/globex/z'),
    row(900832, 'Zorblax Widgetry', 'Director of Facilities', 3.5, 'Evaluated', 'https://jobs.example.test/globex/z'),
  ];
  check(findRelatedRoles(rows, rows[0]).length === 0, 'same URL with different titles is a wrong link, not a repeat');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
