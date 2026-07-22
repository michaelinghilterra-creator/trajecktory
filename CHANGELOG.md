# Changelog

## [1.23.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.23.0...v1.23.1) (2026-07-22)


### Bug Fixes

* **audit:** match a lost report to its TSV by company, not just by number ([#82](https://github.com/michaelinghilterra-creator/trajecktory/issues/82)) ([0798ae7](https://github.com/michaelinghilterra-creator/trajecktory/commit/0798ae7869358a9775d369f591d7091c9aa1949f))
* **identity:** route the last callers through one posting identity ([#84](https://github.com/michaelinghilterra-creator/trajecktory/issues/84)) ([979d01d](https://github.com/michaelinghilterra-creator/trajecktory/commit/979d01d6e9597162d84b719e5a10b3489a2e523a))

## [1.23.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.22.0...v1.23.0) (2026-07-22)


### Features

* **doctor:** report evaluations that have no tracker row ([#81](https://github.com/michaelinghilterra-creator/trajecktory/issues/81)) ([a822db0](https://github.com/michaelinghilterra-creator/trajecktory/commit/a822db0220956d72a27e07162fc492b3d69c525f))
* **tracker:** backfill evaluated URLs into the tracker ([#78](https://github.com/michaelinghilterra-creator/trajecktory/issues/78)) ([244715a](https://github.com/michaelinghilterra-creator/trajecktory/commit/244715a674c05f52d2d1823912fcbb8359a1177b))


### Bug Fixes

* **merge:** stop dropping distinct postings that share a job title ([#80](https://github.com/michaelinghilterra-creator/trajecktory/issues/80)) ([08520b0](https://github.com/michaelinghilterra-creator/trajecktory/commit/08520b0f90aff78541ebb45b5716ea9030802335))

## [1.22.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.21.0...v1.22.0) (2026-07-22)


### Bug Fixes

* **identity:** make one canonical URL the only answer to "is this the same posting?" ([#75](https://github.com/michaelinghilterra-creator/trajecktory/issues/75)) ([7f11078](https://github.com/michaelinghilterra-creator/trajecktory/commit/7f110785dd2e290c5ecfaef54d2dfe02215e654b))


### Documentation

* **agents:** record the squash-title version trap ([#77](https://github.com/michaelinghilterra-creator/trajecktory/issues/77)) ([cb220c0](https://github.com/michaelinghilterra-creator/trajecktory/commit/cb220c0faa37edc19e9bb2ed612a9ee1073a04e3))

## [1.21.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.20.1...v1.21.0) (2026-07-22)


### Features

* **setup:** record where setup time goes, and make a poisoned config recoverable ([#73](https://github.com/michaelinghilterra-creator/trajecktory/issues/73)) ([59f7f95](https://github.com/michaelinghilterra-creator/trajecktory/commit/59f7f95967812f8de4cc33d0f29ca4b0d438f616))

## [1.20.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.20.0...v1.20.1) (2026-07-22)


### Bug Fixes

* **setup:** scroll the panel into view, case place names, capitalise paired labels ([#71](https://github.com/michaelinghilterra-creator/trajecktory/issues/71)) ([a8741ef](https://github.com/michaelinghilterra-creator/trajecktory/commit/a8741efca97f64821e17ab022bfa7afef3a23593))

## [1.20.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.19.0...v1.20.0) (2026-07-22)


### Features

* **dashboard:** keep the job posting, surface unprepped interviews, and finish the setup forms ([#69](https://github.com/michaelinghilterra-creator/trajecktory/issues/69)) ([065c65a](https://github.com/michaelinghilterra-creator/trajecktory/commit/065c65a2eb29bc7bb68ce2f289ee0566b01e7b7d))

## [1.19.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.18.0...v1.19.0) (2026-07-21)


### Features

* **dashboard:** explain the score, signpost setup, and close a leak-gate gap ([#67](https://github.com/michaelinghilterra-creator/trajecktory/issues/67)) ([ee974fa](https://github.com/michaelinghilterra-creator/trajecktory/commit/ee974fa7dcb77943d0b5d117554f53a7954a9600))

## [1.18.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.17.7...v1.18.0) (2026-07-21)


### Features

* **onboarding:** answer "so what?" on every setup step ([#65](https://github.com/michaelinghilterra-creator/trajecktory/issues/65)) ([376c3ac](https://github.com/michaelinghilterra-creator/trajecktory/commit/376c3ac14db139a81214c59a137048ded09803af))
* **onboarding:** make a new user's first run actually produce results ([#64](https://github.com/michaelinghilterra-creator/trajecktory/issues/64)) ([590c101](https://github.com/michaelinghilterra-creator/trajecktory/commit/590c101227ed569fa5751b29bfa10a36af657bb1))


### Bug Fixes

* block agent runs when the workspace is untrusted ([#62](https://github.com/michaelinghilterra-creator/trajecktory/issues/62)) ([e4ef318](https://github.com/michaelinghilterra-creator/trajecktory/commit/e4ef3185778f9c50e7230f51161a982dbba72bf9))
* **setup:** stop labelling generated search words as titles ([#66](https://github.com/michaelinghilterra-creator/trajecktory/issues/66)) ([bb0a4ed](https://github.com/michaelinghilterra-creator/trajecktory/commit/bb0a4edebc902ebd8492a0bf41d6d3d62a2d2e57))

## [1.17.7](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.17.6...v1.17.7) (2026-07-21)


### Bug Fixes

* **ci:** rename release SBOM asset to trajecktory-source-sbom.spdx.json ([#57](https://github.com/michaelinghilterra-creator/trajecktory/issues/57)) ([c6c86b0](https://github.com/michaelinghilterra-creator/trajecktory/commit/c6c86b08c9c0c933359799d51531eb12696af5eb))
* **installer:** bump bundled Git for Windows to 2.55.0(3) ([#56](https://github.com/michaelinghilterra-creator/trajecktory/issues/56)) ([09a7f7a](https://github.com/michaelinghilterra-creator/trajecktory/commit/09a7f7a32b9eba37f4e3f3c3cfe456e9a1b7a005))
* **installer:** make the bundled payload's origin fetch-only ([#54](https://github.com/michaelinghilterra-creator/trajecktory/issues/54)) ([fb9a2ca](https://github.com/michaelinghilterra-creator/trajecktory/commit/fb9a2cae366aedde001b03b770469667205513f7))
* **installer:** move bundled Node to 24.18.0 LTS off EOL 20.x ([#58](https://github.com/michaelinghilterra-creator/trajecktory/issues/58)) ([1d19b94](https://github.com/michaelinghilterra-creator/trajecktory/commit/1d19b94e30414e1c5ea0dc467ebb032ab2e97d27))

## [1.17.6](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.17.5...v1.17.6) (2026-07-21)


### Bug Fixes

* **discover:** dedupe tracked companies by name, not ATS slug alone ([#45](https://github.com/michaelinghilterra-creator/trajecktory/issues/45)) ([a489009](https://github.com/michaelinghilterra-creator/trajecktory/commit/a4890095ffcaba37abc8f1f0c21ff9b500351de4))
* **runsheet:** align documented panic-net answer key with the worked example ([#44](https://github.com/michaelinghilterra-creator/trajecktory/issues/44)) ([caebd8c](https://github.com/michaelinghilterra-creator/trajecktory/commit/caebd8c5bc32c35b2e1f0348fafe3ca71901e932))

## [1.17.5](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.17.4...v1.17.5) (2026-07-20)


### Bug Fixes

* **dashboard:** render release-note paragraphs as prose, not bullets ([#42](https://github.com/michaelinghilterra-creator/trajecktory/issues/42)) ([16c53d8](https://github.com/michaelinghilterra-creator/trajecktory/commit/16c53d8b9ee367ff841df30d7ee4e5d61b324ea0))
* **dashboard:** stop sentence-casing the brand in release notes ([#40](https://github.com/michaelinghilterra-creator/trajecktory/issues/40)) ([c87e7fa](https://github.com/michaelinghilterra-creator/trajecktory/commit/c87e7fafeebdf02d8892e1d0012c7489a3af6bae))

## [1.17.4](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.17.3...v1.17.4) (2026-07-20)


### Bug Fixes

* close interview-surface data leaks and ship mode fixes to installs ([#36](https://github.com/michaelinghilterra-creator/trajecktory/issues/36)) ([3484329](https://github.com/michaelinghilterra-creator/trajecktory/commit/348432966edeb6a92775bbdc2451627c456aa997))

## [1.17.3](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.17.2...v1.17.3) (2026-07-20)


### Bug Fixes

* keep tracker rows at 10 columns when a field contains a pipe ([e59f3cd](https://github.com/michaelinghilterra-creator/trajecktory/commit/e59f3cdea62a23c922f9020460a63f5e0c1747bd))
* read and write tracker rows through lib/tracker.mjs in the rewrite scripts ([e648227](https://github.com/michaelinghilterra-creator/trajecktory/commit/e6482276e86d230ccb119d8c2eeb814b01f08da4))

## [1.17.2](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.17.1...v1.17.2) (2026-07-20)


### Bug Fixes

* **dashboard:** show written release notes in the update banner too ([c905d13](https://github.com/michaelinghilterra-creator/trajecktory/commit/c905d133e17e144e1f73683c1065d3e9c60a96ea))

## [1.17.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.17.0...v1.17.1) (2026-07-20)


### Bug Fixes

* **dashboard:** show written release notes in the Change Log, not commit subjects ([36f14c8](https://github.com/michaelinghilterra-creator/trajecktory/commit/36f14c8dda7b1a70f523fb693720f92ea6504eb4))

## [1.17.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.16.2...v1.17.0) (2026-07-20)


### Features

* **dashboard:** record real status-change dates and unify metric definitions ([8500c15](https://github.com/michaelinghilterra-creator/trajecktory/commit/8500c1509165d3b8c082fe6408fc4a09f5b76edc))
* **verify-no-pii:** flag a tracker company named beside an outreach verb ([bacbf2c](https://github.com/michaelinghilterra-creator/trajecktory/commit/bacbf2cba409c0b5691dfe44ca39e597aaad3d37))


### Bug Fixes

* archive-ghosted wrote every status event twice ([8500c15](https://github.com/michaelinghilterra-creator/trajecktory/commit/8500c1509165d3b8c082fe6408fc4a09f5b76edc))

## [1.16.2](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.16.1...v1.16.2) (2026-07-20)


### Bug Fixes

* **linkedin-ssi:** bound the CSV import loop ([fd84ea0](https://github.com/michaelinghilterra-creator/trajecktory/commit/fd84ea0978e284fec620f95e58159f1bb248318f))
* **linkedin-ssi:** stop inventing a score, and make the tab possible to populate ([e98c43b](https://github.com/michaelinghilterra-creator/trajecktory/commit/e98c43b7842d6329c8fca94a3b60d21d187398b3))
* **linkedin-ssi:** stop inventing a score, and make the tab possible to populate ([360de8d](https://github.com/michaelinghilterra-creator/trajecktory/commit/360de8d36e50ebe4cf292be4173b3dd70a9849b7))
* **recruiters:** make the two dead controls on the landing views work ([9095907](https://github.com/michaelinghilterra-creator/trajecktory/commit/9095907638bc34a9b895bdc5c344c0727e64fabd))
* **recruiters:** make the two dead controls on the landing views work ([d3caf26](https://github.com/michaelinghilterra-creator/trajecktory/commit/d3caf2650ec8fa5aabc4ce79ce867933d0152149))
* **target-talent:** remove the Reconcile Undo that never undid anything ([b450c63](https://github.com/michaelinghilterra-creator/trajecktory/commit/b450c6346bd6b73ed21aad07aca286a8cf9ee813))
* **target-talent:** remove the Reconcile Undo that never undid anything ([dfb3325](https://github.com/michaelinghilterra-creator/trajecktory/commit/dfb3325708e65eaf808659f0cfcc4cb95065093b))

## [1.16.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.16.0...v1.16.1) (2026-07-19)


### Bug Fixes

* **security:** pass git arguments as argv, not interpolated into a shell ([0f82392](https://github.com/michaelinghilterra-creator/trajecktory/commit/0f8239208109412275bec2e5b25ae5aad886c13f))

## [1.16.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.15.1...v1.16.0) (2026-07-19)


### Features

* **interview:** sectioned prep view, offline printing, and company documents ([10b43b6](https://github.com/michaelinghilterra-creator/trajecktory/commit/10b43b69614a587d05799d4f22d3ca50ee50f392))
* **security:** add a pre-commit hook gating staged file content ([58b2661](https://github.com/michaelinghilterra-creator/trajecktory/commit/58b26619f8aa3a7d1318619732b621b57cf66572))


### Bug Fixes

* **deps:** upgrade adm-zip to 0.6.0 to clear GHSA-xcpc-8h2w-3j85 ([189cf35](https://github.com/michaelinghilterra-creator/trajecktory/commit/189cf35c6afcd445d5dc79d8a408b9066e9e6c16))
* **lint:** attach cause to the run-sheet frontmatter error ([f2f641a](https://github.com/michaelinghilterra-creator/trajecktory/commit/f2f641adbb8e15f69dce9706abf05ea35b565cce))
* **privacy:** use invented content in shipped examples, not a scrubbed real one ([d342c6b](https://github.com/michaelinghilterra-creator/trajecktory/commit/d342c6b0bbd75ddd07af42a5f0a6e14ca68bb267))
* **runsheet:** parse CRLF frontmatter, and pin run sheets to LF ([f990769](https://github.com/michaelinghilterra-creator/trajecktory/commit/f9907692c9ed529a9b1491b5a5dc1f8e77368bc6))
* **verify:** check the shipped run-sheet example, not just user boards ([f03bf95](https://github.com/michaelinghilterra-creator/trajecktory/commit/f03bf956d7b38552404cdc491b4c004ae328352a))

## [1.15.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.14.1...v1.15.0) (2026-07-17)


### Features

* maintenance and hardening release: strengthened the personal-data ship gate (now covers commit messages, CV content, profile values, and report-path correspondence, with a derivation-health self-check), and the self-update now removes stale content-matched files from existing installs. Update recommended for all installs.

## [1.14.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.14.0...v1.14.1) (2026-07-16)


### Bug Fixes

* **discover:** make writePortals line-ending tolerant; ship discovery scripts in self-update ([9756566](https://github.com/michaelinghilterra-creator/trajecktory/commit/9756566d9211a195da44d88d84ee5f4aef480bbb))
* **gate:** resolve Workday job liveness via CXS API instead of Playwright ([8ec7522](https://github.com/michaelinghilterra-creator/trajecktory/commit/8ec7522c670e4be9e1fd73faa7d84d2f4a028b15))
* **merge:** tighten role match and dedup additions within a batch ([654c076](https://github.com/michaelinghilterra-creator/trajecktory/commit/654c0760af987f595187827c93631b27f7dc13de))
* **scan:** fold spelled-out 'Vice President' into 'vp' in title normalization ([c5bfe38](https://github.com/michaelinghilterra-creator/trajecktory/commit/c5bfe389be1662b4b2a158bcbb8737faf977cc69))
* **scan:** preserve gh_jid job id in normalizeUrl dedup key ([2759b87](https://github.com/michaelinghilterra-creator/trajecktory/commit/2759b87fdea60d09bf12ac493b9fe8ee9ab3d588))
* **scan:** treat city-less location strings as unknown, not blocked ([8c6a00c](https://github.com/michaelinghilterra-creator/trajecktory/commit/8c6a00ccb45096670d635e14dea5141244346dc0))

## [1.14.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.13.0...v1.14.0) (2026-07-14)


### Features

* **build:** gate installer payload on interview-prep layout ([d8157d8](https://github.com/michaelinghilterra-creator/trajecktory/commit/d8157d8724777fbf2a97d30cc8e3ec11f9a53b7e))
* **interview-prep:** add organize-interview-prep.mjs backstop ([41ddf48](https://github.com/michaelinghilterra-creator/trajecktory/commit/41ddf485fcb7a3002049c4e3c7cebe00de3d9a20))
* **interview-prep:** file cheat sheets into per-company subfolders ([ad30cb0](https://github.com/michaelinghilterra-creator/trajecktory/commit/ad30cb0fedc7742c1381cddc1736d8956280ff7a))


### Bug Fixes

* **dashboard:** write cadence log entries into a fresh object literal ([20dbb7d](https://github.com/michaelinghilterra-creator/trajecktory/commit/20dbb7d6b66679f141fea6f45e7e6c77aa1f61ec))

## [1.13.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.12.0...v1.13.0) (2026-07-13)


### Features

* **dashboard:** add Today tab for daily cadence, pomodoro, and to-dos ([a883a50](https://github.com/michaelinghilterra-creator/trajecktory/commit/a883a5079731e55271a8e0cbb746e6a50e522cc3))
* **dashboard:** two-column Today with editable to-dos and notes previews ([ee76357](https://github.com/michaelinghilterra-creator/trajecktory/commit/ee76357440d37bc191555d1879f89e7270a4800f))


### Bug Fixes

* **dashboard:** guard cadence taskId and de-taint the pitch system prompt ([391e01c](https://github.com/michaelinghilterra-creator/trajecktory/commit/391e01c44edf4d6cb1e6307b89cc071774594f3b))
* **dashboard:** honest billing display; never route triage/scan to API key ([db9243d](https://github.com/michaelinghilterra-creator/trajecktory/commit/db9243db1bbb7589ef2788df3831c232db396f5b))
* **next-jd:** scan the merged tracker-additions archive for the id floor ([e056666](https://github.com/michaelinghilterra-creator/trajecktory/commit/e056666f4b114d26697ea3bc3cb12119fdadcc0a))
* persist triage card dismissals server-side ([3b2f450](https://github.com/michaelinghilterra-creator/trajecktory/commit/3b2f45082647a06c3dfef6c3db3eb3a0b12d6c00))

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
