// routes/discovery.mjs — the Discovery Inbox endpoint.
//
// WHY: the dashboard's Pipeline views read only evaluated rows (applications.md)
// plus triage-scored rows, so a freshly discovered role that is still a pending
// "- [ ]" line in data/pipeline.md, or one gated to "- [!]", appeared in NO view
// and looked "lost". This endpoint exposes the raw discovery queue so found /
// pending / gated are all visible, with the gate reason on every dead row.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.mjs';
import { pipelineInbox } from '../../../lib/pipeline.mjs';

export const router = express.Router();

// GET /api/pipeline/inbox → { counts:{pending,gated,done}, pending:[…], gated:[…] }
// Read-only and recomputed per request (pipeline.md is small relative to how
// often this is polled). A missing pipeline.md is an empty inbox, not an error.
router.get('/api/pipeline/inbox', (_req, res) => {
  const file = path.join(DATA_DIR, 'pipeline.md');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* no pipeline yet → empty inbox */ }
  res.json(pipelineInbox(text));
});
