# Setup Guide

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and configured
- Node.js 18+ (for CV generation, the dashboard, and utility scripts)

## Quick Start (5 steps)

### 1. Clone and install

```bash
git clone https://github.com/michaelinghilterra-creator/trajecktory.git
cd trajecktory
npm install
npx playwright install chromium   # Required for liveness checks and portal scanning
```

### 2. Configure your profile

```bash
cp config/profile.example.yml config/profile.yml
```

Edit `config/profile.yml` with your personal details: name, email, target roles, narrative, proof points.

### 3. Add your CV

Create `cv.md` in the project root with your full CV in markdown format. This is the source of truth for all evaluations and generated CVs.

(Optional) Create `article-digest.md` with proof points from your portfolio projects/articles.

### 4. Configure portals

```bash
cp templates/portals.example.yml portals.yml
```

Edit `portals.yml`:
- Update `title_filter.positive` with keywords matching your target roles
- Add companies you want to track in `tracked_companies`
- Customize `search_queries` for your preferred job boards

### 5. Start using

Open Claude Code in this directory:

```bash
claude
```

Then paste a job offer URL or description. trajecktory will automatically evaluate it, generate a report, create a tailored CV (Word docx), and track it.

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/trajecktory scan` |
| Process pending URLs | `/trajecktory pipeline` |
| Generate a tailored CV (Word) | `/trajecktory docx` (PDF flow `/trajecktory pdf` is legacy) |
| Batch evaluate | `/trajecktory batch` |
| Check tracker status | `/trajecktory tracker` |
| Fill application form | `/trajecktory apply` |

## Verify Setup

```bash
node cv-sync-check.mjs      # Check configuration
node verify-pipeline.mjs     # Check pipeline integrity
```

## Run the Dashboard (Optional)

The web dashboard visualizes your pipeline, reports, follow-ups, and analytics.

```bash
cd dashboard-web
npm ci
npm start            # then open the URL shown (default http://localhost:3333)
```

It runs locally only (binds `127.0.0.1`). For the dashboard's optional draft
features (cover letters, outreach) and Obsidian push, copy
`dashboard-web/.env.example` to `dashboard-web/.env` and fill in your keys.
The main `/trajecktory` pipeline runs on your Claude Code login and needs no key.
