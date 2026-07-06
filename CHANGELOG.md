# Changelog

## [1.12.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.11.0...v1.12.0) (2026-07-06)


### Features

* **dashboard:** decouple cover letter into its own button; rename Manual Apply to Tailor CV ([c1114aa](https://github.com/michaelinghilterra-creator/trajecktory/commit/c1114aad158b29cef3d3aba5e24048a541d3d68b))

## [1.11.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.10.1...v1.11.0) (2026-07-06)


### Features

* **dashboard:** add dim slate theme ([aa9885e](https://github.com/michaelinghilterra-creator/trajecktory/commit/aa9885eb46aeba282cadf76358073eeb0c528d0d))
* **dashboard:** per-section model selection with cost estimates ([d54ea62](https://github.com/michaelinghilterra-creator/trajecktory/commit/d54ea6249a72c512b3d3ad4da534c8136fe50237))
* **dashboard:** plan/key billing toggle; retire deep-mode checkbox ([29ec719](https://github.com/michaelinghilterra-creator/trajecktory/commit/29ec719966f83ec47d9eac19b4fa9cf16fbe2f66))


### Bug Fixes

* **dashboard:** show all releases in the Change Log with clean, trimmed notes ([5621b02](https://github.com/michaelinghilterra-creator/trajecktory/commit/5621b0253421f7748630cf8b9cf63ee515da3a03))
* **dashboard:** sparkline window 75-&gt;60 days ([61e4f23](https://github.com/michaelinghilterra-creator/trajecktory/commit/61e4f236b4a2d31271dfaffcd027a9487228ed3b))
* **dashboard:** surface interrupted agent runs instead of a frozen spinner ([1401c3b](https://github.com/michaelinghilterra-creator/trajecktory/commit/1401c3b733ca8c807c06ac32399e243a6f9719c6))
* **dashboard:** trim Overview activity sparkline to 75 days ([1c4fb38](https://github.com/michaelinghilterra-creator/trajecktory/commit/1c4fb38d90eaec5e3736e639ee649bdbcd56f150))

## [1.10.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.10.0...v1.10.1) (2026-07-02)


### Bug Fixes

* **dashboard:** migrate to Express 5 (named SPA wildcard route) ([51b9150](https://github.com/michaelinghilterra-creator/trajecktory/commit/51b9150c974c19a5aa06be3b4bef8652b7be19f0))
* **dashboard:** upgrade to React 19 (bundle vendored React via esbuild, drop UMD) ([6ebf4a9](https://github.com/michaelinghilterra-creator/trajecktory/commit/6ebf4a9f2e0420db271aae6a0ab43ffa2b3a29b3))
* resolve CodeQL correctness findings (incomplete sanitization + double escaping) ([8fe9dd9](https://github.com/michaelinghilterra-creator/trajecktory/commit/8fe9dd9a2f8b595edc30bb62dd5a09262990c59b))

## [1.10.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.9.0...v1.10.0) (2026-07-02)


### Features

* **update:** verify SSH-signed release tags before self-updating (opt-in) ([9b4a4b4](https://github.com/michaelinghilterra-creator/trajecktory/commit/9b4a4b44404bcad5d176102aa2efb7a6d0820439))


### Bug Fixes

* **deps:** bump js-yaml to 4.3.0 to resolve quadratic-DoS advisory ([f63306b](https://github.com/michaelinghilterra-creator/trajecktory/commit/f63306b85ea11fab26a12950589b9569f1b7e246))

## [1.9.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.8.0...v1.9.0) (2026-07-02)


### Features

* **dashboard:** widen activity sparkline to 90 days, drop sidebar streak and stats ([c4036ec](https://github.com/michaelinghilterra-creator/trajecktory/commit/c4036ecc14e80f0cf096501984cb668f478949bd))
* **update:** tokenless self-healing self-update for the public repo ([d63cdda](https://github.com/michaelinghilterra-creator/trajecktory/commit/d63cdda87538177cb730c95c606a57eea96948ef))


### Bug Fixes

* **dashboard:** advance Evaluate meter as reports land, clamped to batch size ([df17611](https://github.com/michaelinghilterra-creator/trajecktory/commit/df176119a8694cfd5626416f919d2283ccdb9227))
* **merge-tracker:** make self-sourced source enforcement symmetric ([d4fb37b](https://github.com/michaelinghilterra-creator/trajecktory/commit/d4fb37b7ec8ce2689aea22f78db5f8f24227dfcb))
* **security:** allow-list agent model and sanitize report link hrefs ([cca0970](https://github.com/michaelinghilterra-creator/trajecktory/commit/cca09704553cea9d8577922c7093a0e0875162ba))

## [1.8.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.7.32...v1.8.0) (2026-06-30)


### Features

* 60-day activity sparkline and slimmer analytics layout ([2c7bb60](https://github.com/michaelinghilterra-creator/trajecktory/commit/2c7bb60d768fa03bb6b5aae0fa51ba1634bf564e))
* add CSV Template and Import to Recruiters with a shared importer ([eaba6fb](https://github.com/michaelinghilterra-creator/trajecktory/commit/eaba6fbdb50d80bd9cc2e06e9d5af03a8bd3889b))
* add phone and company URL to TA Outreach import and drawer ([8f7e1f6](https://github.com/michaelinghilterra-creator/trajecktory/commit/8f7e1f6e50aa9d762bdc69d39fb49d0f9c41bd79))
* drop Triage from the API-key workflow ([d37fd3c](https://github.com/michaelinghilterra-creator/trajecktory/commit/d37fd3cce3373910419ea44e0ba021994a2eb4e6))
* hide the Triage results panel on the API-key workflow ([3484d99](https://github.com/michaelinghilterra-creator/trajecktory/commit/3484d990c14c67555bcc7e1d42f79b0e9383fd49))
* restructure Setup into sub-tabs with a Tell Me About Yourself pitch builder ([626c5b1](https://github.com/michaelinghilterra-creator/trajecktory/commit/626c5b194eb47a9bf4839e21dcd9243ffdba02b3))
* split Insights into Overview / What's working / What's not / Recommended moves sub-tabs ([d2ada79](https://github.com/michaelinghilterra-creator/trajecktory/commit/d2ada79e8540757ad5d49a2567574e6d49b3aabe))
* split the workflow sidebar into Claude-plan and API-key variants ([711c145](https://github.com/michaelinghilterra-creator/trajecktory/commit/711c1454c26049bb3c5c73b3d2814f7cd53e531a))


### Bug Fixes

* open the Pipeline drawer from Insights citations and command palette ([4bcc27d](https://github.com/michaelinghilterra-creator/trajecktory/commit/4bcc27dc1b213bb0dc59bce987a9265d1dd5e102))
* remove hardcoded absolute path from onboarding resize-shots script ([26f7f8b](https://github.com/michaelinghilterra-creator/trajecktory/commit/26f7f8b33064257ba8a31259f216bd35727883de))
* ship next-jd.mjs via auto-update + make merge-tracker crash-proof without it ([973b873](https://github.com/michaelinghilterra-creator/trajecktory/commit/973b8736763ae86e46a017dfd5b67f039d78cd67))

## [1.7.32] - 2026-06-29

### Fixed
- Job postings are now labeled correctly by how they were found. A role discovered by a scan can no longer be mislabeled as "self-sourced," and anything you paste yourself (in the dashboard or in Claude) stays marked self-sourced. The label is now set deterministically at merge time instead of being guessed during evaluation.

## [1.7.31] - 2026-06-29

### Fixed
- The dashboard is now crash-resistant. A transient error in a single request (for example, a file read that lands while a scan, merge, or update is rewriting data underneath it) can no longer take the whole dashboard down. it logs the problem and keeps running.

### Changed
- JD numbers are never reused. Report files and tracker entries now draw from a single persistent counter, so a number always points to one posting and the report number matches the tracker id. Previously, numbers could repeat after old reports were cleaned up, which made the pipeline confusing.

## [1.7.30] - 2026-06-29

### Changed
- AI writing features (outreach and follow-up emails, cover letters, CV tailoring, the Insights summary, and TA contact discovery) now run on your Claude plan by default and no longer require an Anthropic API key. If a key is set, it is used as a faster path.

## [1.7.29] - 2026-06-28

### Changed
- Version bump to validate the first-launch self-update (no functional changes from 1.7.28).

## [1.7.28] - 2026-06-28

### Fixed
- The update banner now appears on the very first launch after install. The updater locates Git for Windows via the registry (and common install paths), so it no longer depends on git having propagated onto the PATH yet.

## [1.7.27] - 2026-06-28

### Changed
- Version bump to validate the one-click self-update end to end (no functional changes from 1.7.26).

## [1.7.26] - 2026-06-28

### Fixed
- Updates are now genuinely one-click: after "Update now" the dashboard restarts itself and reloads, with no manual server restarts. A fresh install also shows the update banner on first launch (the bundled git is found immediately, instead of only after a restart).

## [1.7.25] - 2026-06-28

### Added
- The sidebar now shows the running version number (e.g. v1.7.25) instead of a static label, so you can confirm at a glance which version you are on after an update.

## [1.7.24] - 2026-06-28

### Added
- One-click in-app updates. The dashboard now checks for a newer version on launch and shows an "Update available" banner with the changelog and an "Update now" button. Updates pull system files only, so your CV, profile, tracker, and reports are never touched, and rollback stays available.

## [Unreleased]

Hardening pass from the repo audit (see `AUDIT.md`). Not yet versioned.

### Security
- Dashboard binds to `127.0.0.1` by default and requires a per-session token (SameSite cookie, or `x-tjk-token` header) on state-changing requests; CORS scoped to localhost; added `dashboard-web/.env.example`.

### Added
- Single canonical `applications.md` parser (`lib/tracker.mjs`) shared by every script and the dashboard.
- Slash command renamed to `/trajecktory` (Claude skill + Gemini commands); the legacy `/career-ops` command was retired.
- ESLint gate, committed lockfiles with `npm ci`, dashboard-web build, and unit tests for the core ingest/merge logic, all wired into CI.

### Fixed
- `Closed` and `Not a Fit` no longer inflate analytics conversion-rate denominators.
- `analyze-patterns.mjs` read the wrong tracker column (the Resume cell), so archetype enrichment was dead; it now reads the report link correctly.
- Scanner dedup key (`normalizeUrl`) now strips the query string before the `/application` segment, so a `.../application?utm=...` URL dedupes against the clean posting instead of being re-added.

### Changed
- Removed the legacy Go dashboard; `dashboard-web` is the single dashboard.
- Removed the standalone Gemini API evaluator (`gemini-eval.mjs`) and the `@google/generative-ai` dependency; Claude is the single LLM backend. Gemini CLI support (running trajecktory inside Gemini CLI) is unaffected.
- Rebranded to lowercase `trajecktory` across docs and UI.
- Fixed pervasive doc drift: eval format (A-F scoring + Block G), docx-first CV flow, dead links, and the AGENTS.md schema (10-column tracker, 10 canonical states).

## [1.7.0] - 2026-05-08

Synced to upstream career-ops v1.7.0 via `update-system.mjs` (this bundles the
upstream 1.6.0 and 1.7.0 releases). These versions were not cut from this repo,
so their detailed notes live in the upstream project's releases:
https://github.com/santifer/career-ops/releases

## [1.5.0](https://github.com/santifer/career-ops/compare/v1.4.0...v1.5.0) (2026-04-14)


### Features

* add --min-score flag to batch runner ([#249](https://github.com/santifer/career-ops/issues/249)) ([cb0c7f7](https://github.com/santifer/career-ops/commit/cb0c7f7d7d3b9f3f1c3dc75ccac0a08d2737c01e))
* add {{PHONE}} placeholder to CV template ([#287](https://github.com/santifer/career-ops/issues/287)) ([e71595f](https://github.com/santifer/career-ops/commit/e71595f8ba134971ecf1cc3c3420d9caf21eed43))
* **dashboard:** add manual refresh shortcut ([#246](https://github.com/santifer/career-ops/issues/246)) ([4b5093a](https://github.com/santifer/career-ops/commit/4b5093a8ef1733c449ec0821f722f996625fcb84))


### Bug Fixes

* add stopword filtering and overlap ratio to roleMatch ([#248](https://github.com/santifer/career-ops/issues/248)) ([4da772d](https://github.com/santifer/career-ops/commit/4da772d3a4996bc9ecbe2d384d1e9d2ed75b9819))
* **dashboard:** show dates in pipeline list ([#298](https://github.com/santifer/career-ops/issues/298)) ([e5e2a6c](https://github.com/santifer/career-ops/commit/e5e2a6cffe9a5b9f3cec862df25410d02ecc9aa4))
* ensure data/ and output/ dirs exist before writing in scripts ([#261](https://github.com/santifer/career-ops/issues/261)) ([4b834f6](https://github.com/santifer/career-ops/commit/4b834f6f7f8f1b647a6bf76e43b017dcbe9cd52f))
* remove wellfound, lever and remotefront from portals.example.yml ([#286](https://github.com/santifer/career-ops/issues/286)) ([ecd013c](https://github.com/santifer/career-ops/commit/ecd013cc6f59e3a1a8ef77d34e7abc15e8075ed3))

## [1.4.0](https://github.com/santifer/career-ops/compare/v1.3.0...v1.4.0) (2026-04-13)


### Features

* add GitHub Actions CI + auto-labeler + welcome bot + /run skill ([2ddf22a](https://github.com/santifer/career-ops/commit/2ddf22a6a2731b38bcaed5786c4855c4ab9fe722))
* **dashboard:** add Catppuccin Latte light theme with auto-detection ([ff686c8](https://github.com/santifer/career-ops/commit/ff686c8af97a7bf93565fe8eeac677f998cc9ece))
* **dashboard:** add progress analytics screen ([623c837](https://github.com/santifer/career-ops/commit/623c837bf3155fd5b7413554240071d40585dd7e))
* **dashboard:** add vim motions to pipeline screen ([#262](https://github.com/santifer/career-ops/issues/262)) ([d149e54](https://github.com/santifer/career-ops/commit/d149e541402db0c88161a71c73899cd1836a1b2d))
* **dashboard:** aligned tables and markdown syntax rendering in viewer ([dbd1d3f](https://github.com/santifer/career-ops/commit/dbd1d3f7177358d0384d6e661d1b0dfc1f60bd4e))


### Bug Fixes

* **ci:** use pull_request_target for labeler on fork PRs ([#260](https://github.com/santifer/career-ops/issues/260)) ([2ecf572](https://github.com/santifer/career-ops/commit/2ecf57206c2eb6e35e2a843d6b8365f7a04c53d6))
* correct _shared.md → _profile.md reference in CUSTOMIZATION.md (closes [#137](https://github.com/santifer/career-ops/issues/137)) ([a91e264](https://github.com/santifer/career-ops/commit/a91e264b6ea047a76d8c033aa564fe01b8f9c1d9))
* replace grep -P with POSIX-compatible grep in batch-runner.sh ([637b39e](https://github.com/santifer/career-ops/commit/637b39e383d1174c8287f42e9534e9e3cdfabb19))
* test-all.mjs scans only git-tracked files, avoids false positives ([47c9f98](https://github.com/santifer/career-ops/commit/47c9f984d8ddc70974f15c99b081667b73f1bb9a))
* use execFileSync to prevent shell injection in test-all.mjs ([c99d5a6](https://github.com/santifer/career-ops/commit/c99d5a6526f923b56c3790b79b0349f402fa00e2))
