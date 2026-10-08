#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { parseRunsheet } from '../render-runsheet.mjs';
import {
  buildPrepDocx,
  defaultOutPath,
  documentXml,
  formatWhen,
  inlineRuns,
} from '../generate-prep-docx.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'templates/runsheet-example.run.md');
const { data } = parseRunsheet(fs.readFileSync(fixture, 'utf8'));
const tempRoot = path.join(root, '.test-sandboxes');
fs.mkdirSync(tempRoot, { recursive: true });
process.env.TMP = tempRoot;
process.env.TEMP = tempRoot;

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  OK ${label}`); }
  else { failed++; console.log(`  FAIL ${label}`); }
};

console.log('generate-prep-docx.test.mjs');

const sections = data.sections || [];
const cues = sections.flatMap(s => s.cues || []);
const distinctAnswerKeys = new Set(cues.map(c => c.answer));
const distinctAnswers = [...distinctAnswerKeys].map(k => data.answers[k]).filter(Boolean);
const guardrails = data.guardrails || [];
const notes = distinctAnswers.reduce((n, a) => n + (a.notes || []).length, 0);

check(defaultOutPath('a/x-round-2-hm.run.md') === 'a/x-round-2-hm.docx', 'run sheet suffix becomes docx');
check(defaultOutPath('x.md') === 'x.md.docx', 'plain path appends docx suffix');

const boldRuns = inlineRuns('a **b** c');
check((boldRuns.match(/<w:b\/>/g) || []).length === 1 && !boldRuns.includes('**'), 'inline bold emits one bold run');
check(inlineRuns('R&D <x> "q"').includes('R&amp;D &lt;x&gt; &quot;q&quot;'), 'inline text is escaped');

check(formatWhen('2030-01-16T10:30:00-06:00') === '2030-01-16 10:30 (UTC-06:00)', 'formatWhen preserves offset');
check(formatWhen('soon') === 'soon', 'formatWhen returns unmatched text');

const xml = documentXml(data);
check(data.company === 'Northwind Logistics', 'fixture company matches expectation');
check(data.stage === '1st Interview', 'fixture stage matches expectation');
check(data.round === 2, 'fixture round matches expectation');
check(sections.length === 6, 'fixture has 6 sections');
check(cues.length === 14, 'fixture has 14 cues');
check(distinctAnswerKeys.size === 11, 'fixture has 11 distinct answer keys');
check(guardrails.length === 3, 'fixture has 3 guardrails');
check(notes === 20, 'fixture has 20 distinct answer notes');
check(xml.includes('Northwind Logistics Interview Prep: Round 2, 1st Interview'), 'document has title');
check(!xml.includes('**'), 'document has no markdown bold markers');
check((xml.match(/<w:pStyle w:val="Heading2"\/>/g) || []).length === cues.length, 'heading 2 count equals cues');
check((xml.match(/<w:pStyle w:val="Heading1"\/>/g) || []).length === sections.length + 1, 'heading 1 count includes guardrails');
check((xml.match(/Same answer as/g) || []).length === cues.length - distinctAnswerKeys.size, 'repeat answers point upward');
check((xml.match(/<w:pBdr>/g) || []).length === guardrails.length + notes, 'note border count matches guardrails plus notes');
check((xml.match(/<w:p>/g) || []).length === (xml.match(/<\/w:p>/g) || []).length, 'paragraph tags are balanced');
check((xml.match(/<w:r>/g) || []).length === (xml.match(/<\/w:r>/g) || []).length, 'run tags are balanced');

const buf = buildPrepDocx(data);
const zip = new AdmZip(buf);
const names = zip.getEntries().map(e => e.entryName).sort();
const expectedNames = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/_rels/document.xml.rels',
  'word/document.xml',
  'word/styles.xml',
].sort();
check(Buffer.isBuffer(buf) && buf.subarray(0, 2).toString('utf8') === 'PK', 'buildPrepDocx returns zip buffer');
check(JSON.stringify(names) === JSON.stringify(expectedNames), 'zip has exactly the expected entries');
check(zip.readAsText('word/document.xml') === xml, 'zip document xml matches documentXml');

const missingXml = documentXml({
  company: 'C',
  role: 'R',
  stage: 'S',
  round: 1,
  sections: [{ id: 's', title: 'T', cues: [{ cue: 'Q', answer: 'nope' }] }],
  answers: {},
});
check(missingXml.includes('Missing answer: nope'), 'missing answer key is rendered');

const noArg = spawnSync(process.execPath, ['generate-prep-docx.mjs'], { cwd: root });
check(noArg.status === 1, 'CLI exits 1 without source');
const temp = path.join(os.tmpdir(), `generate-prep-docx-${process.pid}.docx`);
try { fs.unlinkSync(temp); } catch {}
const cli = spawnSync(process.execPath, ['generate-prep-docx.mjs', fixture, '-o', temp], { cwd: root });
const written = fs.existsSync(temp) ? fs.readFileSync(temp) : Buffer.alloc(0);
check(cli.status === 0 && written.subarray(0, 2).toString('utf8') === 'PK', 'CLI writes docx');
try { fs.unlinkSync(temp); } catch {}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
