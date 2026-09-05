# Changelog

## [3.3.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v3.3.0...v3.3.1) (2026-09-05)


### Bug Fixes

* **dashboard:** harden debrief detection, fix bounce flip, split reconcile, remove overdue pill ([#279](https://github.com/michaelinghilterra-creator/trajecktory/issues/279)) ([5732e0f](https://github.com/michaelinghilterra-creator/trajecktory/commit/5732e0f33b2064c994133206b7166324b95d6209))

## [3.3.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v3.2.1...v3.3.0) (2026-09-05)


### Features

* **dashboard:** add persistent server logging and crash diagnostics ([#277](https://github.com/michaelinghilterra-creator/trajecktory/issues/277)) ([bae2b5d](https://github.com/michaelinghilterra-creator/trajecktory/commit/bae2b5dfa21688a927d62cac7e5967cbcbc46651))

## [3.2.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v3.2.0...v3.2.1) (2026-09-03)


### Bug Fixes

* **dashboard:** remove unused columns from Pipeline, TA Outreach, and Decision Makers tables ([#275](https://github.com/michaelinghilterra-creator/trajecktory/issues/275)) ([a7dfafe](https://github.com/michaelinghilterra-creator/trajecktory/commit/a7dfafe9510bd14861820cd3b68ed6092253c6ac))

## [3.2.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v3.1.0...v3.2.0) (2026-09-02)


### Features

* Customize subtab, outreach/interview fixes, and prototype-pollution security patch ([#272](https://github.com/michaelinghilterra-creator/trajecktory/issues/272)) ([e16aade](https://github.com/michaelinghilterra-creator/trajecktory/commit/e16aade7dc8cb7f0c65b982b47ba6675dff4ff1a))

## [3.1.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v3.0.1...v3.1.0) (2026-09-01)


### Features

* harden Network tab contact search targeting and consumption ([#270](https://github.com/michaelinghilterra-creator/trajecktory/issues/270)) ([c735b6e](https://github.com/michaelinghilterra-creator/trajecktory/commit/c735b6ee612b6fe66bbef7451fd7dcfd025887a1))

## [3.0.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v3.0.0...v3.0.1) (2026-08-30)


### Bug Fixes

* align follow-up email ask with LinkedIn prompt (no meeting ask) ([#268](https://github.com/michaelinghilterra-creator/trajecktory/issues/268)) ([830958b](https://github.com/michaelinghilterra-creator/trajecktory/commit/830958ba5ef460f90469064855634777060fdb2b))
* count all LinkedIn connects in the Activity Tracker ([#267](https://github.com/michaelinghilterra-creator/trajecktory/issues/267)) ([b8547bb](https://github.com/michaelinghilterra-creator/trajecktory/commit/b8547bb5dadc565559b1a5e09c94e6d4f9a166ca))

## [3.0.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.44.0...v3.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* two canonical application states (Responded, 4th Interview) are removed from templates/states.yml. Existing rows are auto-migrated by normalize-statuses; downstream tooling that hardcodes those labels should read the states file instead.

### Features

* beta-tester feedback across pipeline stages, reconcile, referrals, discovery, and Today ([#265](https://github.com/michaelinghilterra-creator/trajecktory/issues/265)) ([b4e34d5](https://github.com/michaelinghilterra-creator/trajecktory/commit/b4e34d523f0951d03923c452582784f1edf0d3eb))

## [2.44.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.43.0...v2.44.0) (2026-08-27)


### Features

* Obsidian batch-eval prep/postfix scripts and bounce-apply cursor fix ([#263](https://github.com/michaelinghilterra-creator/trajecktory/issues/263)) ([56242d6](https://github.com/michaelinghilterra-creator/trajecktory/commit/56242d618b82c2fce254e692021ebcd4d5721e06))

## [2.43.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.42.0...v2.43.0) (2026-08-25)


### Features

* LinkedIn draft intent tuning and in-place contact drawer for follow-ups ([#261](https://github.com/michaelinghilterra-creator/trajecktory/issues/261)) ([45b4524](https://github.com/michaelinghilterra-creator/trajecktory/commit/45b452482684d1a56faa98f01d577c00fd8944ac))

## [2.42.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.41.0...v2.42.0) (2026-08-25)


### Features

* widen outreach cadence and fix follow-up queue surfacing ([#259](https://github.com/michaelinghilterra-creator/trajecktory/issues/259)) ([592e38a](https://github.com/michaelinghilterra-creator/trajecktory/commit/592e38aa024d7b8c5da9bb088bcf6a999f614099))

## [2.41.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.40.0...v2.41.0) (2026-08-24)


### Features

* run contact discovery in the background, and share one implementation ([#257](https://github.com/michaelinghilterra-creator/trajecktory/issues/257)) ([5b9e33d](https://github.com/michaelinghilterra-creator/trajecktory/commit/5b9e33d6e896a7ac70a6fe884433acf45278c82c))

## [2.40.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.39.0...v2.40.0) (2026-08-24)


### Features

* make the contact book tell the truth about who has been reached ([#255](https://github.com/michaelinghilterra-creator/trajecktory/issues/255)) ([079ea16](https://github.com/michaelinghilterra-creator/trajecktory/commit/079ea163f6f1eadf26e80a24da215492c2614ca9))
* validate report frontmatter at write time ([#254](https://github.com/michaelinghilterra-creator/trajecktory/issues/254)) ([c8dd351](https://github.com/michaelinghilterra-creator/trajecktory/commit/c8dd351f7bf513c96b76eb371d32118b7b6b67e1))

## [2.39.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.38.1...v2.39.0) (2026-08-24)


### Features

* check the ship gate's blind spots and make a failed preflight diagnosable ([#252](https://github.com/michaelinghilterra-creator/trajecktory/issues/252)) ([78efc4b](https://github.com/michaelinghilterra-creator/trajecktory/commit/78efc4b30d9be3f351344bddf8a97c5b1f399b39))

## [2.38.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.38.0...v2.38.1) (2026-08-24)


### Bug Fixes

* reject a crafted message id before it can steer a Gmail request ([#250](https://github.com/michaelinghilterra-creator/trajecktory/issues/250)) ([f203dd3](https://github.com/michaelinghilterra-creator/trajecktory/commit/f203dd3af693e2b59d53726f9f32b69e2fc486a2))

## [2.38.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.37.1...v2.38.0) (2026-08-24)


### Features

* rank and source contacts by their influence over a hire ([#248](https://github.com/michaelinghilterra-creator/trajecktory/issues/248)) ([edbac39](https://github.com/michaelinghilterra-creator/trajecktory/commit/edbac391292150ea0a8a1bd50eae5415276b1192))

## [2.37.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.37.0...v2.37.1) (2026-08-24)


### Bug Fixes

* classify scanner-found roles correctly and parse legacy report briefs ([#246](https://github.com/michaelinghilterra-creator/trajecktory/issues/246)) ([93281e6](https://github.com/michaelinghilterra-creator/trajecktory/commit/93281e67f8bdc8d2d3a12b9248418e8b6721fc87))

## [2.37.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.36.1...v2.37.0) (2026-08-23)


### Features

* instrument the follow-up split test and the scan-found weekly target ([#241](https://github.com/michaelinghilterra-creator/trajecktory/issues/241)) ([04a62e4](https://github.com/michaelinghilterra-creator/trajecktory/commit/04a62e4d3836fc9f02f0a1dd1b73a9fbf3bbf9c0))
* make the prep templates and the debrief capture the answer ([#242](https://github.com/michaelinghilterra-creator/trajecktory/issues/242)) ([a0c8399](https://github.com/michaelinghilterra-creator/trajecktory/commit/a0c839951054bd70c270aa347dc624a19ef0982b))
* replace average days to rejection with metrics that measure progress ([#238](https://github.com/michaelinghilterra-creator/trajecktory/issues/238)) ([0119a48](https://github.com/michaelinghilterra-creator/trajecktory/commit/0119a481a8d3e60165f4534039cb887ed7d10e2a))
* score how much hands-on building a req demands, and cap when it does ([#235](https://github.com/michaelinghilterra-creator/trajecktory/issues/235)) ([e8289ac](https://github.com/michaelinghilterra-creator/trajecktory/commit/e8289ac96e72aec245ea229c530fd8a9b6513f94))
* stand down the X channel and keep its published posts as history ([#239](https://github.com/michaelinghilterra-creator/trajecktory/issues/239)) ([9db9c74](https://github.com/michaelinghilterra-creator/trajecktory/commit/9db9c742c3a96c1d980783f0bcf8573987d30517))
* stop grading influencer engagement as a search motion, keep the asset ([#240](https://github.com/michaelinghilterra-creator/trajecktory/issues/240)) ([51d3185](https://github.com/michaelinghilterra-creator/trajecktory/commit/51d318595b7ddc588f352c2ac415929ee79c8634))


### Bug Fixes

* give the score-drift guard a recovery that actually works ([#245](https://github.com/michaelinghilterra-creator/trajecktory/issues/245)) ([c11ac31](https://github.com/michaelinghilterra-creator/trajecktory/commit/c11ac312d961bc154fcb9d37012992f717e70146))
* put the ghosted-candidate gate on the one shared apply anchor ([#244](https://github.com/michaelinghilterra-creator/trajecktory/issues/244)) ([4fd8696](https://github.com/michaelinghilterra-creator/trajecktory/commit/4fd869687cccc80bede14d95631695e9935bbd7c))
* route every discovery path through the shared title matcher ([#234](https://github.com/michaelinghilterra-creator/trajecktory/issues/234)) ([7f1dff7](https://github.com/michaelinghilterra-creator/trajecktory/commit/7f1dff7548d7edfeb2b9b6945782a813a32c24b2))
* stop the sync-cursor reader from silently deleting keys it does not know ([#243](https://github.com/michaelinghilterra-creator/trajecktory/issues/243)) ([47f80e3](https://github.com/michaelinghilterra-creator/trajecktory/commit/47f80e33da6d3ddb6a00570c38c8588f5815c85b))
* store the whole inbound reply, not the first 200 characters ([#237](https://github.com/michaelinghilterra-creator/trajecktory/issues/237)) ([5b723dd](https://github.com/michaelinghilterra-creator/trajecktory/commit/5b723dd9131a71c4cd338b973c46cc5947a58a3e))

## [2.36.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.36.0...v2.36.1) (2026-08-23)


### Bug Fixes

* match ranked titles when a qualifier sits between the words ([#230](https://github.com/michaelinghilterra-creator/trajecktory/issues/230)) ([f72f400](https://github.com/michaelinghilterra-creator/trajecktory/commit/f72f400ea0f3b59fc3f76352038e9049d58d97de))

## [2.36.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.35.0...v2.36.0) (2026-08-23)


### Features

* add referral conversion KPI and fix free-DM detection for referrals ([#228](https://github.com/michaelinghilterra-creator/trajecktory/issues/228)) ([8d918d9](https://github.com/michaelinghilterra-creator/trajecktory/commit/8d918d9d7275dc3c6ece695e0774307eceace41b))

## [2.35.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.34.0...v2.35.0) (2026-08-23)


### Features

* make the follow-up queue a worklist again ([#226](https://github.com/michaelinghilterra-creator/trajecktory/issues/226)) ([f31ec1d](https://github.com/michaelinghilterra-creator/trajecktory/commit/f31ec1da57c39fba6c30453246855c14b3d7073a))

## [2.34.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.33.1...v2.34.0) (2026-08-23)


### Features

* unify contacts into one person record with outreach guardrails ([#223](https://github.com/michaelinghilterra-creator/trajecktory/issues/223)) ([71422ff](https://github.com/michaelinghilterra-creator/trajecktory/commit/71422ffaee2d27bc5e83e2f2a99a107c37d9dfc3))

## [2.33.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.33.0...v2.33.1) (2026-08-23)


### Bug Fixes

* escape the env-key name in writeEnvKey's line matcher (regex injection) ([#221](https://github.com/michaelinghilterra-creator/trajecktory/issues/221)) ([b91b386](https://github.com/michaelinghilterra-creator/trajecktory/commit/b91b386a8ff5d6c2dc7ab6b29c61ed17a9bf8a4a))

## [2.33.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.32.0...v2.33.0) (2026-08-23)


### Features

* one-click rolling Evaluate with spend gate, live meter, retry, and non-blocking concurrency ([#219](https://github.com/michaelinghilterra-creator/trajecktory/issues/219)) ([c25e0c3](https://github.com/michaelinghilterra-creator/trajecktory/commit/c25e0c3b66718cb2592caea483605bdb718d5606))

## [2.32.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.31.1...v2.32.0) (2026-08-22)


### Features

* log scanner rejects and per-company coverage outcomes ([#214](https://github.com/michaelinghilterra-creator/trajecktory/issues/214)) ([9cb58d9](https://github.com/michaelinghilterra-creator/trajecktory/commit/9cb58d924c9de25e010a3c4862454e42029fe894))
* single-rail billing, honest labels, and model version pinning ([#217](https://github.com/michaelinghilterra-creator/trajecktory/issues/217)) ([1ee0b7b](https://github.com/michaelinghilterra-creator/trajecktory/commit/1ee0b7be725017c4c34ed69caa94cc1b40f4aa70))


### Bug Fixes

* raise auto-discard threshold to &lt; 3.0 with a broken-eval retry guard ([#216](https://github.com/michaelinghilterra-creator/trajecktory/issues/216)) ([d961d4d](https://github.com/michaelinghilterra-creator/trajecktory/commit/d961d4d27de431bfb4fbdcd46a8fce5c6c8fca31))
* stop the "associate" negative from vetoing Associate Director titles ([#215](https://github.com/michaelinghilterra-creator/trajecktory/issues/215)) ([df75555](https://github.com/michaelinghilterra-creator/trajecktory/commit/df755552b4b01b6cd050b78187a948eb7930be8b))

## [2.31.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.31.0...v2.31.1) (2026-08-22)


### Bug Fixes

* dedupe LinkedIn referral imports on a canonical profile URL ([#212](https://github.com/michaelinghilterra-creator/trajecktory/issues/212)) ([d08ccc0](https://github.com/michaelinghilterra-creator/trajecktory/commit/d08ccc097c901276a58d269fef8f83a0f6b3f94b))

## [2.31.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.30.0...v2.31.0) (2026-08-21)


### Features

* Follow-Ups queue accuracy, sent-invites reconcile, and Agent Scan hardening ([#210](https://github.com/michaelinghilterra-creator/trajecktory/issues/210)) ([4fce2ce](https://github.com/michaelinghilterra-creator/trajecktory/commit/4fce2ce695aa91c9c1a7b0491f991ad328a125b4))

## [2.30.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.29.1...v2.30.0) (2026-08-20)


### Features

* unify Contacts into one follow-up queue with acceptance-aware, capped outreach ([#208](https://github.com/michaelinghilterra-creator/trajecktory/issues/208)) ([1a193fb](https://github.com/michaelinghilterra-creator/trajecktory/commit/1a193fb3ff09d8d6b058bd1c235048006e2f0f68))

## [2.29.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.29.0...v2.29.1) (2026-08-19)


### Bug Fixes

* **batch:** don't title-cap Manager+ roles; repoint eval archetypes to profile.yml ([#206](https://github.com/michaelinghilterra-creator/trajecktory/issues/206)) ([68ab8aa](https://github.com/michaelinghilterra-creator/trajecktory/commit/68ab8aa7cc037c8905eb8a53c38710220dcbc1f9))

## [2.29.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.28.0...v2.29.0) (2026-08-17)


### Features

* Follow-Ups alert count reflects what you can act on now ([#204](https://github.com/michaelinghilterra-creator/trajecktory/issues/204)) ([e19f165](https://github.com/michaelinghilterra-creator/trajecktory/commit/e19f16595fd163e61fde947e5730c370c1639db7))

## [2.28.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.27.0...v2.28.0) (2026-08-17)


### Features

* smarter Follow-Ups queue (real follow-up messages, same-day hold, InMail budget) ([#202](https://github.com/michaelinghilterra-creator/trajecktory/issues/202)) ([1505f76](https://github.com/michaelinghilterra-creator/trajecktory/commit/1505f76758daf36d03cdaed03360401ce42dd845))


### Bug Fixes

* never downgrade Manager+ titles on the level score ([#201](https://github.com/michaelinghilterra-creator/trajecktory/issues/201)) ([71be61e](https://github.com/michaelinghilterra-creator/trajecktory/commit/71be61e0f907a92c5403c3fab2eb628f76d7f2e5))

## [2.27.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.26.0...v2.27.0) (2026-08-16)


### Features

* unify Follow-Ups into one contacts-only source of truth ([#199](https://github.com/michaelinghilterra-creator/trajecktory/issues/199)) ([6c99dea](https://github.com/michaelinghilterra-creator/trajecktory/commit/6c99dea4aabc564a12a893802130772021b4ae81))

## [2.26.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.25.1...v2.26.0) (2026-08-15)


### Features

* unify contacts into one shared card and streamline follow-ups ([#197](https://github.com/michaelinghilterra-creator/trajecktory/issues/197)) ([e455dc5](https://github.com/michaelinghilterra-creator/trajecktory/commit/e455dc51fd51cbbf8696f4ec6491de826865e9a7))

## [2.25.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.25.0...v2.25.1) (2026-08-14)


### Bug Fixes

* **triage:** resolve local:jds snapshots against the repo root, not data/jds ([#195](https://github.com/michaelinghilterra-creator/trajecktory/issues/195)) ([ef8c658](https://github.com/michaelinghilterra-creator/trajecktory/commit/ef8c658554419a7093500676a289581c3afebee9))

## [2.25.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.24.0...v2.25.0) (2026-08-14)


### Features

* **style:** plain-language flags + fold word choice into the revise pass ([#193](https://github.com/michaelinghilterra-creator/trajecktory/issues/193)) ([a68c68c](https://github.com/michaelinghilterra-creator/trajecktory/commit/a68c68c87dd9e91122284fa99cf6ea98f7eb74ed))

## [2.24.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.23.0...v2.24.0) (2026-08-14)


### Features

* rework the job-discovery funnel end to end ([#191](https://github.com/michaelinghilterra-creator/trajecktory/issues/191)) ([ef3c430](https://github.com/michaelinghilterra-creator/trajecktory/commit/ef3c430cde490c000054f759b6fbc1e1acb0c1a5))

## [2.23.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.22.0...v2.23.0) (2026-08-14)


### Features

* **cadence:** resume rhythm flag + coach on the Launchpad ([#189](https://github.com/michaelinghilterra-creator/trajecktory/issues/189)) ([290d9c6](https://github.com/michaelinghilterra-creator/trajecktory/commit/290d9c6636ce97e44585745ad43bf101f37f9a16))

## [2.22.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.21.0...v2.22.0) (2026-08-14)


### Features

* **cadence:** auto-revise generated drafts for varied sentence rhythm ([#187](https://github.com/michaelinghilterra-creator/trajecktory/issues/187)) ([1a51c59](https://github.com/michaelinghilterra-creator/trajecktory/commit/1a51c59a21251b57a8b8e1e9d8e97cd0bddec2c8))

## [2.21.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.20.0...v2.21.0) (2026-08-12)


### Features

* **hygiene:** text-hygiene layer across all generation surfaces ([#184](https://github.com/michaelinghilterra-creator/trajecktory/issues/184)) ([151f96c](https://github.com/michaelinghilterra-creator/trajecktory/commit/151f96c39ff5c72ef32cb4e2879a9f74bb3a84c3))

## [2.20.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.19.0...v2.20.0) (2026-08-12)


### Features

* **referrals:** structured LinkedIn/email columns, email enrichment, and a unified contact drawer ([#182](https://github.com/michaelinghilterra-creator/trajecktory/issues/182)) ([00834e5](https://github.com/michaelinghilterra-creator/trajecktory/commit/00834e5a7968dc346d1d5c8bb48379015fb47d13))

## [2.19.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.18.0...v2.19.0) (2026-08-11)


### Features

* unify Follow-Ups queue and Contacts table, add recruiter email verification ([#180](https://github.com/michaelinghilterra-creator/trajecktory/issues/180)) ([94ee26d](https://github.com/michaelinghilterra-creator/trajecktory/commit/94ee26db877110bb6fa46c6c871c07063ed46afc))

## [2.18.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.17.1...v2.18.0) (2026-08-11)


### Features

* sharpen analytics accuracy and cross-log TA outreach to the pipeline ([#178](https://github.com/michaelinghilterra-creator/trajecktory/issues/178)) ([4424ed3](https://github.com/michaelinghilterra-creator/trajecktory/commit/4424ed3396b778ec78764744f3cd9db31a8c5e2c))

## [2.17.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.17.0...v2.17.1) (2026-08-11)


### Bug Fixes

* treat junk local: urls as unresolvable so distinct postings can't collapse ([#176](https://github.com/michaelinghilterra-creator/trajecktory/issues/176)) ([c172a12](https://github.com/michaelinghilterra-creator/trajecktory/commit/c172a120d16d0095b74758c8137086cb5a0cedad))

## [2.17.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.16.1...v2.17.0) (2026-08-10)


### Features

* **activity-tracker:** rename TWC tab to Activity Tracker and split weekly counts by type ([#173](https://github.com/michaelinghilterra-creator/trajecktory/issues/173)) ([9c2cb6b](https://github.com/michaelinghilterra-creator/trajecktory/commit/9c2cb6b8aea5eb7e8b2c85d44afba336e314c614))
* **search:** add a universal top-bar search for contacts and companies ([#174](https://github.com/michaelinghilterra-creator/trajecktory/issues/174)) ([02fcb4c](https://github.com/michaelinghilterra-creator/trajecktory/commit/02fcb4c81a3f4c83ab73deaa2fe749c0226e39b5))

## [2.16.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.16.0...v2.16.1) (2026-08-10)


### Bug Fixes

* unblock Agent Scan discovery via server-side validated portal merge ([#171](https://github.com/michaelinghilterra-creator/trajecktory/issues/171)) ([2c29719](https://github.com/michaelinghilterra-creator/trajecktory/commit/2c297192cd3d183fe7e26f9dafac2e839427bf84))

## [2.16.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.15.1...v2.16.0) (2026-08-09)


### Features

* scan text inside PDF and Office documents in the PII gate ([#168](https://github.com/michaelinghilterra-creator/trajecktory/issues/168)) ([6e8a1c3](https://github.com/michaelinghilterra-creator/trajecktory/commit/6e8a1c3f1a653262d0fd06fef54a93a09054f76b))

## [2.15.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.15.0...v2.15.1) (2026-08-09)


### Bug Fixes

* check off triage-scored pipeline rows after every agent run ([#166](https://github.com/michaelinghilterra-creator/trajecktory/issues/166)) ([ee6dfda](https://github.com/michaelinghilterra-creator/trajecktory/commit/ee6dfdaf6a4ebaf159741d128481194f486a0bac))

## [2.15.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.14.0...v2.15.0) (2026-08-07)


### Features

* high-value (both-channel) contact queue, contact card, and outreach signals ([#163](https://github.com/michaelinghilterra-creator/trajecktory/issues/163)) ([d13b321](https://github.com/michaelinghilterra-creator/trajecktory/commit/d13b321d99cdf5d80ebdaa62178663201168ccbf))

## [2.14.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.13.0...v2.14.0) (2026-08-07)


### Features

* show git SHA next to the version in the sidebar (dev checkouts) ([#159](https://github.com/michaelinghilterra-creator/trajecktory/issues/159)) ([6d74de9](https://github.com/michaelinghilterra-creator/trajecktory/commit/6d74de95a428a977ea89de6d2d54ed2f4228e539))

## [2.13.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.12.5...v2.13.0) (2026-08-07)


### Features

* contact-centric multi-channel outreach engine ([#160](https://github.com/michaelinghilterra-creator/trajecktory/issues/160)) ([ca8e186](https://github.com/michaelinghilterra-creator/trajecktory/commit/ca8e1868c96940847990289378ac995dd42c25f2))

## [2.12.5](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.12.4...v2.12.5) (2026-08-07)


### Bug Fixes

* resolve all three jds/ snapshot URL header formats, not just the newest ([#156](https://github.com/michaelinghilterra-creator/trajecktory/issues/156)) ([90fcc36](https://github.com/michaelinghilterra-creator/trajecktory/commit/90fcc36c4282ad5eac730896935839f4d2fd9b9d))

## [2.12.4](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.12.3...v2.12.4) (2026-08-07)


### Bug Fixes

* make triage/liveness writes agent-proof and add durable audit trails ([#154](https://github.com/michaelinghilterra-creator/trajecktory/issues/154)) ([f32b612](https://github.com/michaelinghilterra-creator/trajecktory/commit/f32b612e8858c2730b87d7181b6927a0523f95e3))
* rewrite stale pipeline mode file and add a numbering drift guard ([#153](https://github.com/michaelinghilterra-creator/trajecktory/issues/153)) ([88cb88e](https://github.com/michaelinghilterra-creator/trajecktory/commit/88cb88eb0e13f1b5d2d2e8a4d37ee68f22bfe091))

## [2.12.3](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.12.2...v2.12.3) (2026-08-06)


### Bug Fixes

* make pipeline.md check-off single-source, CRLF-safe, and self-healing ([#151](https://github.com/michaelinghilterra-creator/trajecktory/issues/151)) ([f56783a](https://github.com/michaelinghilterra-creator/trajecktory/commit/f56783a6f635018b91606efafe6e8c0ca3198c16))

## [2.12.2](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.12.1...v2.12.2) (2026-08-05)


### Bug Fixes

* **dashboard:** show true billing in Models & Cost (agent steps run on Claude plan, not API) ([#149](https://github.com/michaelinghilterra-creator/trajecktory/issues/149)) ([d3a3061](https://github.com/michaelinghilterra-creator/trajecktory/commit/d3a30615cc962302d24bf890d76f51ff43659a85))

## [2.12.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.12.0...v2.12.1) (2026-08-04)


### Bug Fixes

* refetch triage results so they appear in Pipeline without a reload ([#147](https://github.com/michaelinghilterra-creator/trajecktory/issues/147)) ([3b7e74f](https://github.com/michaelinghilterra-creator/trajecktory/commit/3b7e74f72ac3261da8c9816d75f2a9fe6439f357))

## [2.12.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.11.0...v2.12.0) (2026-08-03)


### Features

* in-app day-to-day guide and refreshed onboarding for v2.12.0 ([#145](https://github.com/michaelinghilterra-creator/trajecktory/issues/145)) ([66ac559](https://github.com/michaelinghilterra-creator/trajecktory/commit/66ac55987141f4f2f94e53769c47c38e71169fdf))

## [2.11.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.10.0...v2.11.0) (2026-08-03)


### Features

* snapshot SPA-hosted JDs via ATS APIs before triage and eval ([#143](https://github.com/michaelinghilterra-creator/trajecktory/issues/143)) ([5f7e0ac](https://github.com/michaelinghilterra-creator/trajecktory/commit/5f7e0ac61ecc12797b27cec9faf21caa279cc4d4))

## [2.10.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.9.4...v2.10.0) (2026-08-03)


### Features

* add SmartRecruiters and Workable ATS parsers to scanner ([#141](https://github.com/michaelinghilterra-creator/trajecktory/issues/141)) ([7b13897](https://github.com/michaelinghilterra-creator/trajecktory/commit/7b13897f1d2d6486bebf4d5f3a69aa3489ad22c1))

## [2.9.4](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.9.3...v2.9.4) (2026-08-02)


### Bug Fixes

* bump Playwright to 1.62.1 for a patched Chromium (refs [#51](https://github.com/michaelinghilterra-creator/trajecktory/issues/51)) ([#138](https://github.com/michaelinghilterra-creator/trajecktory/issues/138)) ([3e290c7](https://github.com/michaelinghilterra-creator/trajecktory/commit/3e290c73625307baba2b686dcf7cd1b042c364d2))

## [2.9.3](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.9.2...v2.9.3) (2026-08-02)


### Bug Fixes

* post scheduling, Visibility de-brand, and capture tooling ([#136](https://github.com/michaelinghilterra-creator/trajecktory/issues/136)) ([4923a13](https://github.com/michaelinghilterra-creator/trajecktory/commit/4923a13719fca1392d7c689cedd15fcbf9295bcb))

## [2.9.2](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.9.1...v2.9.2) (2026-08-01)


### Bug Fixes

* **docx:** enforce the master summary length cap on tailored resumes ([#134](https://github.com/michaelinghilterra-creator/trajecktory/issues/134)) ([d0cc224](https://github.com/michaelinghilterra-creator/trajecktory/commit/d0cc224c83befc7aed0e2935477c03d2a1990249))

## [2.9.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.9.0...v2.9.1) (2026-08-01)


### Bug Fixes

* **dashboard:** campaign-readiness UI polish across all themes ([#129](https://github.com/michaelinghilterra-creator/trajecktory/issues/129)) ([03ac149](https://github.com/michaelinghilterra-creator/trajecktory/commit/03ac149b98d91f6b6b3b7c1712e9182bdc327296))
* **dashboard:** data-logic and reliability audit fixes ([#130](https://github.com/michaelinghilterra-creator/trajecktory/issues/130)) ([27f327f](https://github.com/michaelinghilterra-creator/trajecktory/commit/27f327f69487596f9313a3bc8e2c24928f75c96d))
* **security:** eval-sandbox, SSRF, CSRF-GET, CSV, token and path-traversal hardening ([#133](https://github.com/michaelinghilterra-creator/trajecktory/issues/133)) ([db145de](https://github.com/michaelinghilterra-creator/trajecktory/commit/db145de475b2968f2db07240589123cc4e78cb1d))

## [2.9.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.8.0...v2.9.0) (2026-07-31)


### Features

* **dashboard:** add TWC work-search activity report to Setup ([#128](https://github.com/michaelinghilterra-creator/trajecktory/issues/128)) ([eb59b1d](https://github.com/michaelinghilterra-creator/trajecktory/commit/eb59b1dca0a884d0e9ccae20749670e358453e9d))
* LinkedIn warm-channel reconcile with Stage 1/2 referral subtabs ([#126](https://github.com/michaelinghilterra-creator/trajecktory/issues/126)) ([b98c6ee](https://github.com/michaelinghilterra-creator/trajecktory/commit/b98c6ee00753d81e7141351125532c32f7ad419b))

## [2.8.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.7.0...v2.8.0) (2026-07-31)


### Features

* **dashboard:** persist agent run duration and add per-day cost/time rollup ([#125](https://github.com/michaelinghilterra-creator/trajecktory/issues/125)) ([1942fd9](https://github.com/michaelinghilterra-creator/trajecktory/commit/1942fd959c83718a6d09721b04cfef4c0638cee8))
* draft a follow-up from your last sent email to a contact ([#123](https://github.com/michaelinghilterra-creator/trajecktory/issues/123)) ([cd298ed](https://github.com/michaelinghilterra-creator/trajecktory/commit/cd298ed693839cbfdeb8f84be1df07610447f15d))

## [2.7.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.6.0...v2.7.0) (2026-07-31)


### Features

* **social:** publish posts to Buffer and auto-sync engagement ([#121](https://github.com/michaelinghilterra-creator/trajecktory/issues/121)) ([46ed5af](https://github.com/michaelinghilterra-creator/trajecktory/commit/46ed5af6099f900be1187b71ddb2f8bc70bb6497))

## [2.6.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.5.0...v2.6.0) (2026-07-30)


### Features

* **content:** track post performance and draft AI replies to comments ([#119](https://github.com/michaelinghilterra-creator/trajecktory/issues/119)) ([74c8d8b](https://github.com/michaelinghilterra-creator/trajecktory/commit/74c8d8b884d674a319be773e497fc13db9154478))

## [2.5.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.4.2...v2.5.0) (2026-07-30)


### Features

* reply drafting and follow-up dashboard improvements ([#115](https://github.com/michaelinghilterra-creator/trajecktory/issues/115)) ([90a7a69](https://github.com/michaelinghilterra-creator/trajecktory/commit/90a7a69a726f208b466069c43c24b88000b7e759))

## [2.4.2](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.4.1...v2.4.2) (2026-07-29)


### Bug Fixes

* reconcile keeps No-Response TA contacts instead of archiving them ([d66928f](https://github.com/michaelinghilterra-creator/trajecktory/commit/d66928ffabd897224b84987675ac4af6252c4264))
* self-heal rotated auth token in connect/email queue outreach ([a594332](https://github.com/michaelinghilterra-creator/trajecktory/commit/a594332aae0fb13207c61f07114a6a1fdc212316))

## [2.4.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.4.0...v2.4.1) (2026-07-28)


### Bug Fixes

* widen the AI Coach and add quick-start prompts beside the chat ([#111](https://github.com/michaelinghilterra-creator/trajecktory/issues/111)) ([294e5d3](https://github.com/michaelinghilterra-creator/trajecktory/commit/294e5d353882a9e690f99cd2108c206dcad10026))

## [2.4.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.3.0...v2.4.0) (2026-07-28)


### Features

* AI Coach, plus same-company outreach context in the queues ([#109](https://github.com/michaelinghilterra-creator/trajecktory/issues/109)) ([a5e2b0c](https://github.com/michaelinghilterra-creator/trajecktory/commit/a5e2b0c6e84301caf6040d6adec00f3308b0c0ae))

## [2.3.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.2.0...v2.3.0) (2026-07-28)


### Features

* ATS-API JD reads, trustworthy eval status, and per-run summary ([#107](https://github.com/michaelinghilterra-creator/trajecktory/issues/107)) ([dc9638d](https://github.com/michaelinghilterra-creator/trajecktory/commit/dc9638d97259311db39ae3d24c4dc29f2a5f0414))
* connect + email outreach queues, AI Reply, and dashboard agent fixes ([#108](https://github.com/michaelinghilterra-creator/trajecktory/issues/108)) ([e098e01](https://github.com/michaelinghilterra-creator/trajecktory/commit/e098e014301b85471e52412b7396333a3d88c9ad))
* recover remote roles, suppress reposts, and streamline the dashboard ([#105](https://github.com/michaelinghilterra-creator/trajecktory/issues/105)) ([9562951](https://github.com/michaelinghilterra-creator/trajecktory/commit/9562951af1cdce97152be54e82a10fcc93dd60d3))

## [2.2.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.1.0...v2.2.0) (2026-07-27)


### Features

* add Network/Referrals tab, rolling outreach floor, and Buffer docs ([#100](https://github.com/michaelinghilterra-creator/trajecktory/issues/100)) ([1a7bdbc](https://github.com/michaelinghilterra-creator/trajecktory/commit/1a7bdbc344784e5fb6a39315be19f567f831feb8))


### Bug Fixes

* dashboard UX, accessibility, and correctness pass ([#102](https://github.com/michaelinghilterra-creator/trajecktory/issues/102)) ([c0943bc](https://github.com/michaelinghilterra-creator/trajecktory/commit/c0943bcf43fa9e96d94a122aeb9d79e3ce5de17b))
* harden self-update (real checkout failures + UI rebuild) ([#104](https://github.com/michaelinghilterra-creator/trajecktory/issues/104)) ([75cef83](https://github.com/michaelinghilterra-creator/trajecktory/commit/75cef83a4145c4f8ed31e1bcddc4a08eb09f6570))

## [2.1.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.0.2...v2.1.0) (2026-07-26)


### Features

* bullet tailoring, posts composer, editable drafts, interview summary, and a product-led README ([#98](https://github.com/michaelinghilterra-creator/trajecktory/issues/98)) ([970b316](https://github.com/michaelinghilterra-creator/trajecktory/commit/970b3165dfdf20015435248bb7624772319452f6))

## [2.0.2](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.0.1...v2.0.2) (2026-07-26)


### Bug Fixes

* show a dash, not "null%", for a send-week with no applications ([#96](https://github.com/michaelinghilterra-creator/trajecktory/issues/96)) ([e1efac2](https://github.com/michaelinghilterra-creator/trajecktory/commit/e1efac25ea24a9009a290e2be28052da482b0efd))

## [2.0.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v2.0.0...v2.0.1) (2026-07-25)


### Bug Fixes

* **update:** clean installs no longer silently fail to self-update ([#93](https://github.com/michaelinghilterra-creator/trajecktory/issues/93)) ([fd0fe9b](https://github.com/michaelinghilterra-creator/trajecktory/commit/fd0fe9bcbbf025f3d893870806d9ae2a9fa0eacc))

## [2.0.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.24.1...v2.0.0) (2026-07-25)


### Features

* the 2.0 relaunch (scoring, Gmail, weekly review, gating, security hardening) ([bd9a601](https://github.com/michaelinghilterra-creator/trajecktory/commit/bd9a60118a168fc0f29c3b0098d584cf59451a86))

## [1.24.1](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.24.0...v1.24.1) (2026-07-22)


### Bug Fixes

* **onboarding:** bring the three guides up to the current app ([#89](https://github.com/michaelinghilterra-creator/trajecktory/issues/89)) ([81a28ee](https://github.com/michaelinghilterra-creator/trajecktory/commit/81a28ee4d4aaa4ba907ecef6f1ac079070ae7dc3))

## [1.24.0](https://github.com/michaelinghilterra-creator/trajecktory/compare/v1.23.1...v1.24.0) (2026-07-22)


### Features

* **release:** check release notes against the house format ([#87](https://github.com/michaelinghilterra-creator/trajecktory/issues/87)) ([163c496](https://github.com/michaelinghilterra-creator/trajecktory/commit/163c496484fae0e8d36e901f487d64f55a30ba4f))

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
