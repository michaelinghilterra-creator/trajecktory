import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { gradeIndependently } from '../lib/draft-grader.mjs';
import { gradeModel } from '../lib/anthropic.mjs';
import { SURFACES } from '../../../lib/outreach-rubric.mjs';
import { readProjectFile } from '../lib/anthropic.mjs';

export const router = express.Router();

router.post('/api/drafts/review', async (req, res) => {
  try {
    const { body, subject, surfaceId } = req.body || {};

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required and must be a non-empty string.' });
    }
    if (!surfaceId || !SURFACES.includes(surfaceId)) {
      return res.status(400).json({ error: `surfaceId must be one of: ${SURFACES.join(', ')}` });
    }

    let cvExcerpt = '';
    try { cvExcerpt = readProjectFile(ROOT_DIR, 'cv.md'); } catch {}

    const review = await gradeIndependently(body, surfaceId, {
      model: gradeModel(),
      subject: typeof subject === 'string' ? subject : '',
      cvExcerpt,
    });

    if (!review) {
      return res.status(500).json({ error: 'Could not parse review from model output.' });
    }

    res.json({ ok: true, review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
