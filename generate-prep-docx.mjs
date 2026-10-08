#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { parseRunsheet } from './render-runsheet.mjs';

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="1F4E79"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="1F4E79"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="262626"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style></w:styles>`;

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function inlineRuns(text, { italic = false, color } = {}) {
  const parts = String(text).split(/\*\*(.+?)\*\*/);
  return parts.map((part, i) => {
    if (!part) return '';
    const bold = i % 2 === 1;
    const props = [
      bold ? '<w:b/>' : '',
      italic ? '<w:i/>' : '',
      color ? `<w:color w:val="${color}"/>` : '',
    ].filter(Boolean).join('');
    const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
    return `<w:r>${rPr}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>`;
  }).join('');
}

export function defaultOutPath(src) {
  return src.endsWith('.run.md') ? src.replace(/\.run\.md$/, '.docx') : `${src}.docx`;
}

export function formatWhen(when) {
  const m = String(when).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return String(when);
  const zone = m[3] === 'Z' ? ' (UTC)' : (m[3] ? ` (UTC${m[3]})` : '');
  return `${m[1]} ${m[2]}${zone}`;
}

function para(kind, text, opts = {}) {
  const pPr = {
    title: '<w:pPr><w:pStyle w:val="Title"/></w:pPr>',
    h1: '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>',
    h2: '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>',
    body: '',
    answer: '<w:pPr><w:spacing w:after="160"/><w:ind w:left="360"/></w:pPr>',
    note: '<w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="1F4E79"/></w:pBdr><w:spacing w:before="60" w:after="200"/><w:ind w:left="360"/></w:pPr>',
  }[kind] || '';
  const runOpts = kind === 'note' ? { italic: true } : opts;
  return `<w:p>${pPr}${inlineRuns(text, runOpts)}</w:p>`;
}

export function documentXml(data) {
  const paragraphs = [];
  paragraphs.push(para('title', `${data.company} Interview Prep: Round ${data.round}, ${data.stage}`));
  paragraphs.push(para('body', data.role, { italic: true }));

  const session = data.session || null;
  if (session) {
    if (session.who) paragraphs.push(para('body', `**Who:** ${session.who}`));
    if (session.when) paragraphs.push(para('body', `**When:** ${formatWhen(session.when)}`));
    if (session.minutes) paragraphs.push(para('body', `**Length:** ${session.minutes} minutes`));
    if (session.format) paragraphs.push(para('body', `**Format:** ${session.format}`));
    if (session.rule) paragraphs.push(para('body', `**Rule:** ${session.rule}`));
  }

  if (Array.isArray(data.guardrails) && data.guardrails.length) {
    paragraphs.push(para('h1', 'Guardrails'));
    for (const guardrail of data.guardrails) paragraphs.push(para('note', guardrail));
  }

  const seen = new Map();
  const answers = data.answers || {};
  for (const section of data.sections || []) {
    paragraphs.push(para('h1', section.title));
    for (const cue of section.cues || []) {
      paragraphs.push(para('h2', cue.cue));
      const a = answers[cue.answer];
      if (!a) {
        paragraphs.push(para('answer', `Missing answer: ${cue.answer}`, { italic: true }));
        continue;
      }
      if (seen.has(cue.answer)) {
        paragraphs.push(para('answer', `Same answer as "${seen.get(cue.answer)}" above.`, { italic: true }));
        continue;
      }
      seen.set(cue.answer, cue.cue);
      const meta = [
        a.hero ? 'Hero story, tell it once' : null,
        a.tag || null,
        a.seconds ? `about ${a.seconds} sec` : null,
      ].filter(Boolean);
      if (meta.length) paragraphs.push(para('answer', meta.join(' · '), { italic: true, color: '595959' }));
      for (const spoken of a.spoken || []) paragraphs.push(para('answer', spoken));
      for (const note of a.notes || []) paragraphs.push(para('note', note));
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

export function buildPrepDocx(data) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES_XML, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(ROOT_RELS_XML, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml(data), 'utf8'));
  zip.addFile('word/styles.xml', Buffer.from(STYLES_XML, 'utf8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(DOCUMENT_RELS_XML, 'utf8'));
  return zip.toBuffer();
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const args = process.argv.slice(2);
  const oIdx = args.indexOf('-o');
  const flagValues = new Set([oIdx].filter(i => i >= 0).map(i => i + 1));
  const src = args.find((a, i) => !a.startsWith('-') && !flagValues.has(i));
  if (!src) {
    console.error('usage: node generate-prep-docx.mjs <file.run.md> [-o out.docx]');
    process.exit(1);
  }
  const out = oIdx >= 0 ? args[oIdx + 1] : defaultOutPath(src);

  try {
    const { data } = parseRunsheet(fs.readFileSync(src, 'utf8'));
    fs.writeFileSync(out, buildPrepDocx(data));
    console.log(`-> ${out}`);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
