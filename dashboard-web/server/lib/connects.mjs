import fs from 'fs';
import { CONNECTS_PATH } from '../config.mjs';

// Manual LinkedIn-connect tally. Connections are sent by hand (never automated),
// so the count is logged here, one entry per invite. Returns null when no log
// exists yet, so the weekly metric reads "not logged" rather than a false zero;
// an existing-but-empty log reads a real zero.
function readConnects() {
  if (!fs.existsSync(CONNECTS_PATH)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(CONNECTS_PATH, 'utf8'));
    return Array.isArray(j) ? j : (Array.isArray(j?.connects) ? j.connects : []);
  } catch { return []; }
}

function logConnect({ name = '', source = '', date = null } = {}) {
  const list = readConnects() || [];
  list.push({
    date: date || new Date().toISOString().slice(0, 10),
    name: String(name).slice(0, 120),
    source: String(source).slice(0, 40),
  });
  fs.writeFileSync(CONNECTS_PATH, JSON.stringify(list, null, 2) + '\n');
  return list;
}

export { readConnects, logConnect };
