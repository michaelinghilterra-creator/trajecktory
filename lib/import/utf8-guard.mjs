import { readFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEGACY_TABLE_FILES,
  LEGACY_JSON_FILES,
  LEGACY_CORRESPONDENCE_DIRS,
} from '../legacy-files.mjs';

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

export function findNonUtf8Files(dataDir) {
  const badFiles = [];

  const allFiles = new Set();

  for (const file of LEGACY_TABLE_FILES) {
    allFiles.add(normalizePath(file));
  }
  for (const file of LEGACY_JSON_FILES) {
    allFiles.add(normalizePath(file));
  }
  for (const dir of LEGACY_CORRESPONDENCE_DIRS) {
    const dirPath = join(dataDir, dir);
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          allFiles.add(normalizePath(join(dir, entry.name)));
        }
      }
    } catch {
      // missing directory, skip
    }
  }

  for (const relPath of allFiles) {
    const filePath = join(dataDir, relPath);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath);
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch {
        badFiles.push(normalizePath(relPath));
      }
    } catch {
      // skip files that can't be read
    }
  }

  return badFiles.sort();
}
