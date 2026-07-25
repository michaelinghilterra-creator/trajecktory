# Security posture: what is defended, and what is accepted

Maintainer-facing, and the complete record. The user-facing transparency note is
[`security-review-2026-07.md`](security-review-2026-07.md); this doc is the full
version behind it.

**Two review passes happened on 2026-07-24, and this doc covers both.** First a
maintainer hardening pass over the four surfaces that matter here (OAuth token
storage, the local API server, the installer, and every subprocess shell-out): 8
findings. Then a formal multi-agent security review of the whole repository: 14
more, each confirmed by hand. **All 22 are fixed.** None was being exploited, and
the app runs locally bound to loopback, so none was reachable from the internet in
a default install.

Two audiences. The first is whoever reads this code next and wonders whether a
rough edge is an oversight. The second is an external auditor: several items below
are **deliberate**, and a decision with its reasoning written down is cheaper to
review than one that has to be rediscovered. Both passes are held by tests:
`tests/security.test.mjs` (the 8) and `tests/security-review.test.mjs` (the 14),
so a later refactor cannot silently undo either.

## The trust model in one paragraph

trajecktory is a single-user local application. The dashboard binds to loopback,
has no user accounts, and holds the user's own data. The threats worth defending
against are therefore: a web page the user visits reaching the local API, another
process on the same machine, a poisoned data file, and a bad artifact reaching a
user through the installer or the self-update. The threat model is **not** a
multi-tenant server, and controls that only make sense there are absent on
purpose.

## Controls that are load-bearing

Change any of these and something real breaks.

| Control | What it stops |
|---|---|
| Per-start token on every mutating request, `SameSite=Strict` + `HttpOnly` | A page on another site driving the local API. It is the reason the agent-spawn route is not reachable cross-site |
| CORS scoped to loopback origins | Another site reading API responses |
| Loopback bind by default | The LAN, unless the user deliberately sets `HOST` |
| Rate limiting across the API surface | A flood when the user has deliberately exposed it |
| `--ignore-scripts` on the self-update install | A compromised or typosquatted transitive dependency running code on update |
| Signed-tag verification in the updater | An update that did not come from the maintainer. Held by `tests/update-signing.test.mjs`, which asserts it REFUSES five cheats, not just that it accepts |
| Argument arrays for every subprocess | Command injection. The one place a prompt is built into argv validates its inputs at the route and allow-lists the model id |
| `reportMdToHtml` escaping before transforming | XSS from agent-written markdown. Ordering matters: escape first, then apply markdown, and gate hrefs through a scheme allow-list |
| Containment on paths read out of data files | A poisoned tracker row becoming a file read. `lib/safe-path.mjs` |
| `.env` value validation | A saved "API key" writing a second key. Some keys on that file name executables |
| `0600` on the token file and `.env` | Another local account reading a mailbox credential |
| Redaction of subprocess output before storage | A credential in a git error reaching the browser |
| Integrity checks on bundled third-party binaries | A bad build machine shipping a bad binary to every user |
| SSRF guard on the liveness probe (`lib/safe-url.mjs`) | A job URL from a board pointing the server-side probe at loopback / private / cloud-metadata addresses |
| Loopback-only Host-header allow-list ahead of routing | DNS rebinding: a rebound hostname that becomes same-origin and slips past the Origin-keyed CORS/token guards |
| Client-side scheme allow-list on every data-derived link (`window.safeHref`) | A `javascript:` / `data:` URL in a tracker cell becoming a clickable XSS sink (React does not block it) |
| Delimiter neutralization on scanned job fields (`lib/sanitize-cell.mjs`) | An attacker-controlled title/company/url forging extra pipeline or history rows the batch evaluator then reads |
| Deny-list sandbox on the evaluation agent | A booby-trapped job posting talking the agent into editing server code/config/secrets or reading OAuth tokens |
| Per-contact confirmation before a bounce flip | A forged "undeliverable" quietly removing a real recruiter from outreach |
| Secret-pattern scan in the ship gate | A committed API key or token reaching the public repo and the git-archive installer payload |

## Accepted risks, with reasoning

These are decisions. If an audit reports one, this section is the answer.

**The installer is not code-signed.** A certificate costs real money and the
current audience is a handful of beta testers. The consequence is understood:
SmartScreen warns on first run, and nobody downstream can verify the `.exe` came
from this project. Revisit when the user count justifies the cost. Until then this
is a known, priced decision rather than an oversight.

**The self-update runs `npm install`, not `npm ci`.** `ci` deletes `node_modules`
and hard-fails on any drift, which on a user's machine mid-update turns a
recoverable state into a broken install. The lockfile arrives in the same checkout
as `package.json`, so `install` resolves to the locked versions anyway, and
`--ignore-scripts` closes the vector that actually matters. CI still uses `npm ci`,
where a hard failure is the correct outcome.

**The app fetches URLs the user is evaluating.** Posting fetches go to whatever
the user pastes or scans. That is the product, and URLs reach subprocesses through
argument arrays, never a shell. What is NOT accepted, and was closed by the formal
review (C10), is the server-side liveness probe reaching an *internal* target: it
now refuses loopback, private, link-local, and cloud-metadata addresses before
navigating (`lib/safe-url.mjs`). The residual, accepted part is narrow: a public
hostname that resolves into private space is out of scope for a literal check and
would need a resolve-then-check at fetch time.

**The Obsidian push disables TLS verification.** The Local REST API plugin serves
a self-signed certificate on loopback, so verification cannot succeed and pinning
is not practical against a cert the plugin regenerates. The exposure is that a
process which binds that port first receives the plugin token. Same-machine, and
the feature is opt-in.

**Per-user install into a user-writable directory, with `ExecutionPolicy Bypass`
shortcuts.** Anything already running as the user can rewrite those files whatever
the install layout, so this grants no capability an attacker would not have. The
alternative is requiring admin, which is worse for a personal tool.

**The PII gate prints the value it matched.** It has to: a finding nobody can
locate is not actionable. What it never prints is the derived term list, which
comes from the user's own ungitignored data. Counts only.

## Findings fixed: the maintainer pass (8)

Recorded so a later reader can tell which rough edges were already found.

1. `.env` line injection reaching an executable env var. Values are refused rather
   than trimmed, validated before anything is written, and the in-place rewrite
   uses a function replacement so `$`-sequences stay literal.
2. Token file and `.env` written world-readable. Now `0600` on create and chmod
   when they already exist.
3. Report paths from the tracker read without containment. This pass fixed the two
   read routes and the four apply-flow readers (which matter more, because what
   they read goes into a model prompt) through one shared helper, `lib/safe-path.mjs`.
   **The formal review then found two more readers of the same field** (C2, C3
   below), so the true count was eight, not six; both now route through the same
   helper (identity.mjs inlines the check rather than importing across the
   root/server boundary).
4. Credentials in subprocess error output reaching the browser. Redacted at
   capture, not at display.
5. A user-controlled key used in a bare property lookup, so the allow-list found
   inherited members. Own-property only.
6. The OAuth redirect target taken from the request's `Host` header. Loopback
   hosts pass through, anything else falls back to the server's own address.
7. Bundled third-party binaries downloaded with no integrity verification. The
   runtime is checked against the vendor's published manifest; the setup binary
   gets a signature check plus a pinned hash.
8. The Anthropic API client froze its key at construction, so a key saved
   mid-session never took effect. A correctness bug rather than a vulnerability,
   recorded here because it sits in the same credential-handling surface.

Held by `tests/security.test.mjs`. Two of those checks exist because a naive fix
misses them: a sibling directory sharing a prefix, and a host that merely contains
the loopback name.

## Findings fixed: the formal review (14)

A formal multi-agent scan of the whole repository, run after the pass above and
confirmed by hand. No criticals. Ids are the review's own; the user-facing summary
is [`security-review-2026-07.md`](security-review-2026-07.md).

| Id | Severity | Fix | Where |
|---|---|---|---|
| C4 | High | Eval agent runs under a deny-list sandbox: no editing server code / config / `.env` / `.claude` / installer, no reading OAuth tokens or `*.pem`, even via Bash. Only `node next-jd.mjs` is allowed. Live-tested. | `routes/agent.mjs`, `eval-agent-sandbox.settings.json` |
| C1 | Med | Ship gate scans every tracked file for eight secret/token formats (Anthropic, OpenAI, Google, GitHub, AWS, PEM). | `verify-no-pii.mjs` |
| C2 | Med | `applications.mjs` report read routed through the containment guard. | `server/lib/applications.mjs` |
| C5 | Med | Loopback-only Host-header allow-list ahead of routing (DNS rebinding). | `server/index.mjs` |
| C7 | Med | Table/newline delimiters neutralized in scanned job fields before write. | `scan.mjs`, `lib/sanitize-cell.mjs` |
| C10 | Med | Liveness probe refuses non-public / loopback / metadata URLs (SSRF). | `check-liveness.mjs`, `lib/safe-url.mjs` |
| C11 | Med | Bounce flip requires per-contact confirmation and a sent-history cross-check. Live sweep: dozens of bounces, zero flipped. | `routes/google.mjs`, `src/review.jsx` |
| C12-14 | Med | Client scheme allow-list on every data-derived anchor href. | `src/recruiters.jsx`, `target-talent.jsx`, `pipeline.jsx`, `followups.jsx`, `linkedin-ssi.jsx`, `shared.jsx` |
| C3 | Low | Containment on the report path in `urlFromReport`. | `lib/identity.mjs` |
| C6 | Low | Documented unreachable in the loopback posture (folded into C5). | `server/index.mjs` |
| C8 | Low | TSV delimiters neutralized in scan history. | `scan.mjs` |
| C9 | Low | Same neutralization in the discovery path. | `discover.mjs` |

Held by `tests/security-review.test.mjs`, which tests the real shipped function
wherever one is reachable (the SSRF guard, the cell sanitizer, `urlFromReport`, the
client link sanitizer, the secret scan via `--payload`) and asserts the guard is
present in source where it is inline in a route. Writing its "every data-derived
link goes through the sanitizer" assertion surfaced one JD link in the pipeline
view the review's link pass had missed: not exploitable (a sibling condition
already refused any non-http(s) scheme before it rendered), but the one link
reaching an href without the shared helper, so it was wrapped to make the invariant
uniform.

## Reviewed and found clean

Stated so the same ground is not covered twice: dependency audit across both trees
(production and dev, 0 vulnerabilities), lockfiles tracked with CI installing from
them, the OAuth core (PKCE S256, server-side state with a TTL, scope as a module
constant, no token in any log), the docx writer (named entries only, no
extract-all, so no zip-slip), the restart route (paths passed through the
environment rather than interpolated into a shell), and the launcher (no user
input, no string-built commands).

One correction the formal review made to a "clean" claim, worth naming rather than
quietly editing: the maintainer pass checked the `dangerouslySetInnerHTML` sinks
(fed by `reportMdToHtml`, which escapes before transforming) and called client XSS
clean. That was the wrong scope. Those sinks were fine, but data-derived **anchor
hrefs** are a separate XSS class React does not block, and the formal review found
several unwrapped (C12-14). "Clean" is only ever clean for the sink class actually
looked at.
