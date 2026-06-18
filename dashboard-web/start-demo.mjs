// Bootstrap that sets DEMO=1 then loads the server. Used by `npm run dev:demo`
// and by the .claude/launch.json `career-ops-demo` profile (run from repo root).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
process.env.DEMO = '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(path.join(__dirname, 'server', 'index.mjs')).href);
