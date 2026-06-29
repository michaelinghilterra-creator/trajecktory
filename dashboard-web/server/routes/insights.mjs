import express from 'express';
import fs from 'fs';
import path from 'path';
import { generateText } from '../lib/anthropic.mjs';
import { INSIGHTS_DIR, INSIGHTS_LATEST, INSIGHTS_HISTORY_MAX, loadProfileContext, loadPriorInsight, pruneInsightsHistory, buildInsightsContext } from '../lib/insights.mjs';

export const router = express.Router();

// ─── Insights ────────────────────────────────────────────────────────────
// /api/insights/generate runs a Claude pass over a structured snapshot of
// the dashboard data and returns a synthesis (what's working / what's not /
// recommended moves / this week's focus). Cached on disk so reloads are
// instant; regeneration is explicit via the button on the Insights page.

router.post('/api/insights/generate', async (req, res) => {
  try {
    const ctx = buildInsightsContext();
    const profile = loadProfileContext();
    const prior = loadPriorInsight();

    const sys = `You are a career-ops strategist analyzing a job search dashboard for a senior operator targeting Director-level RevOps/Analytics roles at $250K+ OTE. Your job: deliver direct, specific insights from the data — not generic advice.

RULES:
- Direct senior tone. No corporate filler. No em dashes.
- If the data doesn't support a claim, don't make it. Flag thin samples (appliedN < 5) explicitly rather than over-reading them.
- Prefer one strong specific recommendation over three generic ones.
- Every recommendation must anchor in a number or row from the data.
- If a prior_summary is provided, briefly note progress or drift versus that prior take (in summary or one whats_working/whats_not item).
- Weight insights against the user's profile — archetypes, walk-away comp, North Star — so recommendations feel personal, not generic.

CITATIONS (important — the frontend turns "#NNN" pills into clickable drawer links):
- ANY time you reference a row from topStale, pendingHot, or another id-bearing entity, you MUST cite it with the "#NNN Company" format (e.g. "#149 Precision AQ"). This is required; it is what makes the report navigable.
- Each whats_working / whats_not / recommended_moves item should ideally include at least one "#NNN" citation when row-level evidence exists in the data. If you reference 3 stale apps, cite all 3 by id.
- Archetype and sector citations stay as plain text ("Analytics archetype", "Healthcare sector") — those are not clickable, but use them for cohort-level claims.
- Never reference an id that does not appear verbatim in the snapshot.

Output ONLY a JSON object (no markdown, no code fences):
{
  "coach": {
    "win":     "<ONE specific thing the user is doing well right now. Warm, encouraging, anchored in real numbers from the data. 1-2 short sentences, max 30 words. Include at least one #NNN citation inline when applicable.>",
    "improve": "<ONE specific thing to fix next. Constructive, not blaming. Concrete action language. 1-2 short sentences, max 30 words. Include at least one #NNN citation inline when applicable.>"
  },
  "whats_working": [{"insight": "...", "citations": ["..."]}],
  "whats_not": [{"insight": "...", "citations": ["..."]}],
  "recommended_moves": [{"move": "...", "why": "...", "citations": ["..."]}],
  "this_week_focus": [{"action": "...", "target": "..."}]
}

Coach tone — this is the user's first read every session, set the temperature:
- Lead the WIN with a verb of recognition ("You're", "Your", "Smart move on", "Holding steady on…").
- Lead the IMPROVE with the next move, not a problem ("Push more volume into…", "Send second follow-ups on…", "Trim time spent on…"). NEVER lead with "Your X is broken/dead/rotting/failing" — that reads cold.
- Cite specific rows with #NNN format inline in the coach sentences when relevant — the frontend will make them clickable.

CITATIONS in every section (important — frontend turns "#NNN" into clickable drawer links anywhere in text, not just in citation arrays):
- Inline ANY #NNN row id you reference, in the body text of insights / moves / why / actions / focus targets. Don't only list ids in the citation arrays; embed them in the prose too so the user can drill in from the sentence.
- Use "#NNN Company" format (e.g. "#149 Precision AQ").
- Archetype and sector references stay plain ("Analytics archetype", "Healthcare sector") — those are not clickable.

Aim for 2-4 items per insight array. Be ruthless about cuts: the user values precision over completeness.`;

    const promptParts = [];
    if (profile) {
      promptParts.push(`## Candidate profile (modes/_profile.md, trimmed)\n\n${profile}`);
    }
    if (prior) {
      const priorSlim = {
        generated_at: prior.generated_at,
        summary: prior.summary,
        recommended_moves: (prior.recommended_moves || []).map(m => m.move),
      };
      promptParts.push(`## Prior insight (${prior.generated_at})\n\n${JSON.stringify(priorSlim, null, 2)}`);
    }
    promptParts.push(`## Current dashboard snapshot\n\n${JSON.stringify(ctx, null, 2)}`);
    promptParts.push(`Produce the insights JSON.`);

    // API path keeps adaptive thinking + high effort; the keyless plan path
    // ignores those knobs (best-effort) but still returns the JSON the prompt asks for.
    const raw = await generateText(promptParts.join('\n\n'), {
      model: 'claude-opus-4-8',
      maxTokens: 16000,
      system: sys,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse insights JSON', raw });
    const insights = JSON.parse(jsonMatch[0]);

    const generatedAt = new Date().toISOString();
    const out = {
      generated_at: generatedAt,
      model: 'claude-opus-4-8',
      pipeline_size: ctx.pipeline.total,
      stale_count: ctx.staleTotal,
      prior_summary: prior ? {
        generated_at: prior.generated_at,
        coach: prior.coach,
        headline: prior.headline,
        summary: prior.summary,
      } : null,
      ...insights,
    };

    if (!fs.existsSync(INSIGHTS_DIR)) fs.mkdirSync(INSIGHTS_DIR, { recursive: true });
    const runFile = path.join(INSIGHTS_DIR, `run-${generatedAt.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(runFile, JSON.stringify(out, null, 2));
    fs.writeFileSync(INSIGHTS_LATEST, JSON.stringify(out, null, 2));
    pruneInsightsHistory();
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/insights/history', (req, res) => {
  try {
    if (!fs.existsSync(INSIGHTS_DIR)) return res.json([]);
    const files = fs.readdirSync(INSIGHTS_DIR)
      .filter(f => f.startsWith('run-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, INSIGHTS_HISTORY_MAX);
    const items = files.map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(INSIGHTS_DIR, f), 'utf8'));
        return { generated_at: d.generated_at, summary: d.summary, pipeline_size: d.pipeline_size, stale_count: d.stale_count };
      } catch (_) { return null; }
    }).filter(Boolean);
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/insights/latest', (req, res) => {
  try {
    if (!fs.existsSync(INSIGHTS_LATEST)) return res.json({ generated_at: null });
    res.json(JSON.parse(fs.readFileSync(INSIGHTS_LATEST, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


