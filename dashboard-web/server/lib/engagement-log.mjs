import fs from 'fs';
import path from 'path';
import { LINKEDIN_SSI_DIR } from '../config.mjs';

// The influencer engagement log (data/linkedin-ssi/engagement-log.md) is a
// markdown table the LinkedIn SSI tab appends to when you log a comment or a
// connection request against a tracked influencer. This is the ONE parser for it,
// shared by the route that renders the log and the weekly-metrics collector that
// counts connection requests toward "LinkedIn connects sent". A second, drifting
// copy of this parse is exactly the class of bug this file exists to prevent.
//
// Returns [] when the file does not exist yet. Accepts legacy 8-column rows and
// 9-column rows (trailing "Logged At" ISO timestamp).
export function readEngagementLog() {
  try {
    const logPath = path.join(LINKEDIN_SSI_DIR, 'engagement-log.md');
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf8');
    const entries = [];
    let inTable = false;
    for (const line of content.split('\n')) {
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
              loggedAt: cols[8] || '',
            });
          }
        }
        if (line.includes('Date') && line.includes('Influencer')) inTable = true;
      }
    }
    return entries;
  } catch { return []; }
}

// Connection requests logged against influencers, shaped like the manual/TA
// connects log ({ date, name, source }) so weekly-metrics can union them with
// linkedin-connects.json under one "connects sent" count. The AI Connect flow
// writes actionType "Connection request"; only those are connects (a "Commented"
// row is engagement, tallied elsewhere, not a connect).
export function influencerConnects() {
  return readEngagementLog()
    .filter(e => /connection request/i.test(e.actionType || ''))
    .map(e => ({ date: (e.date || '').slice(0, 10), name: e.influencer || '', source: 'influencer' }));
}
