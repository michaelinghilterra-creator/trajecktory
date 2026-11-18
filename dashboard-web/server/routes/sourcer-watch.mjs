import express from 'express';
import fs from 'fs';
import path from 'path';
import { buildWatchNight, isWatchDate, listWatchDates } from '../../../lib/sourcer-watch.mjs';

export const router = express.Router();

function config() {
  const stateDir = process.env.TJK_SOURCER_STATE_DIR;
  if (!stateDir || !path.isAbsolute(stateDir)) return null;
  try {
    if (!fs.statSync(stateDir).isDirectory()) return null;
  } catch { return null; }
  const rawSites = process.env.TJK_SOURCER_WATCH_SITES || 'careerpages,hardpages';
  const sites = rawSites.split(',').map(site => site.trim()).filter(Boolean);
  return { stateDir, sites };
}

router.get('/api/sourcer-watch/dates', (_req, res) => {
  const current = config();
  if (!current) return res.json({ configured: false });
  return res.json({ configured: true, dates: listWatchDates(current.stateDir) });
});

router.get('/api/sourcer-watch', (req, res) => {
  const current = config();
  if (!current) return res.json({ configured: false });
  if (req.query.date != null && !isWatchDate(req.query.date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const date = req.query.date || listWatchDates(current.stateDir)[0];
  if (!date) return res.json({ configured: true, ...buildWatchNight({ ...current, date: '' }) });
  return res.json({ configured: true, ...buildWatchNight({ ...current, date }) });
});
