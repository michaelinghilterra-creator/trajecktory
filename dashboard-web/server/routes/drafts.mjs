import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { gradeIndependently } from '../lib/draft-grader.mjs';
import { gradeModel } from '../lib/anthropic.mjs';
import { SURFACES, getProfile } from '../../../lib/outreach-rubric.mjs';
import { readOptionalProjectFile } from '../lib/anthropic.mjs';
import { getNarrative } from '../lib/profile.mjs';

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

    // A rubric-off surface cannot be graded. Say so, rather than letting it fall
    // through to the generic "could not parse review" 500, which reads like a
    // model failure instead of a bad request.
    if (!getProfile(surfaceId)?.rubric) {
      return res.status(400).json({ error: `surfaceId ${surfaceId} is not graded by the rubric.` });
    }

    // Generation grades evidence against the CV plus the narrative proof points.
    // Feed the independent grader the same sources, or the two disagree on the
    // evidence dimension by construction and the calibration gap is meaningless.
    const narrative = getNarrative();
    const review = await gradeIndependently(body, surfaceId, {
      model: gradeModel(),
      subject: typeof subject === 'string' ? subject : '',
      cvExcerpt: readOptionalProjectFile(ROOT_DIR, 'cv.md'),
      proofPoints: narrative.proofPoints,
      superpowers: narrative.superpowers,
    });

    if (!review) {
      return res.status(500).json({ error: 'Could not parse review from model output.' });
    }

    res.json({ ok: true, review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
