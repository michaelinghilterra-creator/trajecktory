# Security hardening in trajecktory

**Date:** 2026-07-24
**Scope:** whole repository, first formal security review
**Status:** all findings remediated before this note was published

## What we did

trajecktory had never had a formal security review. We ran one across the entire
codebase (the dashboard server and client, the portal scanners, the liveness
checker, the ship gate, and the installer and self-update path) using a
multi-agent security scan, then confirmed every candidate by hand before writing
a fix.

The review surfaced 14 issues. **All 14 are now fixed.** None were being
exploited, and trajecktory runs locally on your own machine bound to loopback, so
none were reachable from the public internet in a default install. We are
publishing this note the way we would want one published for a tool we ran: after
the holes are closed, describing what changed and why, not how to attack what
wasn't.

The installer, the bundled binaries, the self-update flow, and the release
tag-signing were reviewed and came back clean.

## What changed, by area

Each item below is a class of fix, not a recipe. The point is to show the pattern
now guarding that surface.

- **Report file reads are contained.** Anywhere trajecktory opens a report file
  from a path stored in your tracker, that path is now forced to stay inside the
  reports folder. A path that tries to point elsewhere is refused and reads
  nothing.

- **Generated files are neutralized on write.** The scanners write your pipeline
  and history files as plain tables. Job fields coming from a job board (title,
  company, URL) now have table and line-break characters stripped before they are
  written, so a weird value in a posting cannot forge extra rows for the batch
  evaluator to read.

- **Links in the dashboard are scheme-checked.** Every clickable link built from
  your data (a recruiter's LinkedIn, a job URL, a contact) now passes through an
  allow-list: normal web and email links open, anything else becomes an inert
  link. This closes the classic "a saved link that secretly runs code when you
  click it" problem, which the browser does not block on its own.

- **The local server only answers to itself.** The dashboard server now checks
  that requests are actually addressed to localhost and refuses anything else.
  This stops a page you happen to have open in another tab from tricking your
  browser into reading your local dashboard data.

- **The liveness checker refuses internal targets.** When trajecktory checks
  whether a job posting is still live, it now refuses to load anything that is not
  a normal public web address. Loopback, private-network, and cloud-metadata
  addresses are rejected before it navigates.

- **The evaluation agent runs with least privilege.** When you click to evaluate
  or scan, trajecktory runs an AI agent that reads job postings from the web.
  Because a posting is attacker-controlled text, that agent now runs inside a
  sandbox: it cannot edit the app's own code, config, or credential files, and it
  cannot read your secrets, even though it can still do its job. A booby-trapped
  posting can no longer talk the agent into changing trajecktory or leaking your
  tokens.

- **Bounce handling asks before it acts.** The Gmail sweep used to let a single
  click mark contacts as bounced based purely on the content of a bounce email.
  It now requires per-contact confirmation and cross-checks that you actually
  emailed that address before it will change anything. A forged bounce can no
  longer quietly remove a real recruiter from your outreach. (Verified live: a
  real inbox with dozens of bounces flipped zero contacts, because none matched a
  message you had sent.)

- **The ship gate now scans for secrets.** The pre-publish check that keeps
  personal data out of the repo now also scans every tracked file for API keys and
  tokens (Anthropic, Google, GitHub, AWS, and PEM private keys). A committed
  credential is caught before it can reach a public commit.

## What this means for you

Nothing to do. trajecktory still runs entirely on your own machine, bound to
loopback, and never sends your data anywhere on its own. If you are on an older
build, the safe move is simply to update to the latest, where all of the above is
already in place.

If you ever find a security issue in trajecktory, please report it privately per
the instructions in `SECURITY.md` rather than opening a public issue.
