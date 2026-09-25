import { existsSync, readFileSync } from 'node:fs';

export function loadEnvKey(key, paths) {
  for (const envPath of paths) {
    if (!existsSync(envPath)) continue;
    const env = readFileSync(envPath, 'utf8');
    const m = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
    const value = m?.[1]?.trim() || '';
    if (value) return value;
  }
  return '';
}
