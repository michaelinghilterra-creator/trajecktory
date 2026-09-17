import { renderDirty } from '../../../lib/legacy-files.mjs';
import { logWritesEnabled, openDataStore } from '../../../lib/log-writes.mjs';

export function catchUpEventStore(dataDir, { logError = console.error } = {}) {
  if (!logWritesEnabled(dataDir)) return { rendered: [], failed: [] };
  try {
    const result = renderDirty(openDataStore(dataDir), dataDir);
    for (const { file } of result.failed) {
      logError(`[event-store] startup render failed for ${file}`);
    }
    return result;
  } catch (error) {
    logError(`[event-store] startup catch-up failed: ${error.message}`);
    return { rendered: [], failed: [] };
  }
}
