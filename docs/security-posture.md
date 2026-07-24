# Security posture: what is defended, and what is accepted

Maintainer-facing. Written after a full review on 2026-07-24 of the four surfaces
that matter here: OAuth token storage, the local API server, the installer, and
every place the app shells out to a subprocess.

Two audiences. The first is whoever reads this code next and wonders whether a
rough edge is an oversight. The second is an external auditor: several items below
are **deliberate**, and a decision with its reasoning written down is cheaper to
review than one that has to be rediscovered.

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

**The app fetches arbitrary URLs.** Liveness checks and posting fetches go to
whatever the user is evaluating. That is the product. URLs reach subprocesses
through argument arrays, never a shell. A local tool that can be pointed at a
local address is inherent, not a defect.

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

## Findings fixed in the 2026-07-24 pass

Recorded so a later reader can tell which rough edges were already found.

1. `.env` line injection reaching an executable env var. Values are refused rather
   than trimmed, validated before anything is written, and the in-place rewrite
   uses a function replacement so `$`-sequences stay literal.
2. Token file and `.env` written world-readable. Now `0600` on create and chmod
   when they already exist.
3. Report paths from the tracker read without containment, in **six** places. The
   first pass fixed the two read routes and missed four in the apply flow, which
   matter more because what they read goes into a model prompt. One shared helper
   now, tested once.
4. Credentials in subprocess error output reaching the browser. Redacted at
   capture, not at display.
5. A user-controlled key used in a bare property lookup, so the allow-list found
   inherited members. Own-property only.
6. The OAuth redirect target taken from the request's `Host` header. Loopback
   hosts pass through, anything else falls back to the server's own address.
7. Bundled third-party binaries downloaded with no integrity verification. The
   runtime is checked against the vendor's published manifest; the setup binary
   gets a signature check plus a pinned hash.

Held by `tests/security.test.mjs`. Two of those checks exist because a naive fix
misses them: a sibling directory sharing a prefix, and a host that merely contains
the loopback name.

## Reviewed and found clean

Stated so the same ground is not covered twice: dependency audit across both trees
(production and dev), lockfiles tracked with CI installing from them, the OAuth
core (PKCE S256, server-side state with a TTL, scope as a module constant, no
token in any log), the four `dangerouslySetInnerHTML` sinks, the docx writer
(named entries only, no extract-all, so no zip-slip), the restart route (paths
passed through the environment rather than interpolated into a shell), and the
launcher (no user input, no string-built commands).
