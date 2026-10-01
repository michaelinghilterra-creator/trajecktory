/**
 * capture-shell.mjs: the mocks every page load needs (app shell, sidebar,
 * Workflow panel, badges). Group modules add their own routes on top; later
 * registrations win, so a group can override anything here.
 *
 * Everything served is invented (see capture-dashboard.mjs FIXTURES: the
 * Northwind / Globex / Contoso search and the Jordan Avery persona).
 */
import { json, state } from './capture-lib.mjs';
import { FIXTURES as F } from './capture-dashboard.mjs';
import { APPS, corePayload } from './capture-apps.mjs';

export const VERSION = '5.5.6';

export { APPS };

const SETUP_STATE = () =>
  state.setup === 'firstrun' ? F.STATE_FIRSTRUN : state.setup === 'started' ? F.STATE_STARTED : F.STATE_READY;

export async function installShell(page) {
  const empty = () => state.data === 'empty';

  await page.route('**/api/system/version', (r) => json(r, { version: VERSION }));
  await page.route('**/api/system/update-check', (r) => json(r, { status: 'up-to-date' }));
  await page.route('**/api/claude-status', (r) => json(r, { signedIn: true }));
  await page.route('**/api/archetypes', (r) => json(r, ['RevOps', 'SalesOps', 'Analytics', 'Strategy']));
  await page.route('**/api/identity', (r) => json(r, F.IDENTITY));
  await page.route('**/api/applications', (r) => json(r, empty() ? [] : APPS));
  await page.route('**/api/metrics/core', (r) => json(r, corePayload()));
  await page.route('**/api/pipeline/inbox', (r) => json(r, { pending: [], gated: [], done: [], counts: { pending: 0, gated: 0, done: 0 } }));
  await page.route('**/api/setup/state', (r) => json(r, SETUP_STATE()));

  // Sidebar Workflow panel
  await page.route('**/api/pipeline/pending', (r) => json(r, { pending: empty() ? 0 : 7 }));
  await page.route('**/api/pipeline/needs-manual', (r) => json(r, { items: [] }));
  await page.route('**/api/agent/roll-config', (r) => json(r, { enabled: false }));
  await page.route('**/api/agent/active', (r) => json(r, {}));
  await page.route('**/api/agent/cost-history', (r) => json(r, []));
  await page.route('**/api/setup/models', (r) => json(r, F.MODELS_STATE));

  // Badges and header
  await page.route('**/api/followups/stale', (r) => json(r, empty() ? { warm: [], cold: [], snoozed: [] } : F.FOLLOWUPS_STALE));
  await page.route('**/api/cadence/today', (r) => json(r, empty() ? [] : F.CADENCE_TODAY));
  await page.route('**/api/todos', (r) => json(r, empty() ? { todos: [] } : F.TODOS));
  await page.route('**/api/interviews/pending-outcome', (r) => json(r, { pending: [] }));
  await page.route('**/api/google/health', (r) =>
    json(r, state.google === 'connected' ? F.GOOGLE_HEALTH_CONNECTED : F.GOOGLE_HEALTH_DISCONNECTED));
}
