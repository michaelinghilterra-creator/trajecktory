// Backs the "Data storage" screen in Setup. It shows what the event store would add, what stays the
// same and whether every check passes, and it only ever runs the dry run. Turning the store on is a
// command line step with the operator present (scripts/event-store.mjs flip --apply), never a button.
import express from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, DATA_DIR } from '../config.mjs';
import { readEventStoreSwitch, DATABASE_FILE } from '../../../lib/event-store-switch.mjs';

const SCRIPT = path.resolve(ROOT_DIR, 'scripts', 'event-store.mjs');
const TIMEOUT_MS = 180_000;

// Runs `flip --json` (the dry run) in a child process so a long import never blocks the server.
export function runPreviewProcess({ dataDir = DATA_DIR, reimport = false, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    const args = [SCRIPT, 'flip', '--json', ...(reimport ? ['--reimport'] : []), '--data-dir', dataDir];
    const child = spawn(process.execPath, args, {
      env: { ...process.env, TJK_DATA_DIR: dataDir },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: 'The check took too long and was stopped. Nothing was changed.' });
    }, timeoutMs);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => finish({ ok: false, error: `Could not start the check: ${error.message}` }));
    child.on('close', code => {
      try {
        finish({ ok: true, report: JSON.parse(out) });
      } catch {
        finish({ ok: false, error: (err || out).trim().slice(0, 500) || `The check ended with code ${code} and no report.` });
      }
    });
  });
}

export function createEventStoreRouter({ runPreview = runPreviewProcess, dataDir = DATA_DIR } = {}) {
  const router = express.Router();
  let running = false;

  // GET /api/setup/event-store/status: cheap, reads two small facts.
  router.get('/api/setup/event-store/status', (req, res) => {
    const state = readEventStoreSwitch(dataDir);
    res.json({
      switch: state.state === 'ok' ? state.writes : state.state,
      flipped_at: state.flipped_at,
      database_present: existsSync(path.join(dataDir, DATABASE_FILE)),
    });
  });

  // POST /api/setup/event-store/preview: the dry run. One at a time; it takes several seconds.
  router.post('/api/setup/event-store/preview', async (req, res) => {
    if (running) return res.status(409).json({ error: 'A check is already running. Wait for it to finish.' });
    running = true;
    try {
      // An earlier database is stale while the switch is off, so the practice run re-imports from the files.
      const state = readEventStoreSwitch(dataDir);
      const reimport = state.writes !== 'on' && existsSync(path.join(dataDir, DATABASE_FILE));
      const result = await runPreview({ dataDir, reimport });
      if (!result.ok) return res.status(500).json({ error: result.error });
      return res.json(result.report);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    } finally {
      running = false;
    }
  });

  return router;
}

export const router = createEventStoreRouter();
