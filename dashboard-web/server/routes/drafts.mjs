import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { checkTemplatedAsk, checkUnsourcedNumbers, gradeIndependently } from '../lib/draft-grader.mjs';
import { finishDraft } from '../lib/finish-draft.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { loadCompanyResearch } from '../lib/report-research.mjs';
import { generateText, gradeModel, readOptionalProjectFile } from '../lib/anthropic.mjs';
import {
  SURFACES,
  buildImprovePrompt,
  getProfile,
  parseReviewed,
  reviewFailureReason,
  weightedScore,
} from '../../../lib/outreach-rubric.mjs';
import { getNarrative } from '../lib/profile.mjs';

export const router = express.Router();

function researchForApplication(appId) {
  try {
    if (appId === undefined || appId === null || String(appId).trim() === '') return '';
    if (typeof appId !== 'number' && typeof appId !== 'string') return '';
    const parsedId = Number(appId);
    if (!Number.isInteger(parsedId)) return '';
    const app = parseApplicationsMd().find((candidate) => candidate.id === parsedId);
    return app ? loadCompanyResearch(app.report) : '';
  } catch {
    return '';
  }
}

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
    const { body, subject, surfaceId, recipientFirst, appId } = req.body || {};

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
    const cvMd = readOptionalProjectFile(ROOT_DIR, 'cv.md');
    const companyResearch = researchForApplication(appId);
    const prompt = buildImprovePrompt(surfaceId, {
      body,
      subject: typeof subject === 'string' ? subject : '',
      cvExcerpt: cvMd,
      proofPoints: narrative.proofPoints,
      superpowers: narrative.superpowers,
      companyResearch,
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
    let reviewStatus = parsed.review ? 'ok' : `missing:${reviewFailureReason(raw, surfaceId)}`;
    if (parsed.review && companyResearch) {
      try {
        const numberCheck = checkUnsourcedNumbers(
          parsed.body,
          cvMd,
          narrative.proofPoints,
          companyResearch,
        );
        if (!numberCheck.clean) {
          const evidence = parsed.review.dimensions.find((dimension) => dimension.id === 'evidence');
          if (evidence) evidence.score = Math.min(evidence.score, 3);
          parsed.review.topFixes = [
            ...parsed.review.topFixes,
            ...numberCheck.flagged.filter((figure) => !parsed.review.topFixes.includes(figure)),
          ];
          parsed.review.score = weightedScore(parsed.review.dimensions, profile);
          parsed.review.unsourcedWarning = true;
        }
      } catch {
        reviewStatus = 'ok:unverified';
      }
    }
    if (parsed.review && profile.dims.some((dimension) => dimension.id === 'ask_strength')) {
      try {
        const askCheck = checkTemplatedAsk(parsed.body);
        if (!askCheck.clean) {
          const askStrength = parsed.review.dimensions.find((dimension) => dimension.id === 'ask_strength');
          if (askStrength) askStrength.score = Math.min(askStrength.score, 3);
          const fix = `Replace "${askCheck.matched}" with a specific next step tied to this message, or name the person you want to reach.`;
          if (!parsed.review.topFixes.includes(fix)) parsed.review.topFixes.push(fix);
          parsed.review.score = weightedScore(parsed.review.dimensions, profile);
          parsed.review.templatedAskWarning = true;
        }
      } catch {
        reviewStatus = 'ok:unverified';
      }
    }

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
