# Contributing to trajecktory

Thanks for your interest in contributing! trajecktory is built with Claude Code, and you can use it for development too.

## Before Submitting a PR

**Please open an issue first to discuss the change you'd like to make.** This helps us align on direction before you invest time coding.

PRs without a corresponding issue may be closed if they don't align with the project's architecture or goals.

### What makes a good PR
- Fixes a bug listed in Issues
- Addresses a feature request that was discussed and approved
- Includes a clear description of what changed and why
- Follows the existing code style and project philosophy (simple, minimal, quality over quantity)

## Quick Start

1. Open an issue to discuss your idea
2. Fork the repo
3. Create a branch (`git checkout -b feature/my-feature`)
4. Make your changes
5. Test with a fresh clone (see [docs/SETUP.md](docs/SETUP.md))
6. Commit and push
7. Open a Pull Request referencing the issue

## What to Contribute

**Good first contributions:**
- Add companies to `templates/portals.example.yml`
- Translate modes to other languages
- Improve documentation
- Add example CVs for different roles (in `examples/`)
- Report bugs via [Issues](https://github.com/michaelinghilterra-creator/trajecktory/issues)

**Bigger contributions:**
- New evaluation dimensions or scoring logic
- Dashboard features (in `dashboard-web/`)
- New skill modes (in `modes/`)
- Script improvements (`.mjs` utilities)

## Guidelines

- Keep modes language-agnostic when possible (Claude handles both EN and ES)
- Scripts should handle missing files gracefully (check `existsSync` before `readFileSync`)
- Dashboard changes (dashboard-web) require a successful `npm run build` — test with real data before submitting
- Don't commit personal data (cv.md, profile.yml, applications.md, reports/)

## What we do NOT accept

- **PRs that scrape platforms prohibiting automated access** (LinkedIn, etc.). We actively reject these to respect third-party ToS.
- **PRs that enable auto-submitting applications** without human review. trajecktory is a decision-support tool, not a spam bot.
- **PRs that add external API dependencies** without prior discussion in an issue.
- **PRs containing personal data** (real CVs, emails, phone numbers). Use `examples/` with fictional data instead.

## Contributor License and Sign-Off (DCO)

Every contribution needs a Developer Certificate of Origin sign-off plus an
inbound license grant.

**Sign-off (DCO).** Sign off each commit to certify you wrote the change, or have
the right to submit it, under the terms below:

```bash
git commit -s -m "your message"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line, certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/).

**License grant.** By contributing, you agree your contribution is licensed under
the project's [MIT LICENSE](LICENSE), and you grant the project maintainer a
perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use,
reproduce, modify, and relicense your contribution as part of trajecktory,
including under different license terms in future releases. You keep the
copyright to your own contribution. This keeps the project's future licensing
flexible; it is not legal advice, so for large or commercial contributions,
consult your own counsel.

## Development

```bash
# Scripts
npm run doctor                # Setup validation
node verify-pipeline.mjs     # Health check
node cv-sync-check.mjs        # Config check

# Dashboard (dashboard-web)
cd dashboard-web && npm ci && npm start
```

## Brand and Trademark

Contributions to the codebase are governed by the MIT [LICENSE](LICENSE).
"trajecktory" is the project's brand name. If you fork the project for
commercial use, you're welcome to do so under MIT, but please give it your
own product name and do not imply endorsement.

## Need Help?

- [Open an issue](https://github.com/michaelinghilterra-creator/trajecktory/issues)
- [Read the architecture docs](docs/ARCHITECTURE.md)
