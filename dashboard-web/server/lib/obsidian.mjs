import https from 'https';
import { render as renderObsidianCompanion, extractJsonFromSourceReport } from '../../../scripts/render-obsidian-companion.mjs';

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

// Reusable HTTPS agent that skips self-signed cert verification (localhost only)
const localhostAgent = new https.Agent({ rejectUnauthorized: false });

export { renderObsidianNote, warnObsidianPushFailed, localhostAgent };

