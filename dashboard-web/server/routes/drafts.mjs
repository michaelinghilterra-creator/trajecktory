import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { gradeIndependently } from '../lib/draft-grader.mjs';
import { finishDraft } from '../lib/finish-draft.mjs';
import { generateText, gradeModel, readOptionalProjectFile } from '../lib/anthropic.mjs';
import {
  SURFACES,
  buildImprovePrompt,
  getProfile,
  parseReviewed,
  reviewFailureReason,
} from '../../../lib/outreach-rubric.mjs';
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

router.post('/api/drafts/improve', async (req, res) => {
  try {
    const { body, subject, surfaceId, recipientFirst } = req.body || {};

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required and must be a non-empty string.' });
    }
    if (!surfaceId || !SURFACES.includes(surfaceId)) {
      return res.status(400).json({ error: `surfaceId must be one of: ${SURFACES.join(', ')}` });
    }

    const profile = getProfile(surfaceId);
    if (!profile?.rubric) {
      return res.status(400).json({ error: `surfaceId ${surfaceId} is not graded by the rubric.` });
    }

    const narrative = getNarrative();
    const prompt = buildImprovePrompt(surfaceId, {
      body,
      subject: typeof subject === 'string' ? subject : '',
      cvExcerpt: readOptionalProjectFile(ROOT_DIR, 'cv.md'),
      proofPoints: narrative.proofPoints,
      superpowers: narrative.superpowers,
    });
    const raw = await generateText(prompt, { model: gradeModel(), maxTokens: 2200 });
    const parsed = parseReviewed(raw, surfaceId);
    if (!parsed || typeof parsed.body !== 'string' || !parsed.body.trim()) {
      return res.status(500).json({ error: 'Could not parse an improved draft with a usable body from model output.' });
    }

    const hasSubject = profile.dims.some((dimension) => dimension.id === 'subject');
    const hasCharacterCap = profile.hardCapUnit === 'chars';
    // Use the same status vocabulary as the generation path, so a caller reads
    // one set of codes rather than a second one invented here.
    const reviewStatus = parsed.review ? 'ok' : `missing:${reviewFailureReason(raw, surfaceId)}`;

    // Map finish behavior from the rubric profile so callers cannot weaken it.
    const finished = await finishDraft({
      body: parsed.body,
      subject: parsed.subject,
      cleaner: hasSubject ? 'email' : 'prose',
      flatten: hasCharacterCap,
      hardFit: hasCharacterCap ? profile.hardCap : null,
      stripSalutationFor: typeof recipientFirst === 'string' && recipientFirst.trim()
        ? recipientFirst.trim()
        : null,
      stripSignature: true,
      surface: surfaceId,
      review: parsed.review,
      reviewStatus,
    });

    return res.json({
      ok: true,
      draft: { subject: finished.subject, body: finished.body },
      review: finished.review,
      reviewStatus: finished.reviewStatus,
      reviewOf: 'original',
      original: { subject, body },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
