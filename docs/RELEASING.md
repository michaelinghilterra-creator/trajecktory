# Releasing trajecktory (signed self-updates)

trajecktory can pin self-updates to **SSH-signed release tags**, so an install
only ever runs code from a release you personally signed. This closes the
"repo/CI compromise pushes malicious code to every install" path.

It is **opt-in**: until a `trusted-signers` file is present in the bundle, the
updater tracks `main` exactly as before. Activating it is a one-time setup plus
one extra step per release.

## One-time setup

1. Create (or reuse) an SSH signing key:

   ```bash
   ssh-keygen -t ed25519 -C "trajecktory release signing" -f ~/.ssh/trajecktory_sign
   ```

2. Configure git to sign tags with it (note: the PUBLIC key path):

   ```bash
   git config --global gpg.format ssh
   git config --global user.signingkey ~/.ssh/trajecktory_sign.pub
   ```

3. Add your PUBLIC key as the trust anchor. Copy the template and add one line:

   ```bash
   cp trusted-signers.example trusted-signers
   ```

   The line format is `<your git email> namespaces="git" <key-type> <key>`, e.g.:

   ```
   276099902+michaelinghilterra-creator@users.noreply.github.com namespaces="git" ssh-ed25519 AAAAC3Nza...
   ```

   The email MUST match `git config user.email` (that is the tagger identity git
   records). Take the `key-type` + `key` fields from `~/.ssh/trajecktory_sign.pub`
   (drop the trailing comment). A public key is safe to publish, so commit it:

   ```bash
   git add trusted-signers && git commit -m "chore: add release signing trust anchor"
   ```

## Each release — checklist

Four steps are done by hand. Steps 2 and 3 both fail **silently with a green
release run**, which is why `.github/workflows/tag-signature.yml` checks them
rather than trusting this list. Run it at the end; if it is green, you are done.

- [ ] **1. Merge the Release Please PR with a MERGE COMMIT, not a squash.**
      A squash takes the PR title (`chore(main): release X.Y.Z`) as the commit
      message, and Release Please would then re-read that on the next cycle.
      *Feature* PRs are the opposite: squash those. This item used to warn against
      squashing them too, on the grounds that a PR title usually has no type prefix,
      so squashing would collapse real Conventional Commit subjects into a title
      that bumps nothing. That risk is now closed at the source: `pr-title.yml`
      fails any PR whose title is not a Conventional Commit. Merge-committing
      feature PRs instead causes its own problem, because GitHub puts the PR title
      in the merge commit BODY and Release Please counts the same fix twice. See
      *How to merge a PR* in `AGENTS.md`.
- [ ] **2. Sign the tag.** Release Please creates a lightweight tag via the API,
      which cannot carry a signature. Replace it (commands below).
      *Fails silently:* anchored installs freeze rather than erroring.
- [ ] **3. Rewrite the release body in the house format: PROSE, not bullet points.**
      The auto-generated body is commit subjects. The dashboard **renders this text**
      in Setup → Change Log and in the update banner, so leaving it raw ships internal
      script names and commit scopes into the product.
      *Fails silently:* the release run is green either way.
      Full spec: [Release notes: the house format](#release-notes-the-house-format).
      **Read the previous release before writing this one.**
- [ ] **4. Run the guard and confirm it is green:** `gh workflow run tag-signature.yml`
- [ ] **5. (Optional) Rebuild and upload the installer.** Only needed when new
      installs should land on this version directly. Skipping it is fine:
      existing installs still self-update, but new ones land on the last release
      that has an `.exe` and update from there.

## Each release — the commands

Release Please still bumps the version, writes the changelog, and creates the
`vX.Y.Z` tag via the API. That API tag is **unsigned**, so replace it with a
signed tag on the same commit and push it:

```bash
git fetch --tags
git tag -s vX.Y.Z -f "vX.Y.Z^{commit}" -m "trajecktory vX.Y.Z"
git push origin vX.Y.Z -f
```

Then confirm it took, rather than assuming:

```bash
gh workflow run tag-signature.yml
```

That workflow (`.github/workflows/tag-signature.yml`) fails if the newest tag is
not signed by a key in `trusted-signers`. It also runs daily, so a forgotten
signature turns into a red build within a day instead of sitting unnoticed. See
[Why this step is easy to miss](#why-this-step-is-easy-to-miss).

Then rebuild and ship the installer so new installs carry both the trust anchor
and the signed release:

```bash
pwsh -ExecutionPolicy Bypass -File installer/build-bundle.ps1
& "C:/Program Files (x86)/Inno Setup 6/ISCC.exe" installer/trajecktory.iss
gh release upload vX.Y.Z installer/Output/trajecktory-setup-vX.Y.Z.exe
```

## Release notes: the house format

Release notes are **product copy, not a changelog**. They are read inside the app by
someone deciding whether to accept an update, so they are written for that person and
not for whoever wrote the commits.

**Open the previous release and copy its shape before writing a new one:**

```bash
gh release view "$(gh release list --limit 2 --json tagName -q '.[1].tagName')" --json body -q .body
```

**Write in prose.** Full sentences and paragraphs that say what happened and why it
matters to the reader. Terse developer bullet points are the recurring regression here,
and they are the one thing to check before publishing. Bullets belong in exactly one
place, `### For contributors`, which is where a reader who wants mechanical detail goes
looking for it.

The structure, in order:

1. **An opening paragraph with no heading.** One or two sentences characterising the
   release ("Data integrity release.", "Accuracy release.", "Maintenance release."),
   what it addresses, and whether it is recommended for all installs.
2. **`## Install (Windows)`.** Required on every release, copied verbatim from the
   block below. Only the installer version changes.
3. **`## What changed`**, one `###` subheading per change, each written as prose. Name
   the user-visible symptom first, then the cause, then what is true now. Where nothing
   of theirs was damaged, say so plainly; that is usually the reader's actual question.
4. **`### For contributors`.** File names, module boundaries, test coverage. Bullets
   are fine here.

### The Install (Windows) block

Paste this into every release, immediately after the opening paragraph. It is not
optional and it is not generated: a release published without it leaves anyone who does
not already have trajecktory with no way to install it, because most releases carry no
installer of their own.

```markdown
## Install (Windows)

**Already installed?** Launch trajecktory once and accept the update prompt. It self-updates to this build.

**New install?** No installer is attached to this release. Download `trajecktory-setup-vX.Y.Z.exe` from [vX.Y.Z](https://github.com/michaelinghilterra-creator/trajecktory/releases/tag/vX.Y.Z), run it, then launch trajecktory and accept the update prompt to reach this version.

The installer is not code-signed yet, so Windows SmartScreen may warn "unknown publisher." Choose **More info → Run anyway**.
```

`vX.Y.Z` in the "New install?" line is the **newest release that actually carries a
`trajecktory-setup-*.exe` asset**, which is usually NOT the release being written and is
often several versions behind it. Look it up rather than assuming, because guessing here
sends people to a download that does not exist:

```bash
for t in $(gh release list --limit 12 --json tagName -q '.[].tagName'); do
  gh release view "$t" --json assets -q '[.assets[].name]|join(" ")' | grep -q 'setup.*exe' && echo "$t" && break
done
```

If the release being written *does* ship its own installer (checklist step 5), replace
the whole "New install?" paragraph with a direct pointer to the attached `.exe` instead.

**Never name a real company, person, or figure from the maintainer's own job search.**
The release body is published and is rendered inside the product, and it never passes
through `.githooks/commit-msg` or `verify-no-pii.mjs --messages`, which only see commits
made locally. The "describe the shape, never the value" rule in `AGENTS.md` applies here
in full, and for the same reason it applies to a PR description.

## What the updater enforces

With `trusted-signers` present, `update-system.mjs` (both `check` and `apply`):

- fetches all tags and takes the **highest** version tag greater than the install,
- runs `git verify-tag` against `trusted-signers`,
- applies **only** if the signature verifies. A higher-but-unsigned tag, or one
  signed by a key not in `trusted-signers`, is refused; `check` then reports
  `up-to-date` with `reason: "unverified-newer"`.

## Rotating or adding a signer

`trusted-signers` ships in the bundle and is not self-updated, so changing it
requires a new `.exe`. Add the new public-key line, commit, rebuild, and ship.
Keep the old line until every install has moved to a bundle carrying the new key.

## Why this step is easy to miss

Forgetting to sign does **not** break an install. It silently freezes it.

`update-system.mjs` only offers a tag whose signature verifies, so an unsigned
newest tag makes every anchored install report "nothing newer" and say nothing
else. There is no error anywhere: `release.yml` emits a `::warning` when
`TAG_SIGNING_SSH_KEY` is unset and still exits 0, so the release run goes green.

That is not hypothetical. It happened to `v1.11.0` and again to `v1.16.0`, both
with a green release run.

`.github/workflows/tag-signature.yml` exists for exactly this. It fails when the
newest tag is unsigned, distinguishing the two cases, because they need different
fixes:

- a **lightweight** tag (what Release Please creates via the API) cannot carry a
  signature at all;
- an **annotated** tag whose signature is absent, malformed, or made by a key not
  pinned in `trusted-signers`.

It deliberately does not live in `release.yml`. The signing key is kept off CI on
purpose, so the unset-key branch is the normal path and failing there would go red
on every release by design — and a check that always fails is a check nobody
reads, which is the failure being guarded against.

## A red release run does not mean the release failed

The opposite of the trap above, and it happened on `v1.16.2`.

`release-please` creates the GitHub release and the tag, and only *then* goes on
to build the next standing release PR. A transient GitHub API error during that
second phase fails the job **after** the release is already published. The run
shows red, the release exists anyway.

Check what actually happened before reacting:

```bash
gh release view vX.Y.Z --json tagName,isDraft
git fetch --tags && git cat-file -t vX.Y.Z     # "tag" = annotated, "commit" = lightweight
```

If the release and tag exist, do **not** re-run the workflow or re-cut the
version. Carry on and sign the tag as normal.

One consequence worth knowing: the in-workflow signing step is gated on
`release_created`, so a job that dies mid-run skips it entirely. If you ever do
set `TAG_SIGNING_SSH_KEY`, a red release run means the tag is unsigned even
though signing was configured.

## Notes

- Sign the tag promptly after Release Please creates it, before you build the
  `.exe` for that version.
- `tag.gpgsign` is deliberately left unset, so tags are signed only when you pass
  `-s` explicitly. That is why every command here spells it out.
- Windows binary signing (SmartScreen) is a separate, independent concern; tag
  signing protects the self-update channel specifically.
