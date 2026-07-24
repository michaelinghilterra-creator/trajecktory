# Feature gating: what to do about a capability the user cannot reach yet

Maintainer-facing. The user-facing counterpart for the biggest one of these is
[`gmail-setup.md`](gmail-setup.md); the tier map a new user reads is
`docs/onboarding/feature-tiers.md`.

## The principle

**A capability you can see but cannot reach reads as broken, not as unconfigured, and
the user has no way to tell those apart.** That is the whole problem. It is worse than
not showing the feature at all, because a missing feature costs nothing and a broken one
costs trust in everything next to it.

The fix is never "hide it and hope". It is to make the *state* legible: this thing is
off, here is what it would do for you, here is exactly how to turn it on, and here is
what you lose by not bothering. That is the same shape the Launchpad already uses for
every setup step, and the same honesty rule the weekly metrics use when they print "not
logged" instead of a zero.

## The discriminator: can the user self-provision the credential?

| Answer | Ship it how |
|---|---|
| **Yes.** Their own free Google client, their own free API tier, their own token. | **Show it, disabled, with a real setup path.** Never hide it. A feature the user could have in 15 minutes is worth 15 minutes of their attention. |
| **No.** It needs a credential only the maintainer holds. | **Do not ship it enabled, and consider not shipping the surface at all.** There is no setup path to offer, so a disabled control is just a taunt. |

Everything in the inventory below is in the first row. There is currently nothing in
trajecktory that only the maintainer can unlock, and that is worth keeping true.

## The three states every gated surface must distinguish

Most gates in this codebase model two states, on and off, and that is the bug. There are
three, and the first two look identical to a user while meaning completely different
things:

1. **Not configured.** No credential exists. The user has never been asked for one.
   *Action: teach.* Explain the feature and link the setup path.
2. **Configured but not connected or not working.** A credential exists but the user has
   not finished, or it expired. *Action: prompt.* One button, and say what broke.
3. **Working.** *Action: get out of the way.*

Collapsing 1 into 2 is what produces the "broken product" reading: the app offers a
Connect button as though everything were ready, the user clicks it, and gets an error
about a file they have never heard of.

---

## Inventory

Every credential-gated surface, what it costs the user to unlock, and what happens today
if they have not.

| Surface | Needs | User can self-provision? | Modeled where today | What a new user hits |
|---|---|---|---|---|
| Gmail reply and bounce sweep (Review tab) | Own Google OAuth client, then consent | Yes, free, about 15 min | Nowhere. The card always renders with a Connect button | Full-page navigation to a raw 400 text page naming an env var. **Worst case in the app.** |
| "Draft in Gmail" buttons (TA, recruiter, follow-up composers) | Same, plus the compose scope | Yes | Renders whenever a recipient exists | An error toast, "Google is not connected." |
| Review nav attention badge | Same | Yes | Health poll | Silent and correct. No change needed |
| Finding and verifying contact emails | `HUNTER_API_KEY` + `MILLIONVERIFIER_API_KEY` | Yes. Free tier, and a small one-time fee | Nowhere in the Launchpad. One after-the-fact warning inside the TA reconcile result | Contacts land UNVERIFIED, and the send gate then quietly removes them from Follow-Ups. **The most invisible gate in the app.** |
| Expand Coverage, web phases | `BRAVE_API_KEY`, optional `MUSE_API_KEY` | Yes, free tier | Launchpad booster, "Web discovery keys" | Reports "0 new", which the booster copy already names as expected |
| AI drafts, faster path | `ANTHROPIC_API_KEY` | Yes | Launchpad booster, "AI draft key" | Nothing. The Claude-plan path is the default and needs no key |
| Obsidian note push | `OBSIDIAN_API_KEY`, plugin, app running | Yes | Launchpad booster, "Obsidian vault" | Push fails and is logged. Booster copy says to skip it unless you use Obsidian |
| Cover letter `.docx` | pandoc on PATH | Yes | Not modeled | Silently falls back to HTML |
| Everything AI | Claude Code sign-in, paid plan | Yes | `/api/claude-status` plus a Launchpad sign-in button | Surfaced already |
| Agent web search | Workspace trust flag | Yes | Same status endpoint, warns before a run is paid for | Surfaced already |
| LinkedIn posting | Buffer token | Yes | Not built | Nothing to gate yet. Build the gate with the feature |

Two gaps, then: **Gmail** and **contact verification**. The rest is already modeled, and
the Launchpad boosters are the pattern the two gaps should be pulled into rather than a
new mechanism.

## Decision per surface

**Show, disabled, with a setup path:**

- Gmail sync card. Keep the card. When no client is configured, replace the Connect
  button with a "How to connect Gmail" link to `docs/gmail-setup.md` and say plainly
  that this one needs a 15-minute setup in Google's console before it can be connected.
- Gmail draft buttons. Keep them visible and disabled, with the reason on hover, so the
  feature is discoverable from the place it would be used. Do not make the user find out
  by clicking.
- Contact verification. Add a Launchpad booster next to the other key entries, and make
  the Follow-Ups empty state say when rows are being withheld for want of a verified
  address rather than just showing fewer rows.

**Leave as is:** every row above already marked surfaced or modeled.

**Do not hide anything.** Hiding is only correct for the second row of the discriminator
table, and nothing currently sits there.

## The copy pattern

Reuse the four fields the Launchpad already renders (`LpWhy` in `launchpad.jsx`). They
exist because a single blurb reliably drifts into describing machinery, and four labelled
fields make an omission visible:

- **does** what it does, one sentence, plain verb, no product nouns.
- **sowhat** what the user actually gets, a concrete outcome.
- **affectsScore** `yes` / `no` / `filter`, rendered as a badge, never as prose.
- **ifYouSkip** what really happens, including "nothing".

Three rules on top of those, for disabled states specifically:

1. **A disabled control is never a dead end.** It carries a link to the setup path in the
   same breath. A greyed button with no next step is the same failure in a quieter voice.
2. **State the cost before the benefit** when the cost is real. "About 15 minutes in
   Google's console" belongs in the first sentence, not in a footnote, because a user who
   discovers the cost after starting feels misled.
3. **Say what is normal.** An unverified-app warning screen, a weekly reconnect, an empty
   result: if the expected path includes something alarming, name it in advance or it
   reads as a failure.

## What this needs in code

The doc is the deliverable for the decision. These are the changes that follow from it,
smallest first. None is large.

1. **Report whether a client is configured at all.** `googleStatus()` and `checkHealth()`
   both return `connected: false` when there is no OAuth client, which is the same answer
   they give when the user simply has not connected yet. Add a `configured` flag derived
   from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, so the UI can tell state 1 from
   state 2.
2. **Stop `/api/google/auth-start` from being a dead end.** It currently answers a
   full-page browser navigation with `res.status(400).send('Missing GOOGLE_CLIENT_ID ...')`,
   so the user loses the dashboard and lands on unstyled text naming a file. It should
   redirect back with a reason the UI can render, the same way the callback already does.
3. **Three-state the Gmail sync card**, per the decision above.
4. **Disable rather than hide `GmailDraftBtn`** when not connected, with the reason and a
   link.
5. **Fix one piece of copy that is only true for the maintainer.** The not-connected card
   says Testing-mode tokens expire about weekly. That is a property of one publishing
   status, not of Gmail, and it will confuse anyone who published their app.
6. **Add the contact-verification booster** to `LP_OPTIONAL`, and surface withheld rows in
   Follow-Ups.

Items 1 and 2 are the ones that turn "broken" into "unconfigured". The rest is polish on
top of that.
