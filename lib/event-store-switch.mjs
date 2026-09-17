import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SWITCH_FILE = 'event-store.json';
export const DATABASE_FILE = 'trajecktory.db';

export function readEventStoreSwitch(dataDir) {
  try {
    const value = JSON.parse(readFileSync(join(dataDir, SWITCH_FILE), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || (value.writes !== 'on' && value.writes !== 'off')) {
      return { writes: 'off', flipped_at: value?.flipped_at ?? null, state: 'invalid' };
    }
    return { writes: value.writes, flipped_at: value.flipped_at ?? null, state: 'ok' };
  } catch (error) {
    return {
      writes: 'off',
      flipped_at: null,
      state: error?.code === 'ENOENT' ? 'missing' : 'invalid',
    };
  }
}
