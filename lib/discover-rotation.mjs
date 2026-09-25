import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CURSOR_FILE = 'discover-rotation.json';

export function loadCursor(dataDir) {
  const cursorPath = path.join(dataDir, CURSOR_FILE);
  if (!existsSync(cursorPath)) return 0;
  try {
    const value = JSON.parse(readFileSync(cursorPath, 'utf8'))?.cursor;
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveCursor(dataDir, cursor) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, CURSOR_FILE), `${JSON.stringify({ cursor })}\n`, 'utf8');
}
