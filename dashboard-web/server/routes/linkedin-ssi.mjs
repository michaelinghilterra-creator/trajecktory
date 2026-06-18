import express from 'express';
import fs from 'fs';
import path from 'path';
import { LINKEDIN_SSI_DIR } from '../config.mjs';
import { ensureLikedinSsiDir } from '../lib/linkedin-ssi.mjs';

export const router = express.Router();

// ── LinkedIn SSI Management ────────────────────────────────────────────────────

router.get('/api/linkedin-ssi/summary', (req, res) => {
  try {
    ensureLikedinSsiDir();
    const trackerPath = path.join(LINKEDIN_SSI_DIR, 'tracker.json');
    if (!fs.existsSync(trackerPath)) {
      return res.json({ currentSsi: 39, targetSsi: 60, weeks: [] });
    }
    const data = JSON.parse(fs.readFileSync(trackerPath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/linkedin-ssi/influencers — get influencer list
router.get('/api/linkedin-ssi/influencers', (req, res) => {
  try {
    ensureLikedinSsiDir();
    const influencersPath = path.join(LINKEDIN_SSI_DIR, 'influencers.json');
    if (!fs.existsSync(influencersPath)) {
      return res.json([]);
    }
    const data = JSON.parse(fs.readFileSync(influencersPath, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/linkedin-ssi/influencers/:id — update influencer follow/connected status
router.patch('/api/linkedin-ssi/influencers/:id', (req, res) => {
  try {
    ensureLikedinSsiDir();
    const influencersPath = path.join(LINKEDIN_SSI_DIR, 'influencers.json');
    let data = [];
    if (fs.existsSync(influencersPath)) {
      data = JSON.parse(fs.readFileSync(influencersPath, 'utf8'));
    }
    const id = parseInt(req.params.id, 10);
    const idx = data.findIndex(i => i.id === id);
    if (idx !== -1) {
      data[idx] = { ...data[idx], ...req.body };
    }
    fs.writeFileSync(influencersPath, JSON.stringify(data, null, 2));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/linkedin-ssi/engagement-log — get engagement log
router.get('/api/linkedin-ssi/engagement-log', (req, res) => {
  try {
    ensureLikedinSsiDir();
    const logPath = path.join(LINKEDIN_SSI_DIR, 'engagement-log.md');
    if (!fs.existsSync(logPath)) {
      return res.json([]);
    }
    const content = fs.readFileSync(logPath, 'utf8');
    // Parse markdown table into JSON
    const lines = content.split('\n');
    const entries = [];
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith('---') || line.startsWith('```')) { inTable = false; continue; }
      if (line.includes('|') && !line.includes('---')) {
        if (inTable && !line.startsWith('|')) inTable = false;
        if (inTable && line.trim().length > 0) {
          const cols = line.split('|').slice(1, -1).map(c => c.trim());
          // Accept legacy 8-col rows and 9-col rows (trailing Logged At timestamp).
          if (cols.length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(cols[0])) {
            entries.push({
              date: cols[0],
              influencer: cols[1],
              actionType: cols[2],
              topic: cols[3],
              message: cols[4],
              responseReceived: cols[5],
              connectionMade: cols[6],
              notes: cols[7],
              loggedAt: cols[8] || ''
            });
          }
        }
        if (line.includes('Date') && line.includes('Influencer')) inTable = true;
      }
    }
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-ssi/engagement-log — add engagement activity
router.post('/api/linkedin-ssi/engagement-log', (req, res) => {
  try {
    ensureLikedinSsiDir();
    const logPath = path.join(LINKEDIN_SSI_DIR, 'engagement-log.md');
    let content = '';
    if (fs.existsSync(logPath)) {
      content = fs.readFileSync(logPath, 'utf8');
    }
    // Get influencer name from id
    const influencersPath = path.join(LINKEDIN_SSI_DIR, 'influencers.json');
    let influencers = [];
    if (fs.existsSync(influencersPath)) {
      influencers = JSON.parse(fs.readFileSync(influencersPath, 'utf8'));
    }
    const influencer = influencers.find(i => i.id === parseInt(req.body.influencerId, 10));
    const name = influencer ? influencer.name : 'Unknown';
    // Sanitize cell values: collapse newlines and neutralize pipes so a multi-line
    // or pipe-containing message (common in AI-generated drafts) can't corrupt the
    // single-row markdown table the GET parser relies on.
    const clean = (s) => String(s ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '/').trim();
    // Wall-clock insertion stamp so the timeline can sort by when it was logged,
    // not just the (day-granularity) activity date. Real time → newest floats to top
    // even among same-day entries.
    const loggedAt = new Date().toISOString();
    // Build the new row
    const row = `| ${clean(req.body.date)} | ${clean(name)} | ${clean(req.body.actionType)} | ${clean(req.body.topic)} | ${clean(req.body.message)} | ${clean(req.body.responseReceived)} | ${clean(req.body.connectionMade)} | ${clean(req.body.notes)} | ${loggedAt} |`;

    // Insert the row INSIDE the table region (before the first horizontal-rule divider that follows the table header).
    // Bug fix 2026-06-08: previously appended to end-of-file, which placed new rows past the `---` divider where the GET parser stops, making them invisible in the dashboard.
    const fileLines = content.split('\n');
    let headerIdx = -1;
    for (let i = 0; i < fileLines.length; i++) {
      const l = fileLines[i];
      if (l.includes('|') && l.includes('Date') && l.includes('Influencer')) { headerIdx = i; break; }
    }
    if (headerIdx === -1) {
      // No table yet, create one at the top of the file
      const tableBlock = '\n| Date | Influencer | Action Type | Topic | Message | Response Received | Connection Made | Notes | Logged At |\n|------|-----------|-------------|-------|---------|-------------------|-----------------|-------|-----------|\n' + row + '\n';
      content = (content.trimEnd() + '\n' + tableBlock).replace(/^\n+/, '');
    } else {
      // Find the insertion point: the line immediately before the first `---` that comes after the header,
      // or the last consecutive `|`-prefixed row if no divider exists.
      let insertAt = fileLines.length;
      for (let i = headerIdx + 1; i < fileLines.length; i++) {
        const l = fileLines[i].trim();
        if (l.startsWith('---') && !l.startsWith('|---')) { insertAt = i; break; }
        if (!l.startsWith('|') && l.length > 0) { insertAt = i; break; }
      }
      fileLines.splice(insertAt, 0, row);
      content = fileLines.join('\n');
    }
    fs.writeFileSync(logPath, content);
    // Re-parse and return — mirror the GET parser exactly: reset on the `---`/``` ```
    // boundaries and require a real date in col 0, so the trailing template row (which
    // has the right column count but a `YYYY-MM-DD` placeholder) isn't counted.
    const lines = content.split('\n');
    const entries = [];
    let inTable = false;
    for (const line of lines) {
      if (line.startsWith('---') || line.startsWith('```')) { inTable = false; continue; }
      if (line.includes('|') && !line.includes('---')) {
        if (inTable && !line.startsWith('|')) inTable = false;
        if (inTable && line.trim().length > 0) {
          const cols = line.split('|').slice(1, -1).map(c => c.trim());
          if (cols.length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(cols[0])) {
            entries.push({
              date: cols[0],
              influencer: cols[1],
              actionType: cols[2],
              topic: cols[3],
              message: cols[4],
              responseReceived: cols[5],
              connectionMade: cols[6],
              notes: cols[7],
              loggedAt: cols[8] || ''
            });
          }
        }
        if (line.includes('Date') && line.includes('Influencer')) inTable = true;
      }
    }
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: load influencer record by id or name from data/linkedin-ssi/influencers.json
router.post('/api/linkedin-ssi/tracker', (req, res) => {
  try {
    ensureLikedinSsiDir();
    const trackerPath = path.join(LINKEDIN_SSI_DIR, 'tracker.json');
    let data = { currentSsi: 39, targetSsi: 60, weeks: [] };
    if (fs.existsSync(trackerPath)) {
      data = JSON.parse(fs.readFileSync(trackerPath, 'utf8'));
    }
    // Update week. Treat null/undefined/'' as "not set"; 0 is a valid score.
    const pillar = (v) => (v === null || v === undefined || v === '') ? null : parseInt(v, 10);
    const week = data.weeks.find(w => w.weekNum === req.body.weekNum);
    if (week) {
      week.brand = pillar(req.body.brand);
      week.findPeople = pillar(req.body.findPeople);
      week.engageInsights = pillar(req.body.engageInsights);
      week.relationships = pillar(req.body.relationships);
      week.notes = req.body.notes || '';
      // Recalculate current SSI (use latest completed week)
      for (let i = data.weeks.length - 1; i >= 0; i--) {
        const w = data.weeks[i];
        if (w.brand !== null && w.findPeople !== null && w.engageInsights !== null && w.relationships !== null) {
          data.currentSsi = w.brand + w.findPeople + w.engageInsights + w.relationships;
          break;
        }
      }
    }
    fs.writeFileSync(trackerPath, JSON.stringify(data, null, 2));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/report-body/:id — return report HTML body as JSON (for inline drawer rendering)

