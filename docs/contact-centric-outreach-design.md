# Design note: contact-centric, multi-channel outreach

**Status:** Draft / proposed. Not built. This documents the target model and the
decisions taken so far, so the build can be scoped later.
**Date:** 2026-08-07
**Origin:** A LinkedIn exchange with the builder of a competing tool (Repliably),
plus two follow-on design threads. The through-line: **the contact, not the
application, is the unit of outreach.** trajecktory is strong on the first half
of the search (source, score, tailor) and weaker on the second half (follow up
with the right people). This note closes that gap.

---

## The core reframe

Today the follow-up engine is **application-anchored**: it nudges "follow up on
your application to Company X," anchored on the apply date. But you do not follow
up with a company. You follow up with **a person**. If you emailed a TA contact
on Monday, the thing to do is nudge *that person* on Thursday. If a company has
no contact at all, there is nobody to follow up with, so a follow-up prompt is
noise.

So the model becomes: **a contact you have touched is the unit that carries a
follow-up clock.** The application is context (which company, which role), not
the thing being chased.

---

## Current state (what exists today)

Grounded in `dashboard-web/server/lib/followups.mjs` and related files:

- **`computeStaleApps`** is application-anchored. It nudges per application, using
  the apply date (or the last follow-up logged *against the application*). Follow-
  ups are keyed by application number, not by person. A warm/cold split already
  de-emphasizes contactless "cold" applications into an "Applications out" ledger.
- **`computeStaleTA`** is already contact-anchored (on a contact's `lastTouch`,
  reading the per-contact correspondence log). It exists but is secondary to the
  application nudge. This is the seed of the target model.
- **`computeConnectQueue` / `computeEmailQueue`** are the initial-outreach queues.
  They are **mutually exclusive by channel**: the connect queue *excludes* any
  contact with a sendable email (`if (isSendable) return`), and the email queue
  requires one. `channelFor()` picks a single best channel, email over LinkedIn.
  **Consequence: a contact who has BOTH an email and a LinkedIn is worked on email
  only, never also on LinkedIn.**
- **Contact books:** `target-talent.md`, `recruiters.md`, `referrals`. Each row
  can carry a LinkedIn handle and/or a verified email. Per-contact touch history
  already exists as correspondence logs (direction Sent/Received).
- **TA discovery** (`tt-reconcile discover`) searches for *"Internal Talent
  Acquisition / People / Recruiting"* people, i.e. gatekeepers, not the hiring
  decision-maker.
- **Sending is deliberately draft-only.** `gmail.compose` + `drafts.create`,
  never send. Nothing leaves without a human clicking send. This
  human-in-the-loop (HITL) guarantee is a product principle and is NOT up for
  negotiation in this design.

---

## Proposed model

### 1. The contact is the unit of outreach
Follow-up cadence and follow-up logging move from application-keyed to
**per-contact**. Each contact you have touched carries its own last-touch clock.
The application is metadata on the contact (which company/role the outreach is
about), not the anchor.

### 2. Contactless applications become a "find a contact" prompt
An application with no contact is not a follow-up. It converts into an
**initial-outreach trigger**: "you applied to X with nobody to talk to. Find
someone." That nudge feeds the hiring-principal discovery in item 6.

> **Recommended default (pending final confirmation):** a contactless applied
> role should SURFACE as a "find a contact here" nudge, not disappear. Rationale:
> disappearing loses the most useful next action (go source the decision-maker).
> If you would rather it vanish entirely, that is a one-line change.

### 3. Three explicit channel buckets
Every contact is classified by what channel we actually hold:
1. **LinkedIn only** (handle, no usable email)
2. **Email only** (usable email, no handle)
3. **Both** (usable email AND handle)

Buckets 1 and 2 are worked on their single available channel. Bucket 3 is the
multithread case (item 4).

### 4. Multithread bucket 3 — for high-priority contacts only  *(DECIDED)*
A bucket-3 contact is worked on **both** channels in parallel: an email sequence
AND a LinkedIn sequence, each with its own cadence, templates, and AI-drafted
messages. This increases the odds of being seen by the right person.

**Reserved for high-priority contacts** (hiring principals and warm targets), not
applied blindly to every both-channel contact. Reason: LinkedIn connection
invites are capped at ~100 per rolling 7-day window (documented in
`followups.mjs`). Spending that scarce channel on low-value contacts wastes it.
Priority is what decides who earns the double-touch.

Mechanically, this means a bucket-3 high-priority contact appears in BOTH the
connect queue and the email queue (today they are mutually exclusive), and each
channel keeps an independent clock: an email follow-up can come due while the
LinkedIn request is still pending.

### 5. A reply on any channel pauses that contact's other sequences  *(DECIDED)*
When a bucket-3 contact replies on one channel, the OTHER channel's sequence for
that contact auto-pauses. A reply anywhere means "stop the parallel chase" so we
never keep cold-touching someone who has already engaged. Scope is per contact:
pausing Bob's LinkedIn sequence because Bob replied by email does not touch
anyone else at the company.

### 6. Hiring-principal contact type + discovery
A new contact type for **the person you would report to** (the VP/Director of the
target function), distinct from the recruiter/TA gatekeeper. Discovery aims at
"who leads {function} at {company}," not "who recruits there." This is the move
that actually got the Repliably builder hired: he put the decision-maker in his
CRM, reached out, and demoed. Hiring principals are prime bucket-3 /
high-priority candidates.

### 7. Templates and AI-filled sequences, HITL-preserved
A reusable **template library** per scenario (cold intro, follow-up 1/2,
referral ask, post-interview thank-you), which the AI fills per contact. A
**sequence** is a pre-planned set of touches (touch 1 → 2 → 3 with timing).
Crucially, a sequence is realized as **scheduled DRAFTS**: the AI pre-writes the
whole sequence, but each step is a draft the user one-click approves before it
sends. This captures most of the time saving of an auto-send tool while keeping
the "nothing sends unapproved" guarantee. That combination (speed + control) is
a stronger story than pure auto-send.

### 8. Lead with an artifact
Outreach drafts to a hiring principal should default to leading with a tangible
proof link (the GitHub project, the portfolio carousel). Showing beats telling;
this mirrors the "demo, don't describe" move that landed the hire.

---

## Data-model implications

- **Follow-ups become contact-keyed**, not application-keyed. The per-contact
  correspondence log already exists and is the natural home for the touch history
  and last-touch clock.
- **Per-contact, per-channel touch timeline.** A single contact needs two
  independent cadence clocks in the bucket-3 case (email thread, LinkedIn thread).
- **A `priority` signal on contacts** (or a derived "is hiring principal / warm")
  decides who is eligible for the bucket-3 double-touch.
- **A new hiring-principal contact type** alongside recruiter / target-talent /
  referral, with its own discovery prompt.
- **Sequence state** (which step a contact is on, next scheduled draft date,
  paused/active) persisted per contact per channel.

## Interactions with existing code

- `followups.mjs`: `computeStaleApps` shifts from primary to a "find a contact"
  role for contactless apps; `computeStaleTA` grows into the primary per-contact
  engine; `computeConnectQueue`/`computeEmailQueue` stop being mutually exclusive
  for bucket-3 high-priority contacts; `channelFor` stops being single-best-channel
  for those.
- `statuses.mjs`: the contact ladders (recruiter/talent/referral) may gain a
  hiring-principal ladder or a priority flag.
- `tt-reconcile.mjs` discover: a second discovery prompt aimed at the functional
  leader, not TA.
- Sending stays `gmail.compose` / `drafts.create` only. Sequences are scheduled
  drafts, never auto-sent.

---

## Decisions recorded

| # | Decision | Status |
|---|----------|--------|
| Bucket 3 double-touch | Reserved for HIGH-PRIORITY contacts only (respect the LinkedIn ~100/week cap) | DECIDED |
| Reply handling | A reply on any channel auto-pauses that contact's other sequences | DECIDED |
| Contactless applied role | Surface as a "find a contact" nudge (not disappear) | RECOMMENDED, pending final confirm |

## Suggested build order (when we build it)

1. Contact-keyed follow-up engine (move the clock from app to contact).
2. Three channel buckets as an explicit classification.
3. Hiring-principal contact type + discovery.
4. Template library + scheduled-draft sequences (HITL).
5. Bucket-3 multithread for high-priority contacts, with reply-anywhere pause.
6. Lead-with-artifact in drafts.
7. Contactless-applied "find a contact" prompt.

## Not in scope / deliberately excluded

- **Auto-send.** The competing tool auto-fires sequences. trajecktory does not,
  by design. Scheduled drafts with one-click approval is the chosen equivalent.
- **Payment handling.** Relevant to a SaaS launch, not to a local-first tool.
