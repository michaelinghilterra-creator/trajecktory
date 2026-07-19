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

## Each release

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

## Notes

- Sign the tag promptly after Release Please creates it, before you build the
  `.exe` for that version.
- Windows binary signing (SmartScreen) is a separate, independent concern; tag
  signing protects the self-update channel specifically.
