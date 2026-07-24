import express from 'express';
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { reportMdToHtml, escapeHtml, v1ToFallbackHtml } from '../lib/html.mjs';
import { hasV1Frontmatter, parseV1, stripFrontmatter } from '../v1-loader.mjs';

export const router = express.Router();

// PATH SAFETY. The path is not taken from the request, it is read out of
// applications.md — but that file is AGENT-written, so it is not trusted input
// either. `/api/jd/:id` already states this rule and enforces it; these two
// routes resolved the path and read it with no containment check at all, so a
// tracker row pointing at ..\..\somewhere would be served straight back. One
// poisoned row is a file-read primitive for anything the server can open.
//
// reports/ is the only directory an evaluation report may live in. Resolve, then
// require the result to sit inside it, and compare with a trailing separator so
// a sibling like `reports-backup` cannot pass a bare prefix test.
const REPORTS_ROOT = path.resolve(ROOT_DIR, 'reports');
function resolveReportPath(rel) {
  const abs = path.resolve(ROOT_DIR, String(rel || ''));
  return abs === REPORTS_ROOT || abs.startsWith(REPORTS_ROOT + path.sep) ? abs : null;
}

router.get('/api/report-body/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseApplicationsMd();
    const row = rows.find(r => r.id === id);
    if (!row || !row.report) return res.json({ html: '<p>No report attached.</p>' });
    const reportPath = resolveReportPath(row.report);
    if (!reportPath) return res.json({ html: `<p>Report path is outside reports/ and was refused: ${escapeHtml(row.report)}</p>` });
    if (!fs.existsSync(reportPath)) return res.json({ html: `<p>Report file not found: ${escapeHtml(row.report)}</p>` });
    const raw = fs.readFileSync(reportPath, 'utf8');
    // For v1 reports, strip JSON frontmatter so the Full Report tab shows
    // only the narrative body (not the raw JSON dump).
    const body = stripFrontmatter(raw);
    if (body.trim()) {
      res.json({ html: reportMdToHtml(body) });
    } else if (hasV1Frontmatter(raw)) {
      // No narrative body — synthesize a readable summary from the structured JSON data.
      const { data } = parseV1(raw);
      res.json({ html: v1ToFallbackHtml(data) });
    } else {
      res.json({ html: '<p>Report has no content.</p>' });
    }
  } catch (err) {
    res.json({ html: `<p>Error: ${escapeHtml(err.message)}</p>` });
  }
});

// GET /api/report-view/:id — render evaluation report .md as styled HTML
router.get('/api/report-view/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = parseApplicationsMd();
    const row = rows.find(r => r.id === id);
    if (!row || !row.report) return res.status(404).send('<p style="font-family:sans-serif;padding:24px">No report for this entry.</p>');
    const reportPath = resolveReportPath(row.report);
    if (!reportPath) return res.status(400).send(`<p style="font-family:sans-serif;padding:24px">Report path is outside reports/ and was refused: ${escapeHtml(row.report)}</p>`);
    if (!fs.existsSync(reportPath)) return res.status(404).send(`<p style="font-family:sans-serif;padding:24px">Report file not found: ${escapeHtml(row.report)}</p>`);
    const raw = fs.readFileSync(reportPath, 'utf8');
    const body = reportMdToHtml(raw);
    // Defense-in-depth against any XSS that slips past the report sanitizer: this
    // standalone report document runs no scripts, so lock it down. default-src
    // 'none' blocks script execution (incl. javascript: URLs and injected event
    // handlers); the inline <style> below needs style-src 'unsafe-inline'.
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:");
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(row.company)}: ${escapeHtml(row.role)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:20px 28px 40px;color:#1a1a1a;line-height:1.65;font-size:13.5px;background:#fff}
  h1{font-size:17px;margin:0 0 4px}
  h2{font-size:14px;margin:24px 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e5e5;color:#111}
  h3{font-size:13px;margin:16px 0 6px;color:#333}
  p{margin:6px 0}
  hr{border:none;border-top:1px solid #e5e5e5;margin:20px 0}
  blockquote{border-left:3px solid #d0d0d0;margin:10px 0;padding:6px 14px;color:#555;background:#f9f9f9;border-radius:2px}
  table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12.5px}
  th{background:#f4f4f4;text-align:left;padding:6px 10px;border:1px solid #e0e0e0;font-weight:600;color:#333}
  td{padding:5px 10px;border:1px solid #e8e8e8;vertical-align:top}
  tr:nth-child(even) td{background:#fafafa}
  ul{margin:6px 0 10px;padding-left:20px}
  li{margin:3px 0}
  code{background:#f0f0f0;border-radius:3px;padding:1px 5px;font-size:12px;font-family:monospace}
  strong{color:#111}
  a{color:#2563eb;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head><body>${body}</body></html>`);
  } catch (err) {
    res.status(500).send(`<p style="font-family:sans-serif;padding:24px;color:red">Error: ${escapeHtml(err.message)}</p>`);
  }
});


