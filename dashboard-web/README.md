# trajecktory dashboard (dashboard-web)

The web dashboard for the trajecktory job-search pipeline. It visualizes the
application lifecycle (evaluated → applied → responded → interview → offer),
surfaces the rich per-evaluation report data in an expandable drawer, and
provides follow-up cadence, a recruiter CRM, coaching analytics, and a
Launchpad onboarding flow.

This is the active, shipped dashboard. (An earlier Go terminal UI under
`dashboard/` was removed; this app is its replacement.)

## Run it

```bash
cd dashboard-web
npm ci
npm start        # builds the UI, then starts the server
```

Then open the URL shown in the terminal (default `http://localhost:3333`).

Scripts:
- `npm start` — `node build.mjs` then `node server/index.mjs`
- `npm run build` — transpile `src/*.jsx` to `src/dist/` (esbuild)
- `npm run dev` — same as start (rebuild + serve)
- `npm run dev:demo` — serve synthetic demo data (`DEMO=1`, reads `data/demo/`)

It binds to `127.0.0.1` only. Set `HOST=0.0.0.0` to expose it on your LAN
(it has no password). Set `PORT` to change the port.

## Configuration

Copy `.env.example` to `.env` and fill in keys for the optional features:
- `ANTHROPIC_API_KEY` — the dashboard's draft endpoints (cover letters,
  outreach). The main `/trajecktory` pipeline runs on your Claude Code login and
  needs no key.
- `OBSIDIAN_API_KEY` / `OBSIDIAN_PORT` — optional Obsidian vault push.

State-changing requests require a per-session token: the server sets a
SameSite=Strict cookie when the dashboard HTML loads (so the browser sends it
automatically), and CLI/curl callers can pass the `x-tjk-token` header printed
at startup. The token rotates on restart, so reload the page after restarting.

## Architecture

- **`server/index.mjs`** — Express server. Reads `data/applications.md` through
  the shared canonical parser (`../lib/tracker.mjs`), enriches each row from the
  matching report header (comp, domain, legitimacy, source), and serves the API
  plus the static UI. `DEMO=1` repoints all data paths to `data/demo`.
- **`server/parser.mjs` / `server/v1-loader.mjs`** — evaluation-report parsers
  (report body and v1 JSON-frontmatter reports) used for the drawer detail view.
- **`build.mjs`** — esbuild transpiles each `src/*.jsx` file to `src/dist/`
  (per-file IIFE, `bundle:false`). React is loaded from a CDN in `src/index.html`.
- **`src/`** — the React UI: `app.jsx` (root + view switcher), `pipeline.jsx`,
  `drawer.jsx` (the rich report drawer), `analytics.jsx`, `launchpad.jsx`,
  `recruiters.jsx`, `followups.jsx`, shared helpers, and `styles.css` (design
  tokens live here).
- **`src/brand/`** — logo and wordmark assets.

## Data source of truth

The dashboard never owns data. It reads `data/applications.md` (the tracker),
the per-evaluation files in `reports/`, and the sidecar files
(`apply-dates.json`, `status-events.tsv`, etc.). Status changes from the UI are
written back to `applications.md`. See `../DATA_CONTRACT.md` for the full
user-layer vs system-layer contract.
