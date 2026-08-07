import https from 'https';
import fs from 'fs';
import { render as renderObsidianCompanion, extractJsonFromSourceReport } from '../../../scripts/render-obsidian-companion.mjs';
import { getObsidianAppliedFolder } from './profile.mjs';
import { resolveReportPath } from './safe-path.mjs';

// Render a schema-v1 source report into clean Obsidian Markdown. Falls back to
// the raw report text when the report has no v1 frontmatter (legacy reports).
function renderObsidianNote({ row, reportText, todayFormal, fallbackHeader }) {
  if (reportText) {
    const extracted = extractJsonFromSourceReport(reportText);
    if (extracted) {
      try {
        const report = JSON.parse(extracted.jsonText);
        return renderObsidianCompanion(report, { appliedDate: todayFormal, status: 'applied' });
      } catch {
        // fall through to legacy dump
      }
    }
  }
  let note = fallbackHeader;
  if (reportText) note += `\n---\n\n${reportText}`;
  return note;
}

// Obsidian push failures are non-fatal (the apply still completes), which makes
// them invisible unless they also hit the server log. Always log them loudly —
// silent push failures left applied JDs with no vault note on 6/9 and 6/11.
function warnObsidianPushFailed(company, detail) {
  console.warn(`[obsidian] PUSH FAILED for ${company}: ${detail} — note NOT written to vault. Is Obsidian running with the Local REST API plugin enabled?`);
}

// Read a row's evaluation report, refusing any path that does not sit under
// reports/. applications.md is agent-written, so the path in it is untrusted;
// mirror the containment check apply.mjs uses. Returns '' on refusal or miss,
// which renderObsidianNote handles as "no report" (minimal fallback note).
function readReportSafe(row) {
  const rel = row && row.report;
  if (!rel) return '';
  const abs = resolveReportPath(rel);
  if (!abs) {
    console.error(`[obsidian] refused a report path outside reports/: ${rel}`);
    return '';
  }
  try { return fs.readFileSync(abs, 'utf8'); } catch { return ''; }
}

// THE single Obsidian-push implementation. Every path that marks a role Applied
// funnels through here, so the "create a vault note on apply" motion cannot
// diverge between the Apply button (apply.mjs) and the status dropdown
// (routes/applications.mjs PATCH). Before this existed the PATCH path wrote no
// note at all, so marking Applied via the dropdown silently skipped the vault.
//
// Contract:
//   - Returns { skipped: true } and does NOTHING when OBSIDIAN_API_KEY is unset
//     — this is the "only if they have Obsidian set up" gate. No warning, no error.
//   - Best-effort otherwise: a failure (Obsidian closed, bad key, transient
//     HTTP error) is logged via warnObsidianPushFailed and returned as
//     { ok: false, error }, never thrown. The apply/status change still succeeds.
//   - PUT creates-or-overwrites, so re-marking an already-Applied row is
//     idempotent. Callers that don't want to clobber a hand-edited note should
//     only invoke this on the transition INTO Applied (see the PATCH route).
//
// `appliedDate` is a YYYY-MM-DD string (the real apply date); if omitted, today.
// `reportText` may be passed by callers that already read it (apply.mjs) to avoid
// a second disk read; otherwise this reads it safely from the row.
async function pushObsidianNote({ row, appliedDate, reportText, fallbackHeader } = {}) {
  const obsKey = process.env.OBSIDIAN_API_KEY;
  if (!obsKey) return { skipped: true };            // Obsidian not set up — silent skip
  if (!row || !row.company || !row.role) return { skipped: true, error: 'row missing company/role' };

  const obsPort = parseInt(process.env.OBSIDIAN_PORT || '27124', 10);

  const ymd = (appliedDate && /^\d{4}-\d{2}-\d{2}$/.test(appliedDate))
    ? appliedDate
    : new Date().toISOString().slice(0, 10);
  const [y, m, d] = ymd.split('-');
  const dateMDY = `${m}-${d}-${y}`;
  const dateFormal = new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  // Company and role become part of the note FILENAME, so strip path separators
  // and reserved chars — otherwise a "/" or "\" escapes the applied-notes folder
  // (path traversal).
  const safeRole = String(row.role).replace(/[/\\:*?"<>|]/g, '-');
  const safeCompany = String(row.company).replace(/[/\\:*?"<>|]/g, '-');
  const noteName = `${dateMDY} - ${safeCompany} - ${safeRole}`;
  const notePath = `${getObsidianAppliedFolder()}/${noteName}.md`;

  const header = fallbackHeader
    || `# ${row.company} — ${row.role}\n\n**Applied:** ${dateFormal}\n**Score:** ${row.scoreRaw || row.score || 'N/A'}\n**Status:** Applied\n`;
  const body = (reportText !== undefined) ? reportText : readReportSafe(row);
  const noteContent = renderObsidianNote({ row, reportText: body, todayFormal: dateFormal, fallbackHeader: header });

  // Encode each path SEGMENT, preserving the "/" separators. encodeURIComponent
  // over the whole path turns "/" into "%2F", which the Obsidian Local REST API
  // rejects with 404 — the bug that made the automatic push fail whenever the
  // applied folder contained a slash (it always does). Segment-encoding keeps the
  // separators literal while still escaping spaces, commas, etc. within a segment.
  const encoded = notePath.split('/').map(encodeURIComponent).join('/');
  const bodyBuf = Buffer.from(noteContent, 'utf8');
  return new Promise((resolve) => {
    const req = https.request({
      hostname: '127.0.0.1', port: obsPort, path: `/vault/${encoded}`, method: 'PUT',
      headers: {
        'Authorization': `Bearer ${obsKey}`,
        'Content-Type': 'text/markdown',
        'Content-Length': bodyBuf.length,
      },
      rejectUnauthorized: false,
    }, (res) => {
      res.resume(); // drain
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ ok: true, notePath });
      } else {
        warnObsidianPushFailed(row.company, `HTTP ${res.statusCode}`);
        resolve({ ok: false, error: `HTTP ${res.statusCode}`, notePath });
      }
    });
    req.on('error', (err) => {
      warnObsidianPushFailed(row.company, err.message);
      resolve({ ok: false, error: err.message, notePath });
    });
    req.write(bodyBuf);
    req.end();
  });
}

export { renderObsidianNote, warnObsidianPushFailed, pushObsidianNote, readReportSafe };
