# Talent Acquisition Module -- Design Audit for Claude Design

## Purpose

This document describes the current state of the **Talent Acquisition** module in the trajecktory dashboard. Use it to design a visual overhaul that matches the quality bar set by the LinkedIn SSI module.

---

## What We Need From You (Claude Design)

To avoid the iteration pain from the LinkedIn SSI round, please provide:

1. **One screenshot per view/state** (Main List, Drawer open, Reconcile modal -- each step)
2. **Explicit layout values** for every grid/flex container:
   - Column ratios (e.g., `2fr 3fr`) or fixed widths
   - Gap sizes in px
   - Max-widths and min-widths
3. **A token mapping table** -- map every color to an existing CSS variable:
   - `--accent` (#a78bfa), `--green` (#22c55e), `--blue` (#60a5fa), `--cyan` (#22d3ee), `--orange` (#f59e0b)
   - `--bg` (page background), `--panel` (card bg), `--panel-2` (input bg), `--border` (borders)
   - `--text` (primary), `--text-dim` (secondary), `--text-mute` (tertiary)
   - `--mono` (JetBrains Mono)
4. **Responsive notes** -- anything that changes at narrow (<1100px) or ultrawide (>2400px) viewports
5. **The exported source CSS and JSX** -- like the LinkedIn SSI handoff (`ssi-styles.css` + per-view JSX)

---

## Existing Design Tokens (styles.css)

These are the tokens the live dashboard already uses. **Do not introduce new colors or fonts** -- map everything to these:

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#0e0e12` | Page background |
| `--panel` | `#18181f` | Card/section background |
| `--panel-2` | `#1e1e28` | Input fields, nested panels |
| `--border` | `#2a2a35` | All borders |
| `--accent` | `#a78bfa` | Purple -- primary actions, active states |
| `--accent-bg` | `rgba(167,139,250,0.12)` | Accent tint backgrounds |
| `--green` | `#22c55e` | Success, positive status |
| `--blue` | `#60a5fa` | Info, secondary actions |
| `--cyan` | `#22d3ee` | Tertiary accent |
| `--orange` | `#f59e0b` | Warning, attention |
| `--text` | `#e4e4e7` | Primary text |
| `--text-dim` | `#a1a1aa` | Secondary text |
| `--text-mute` | `#71717a` | Tertiary/disabled text |
| `--mono` | `"JetBrains Mono", monospace` | Monospace font |
| Body font | `"Inter", system-ui, sans-serif` | Default body font |
| Base size | `13px` (14px at >1600px, 16px at >2400px) | Body font size |

### Responsive Content Padding

The `.content` area and `.tabstrip-wrap` share the same left padding at each breakpoint:

| Breakpoint | `.content` padding | Left gutter |
|------------|-------------------|-------------|
| Default | `18px 22px 60px` | 22px |
| >1600px | `24px 32px 80px` | 32px |
| >2400px | `32px 48px 100px` | 48px |

Content children are capped at `max-width: 1680px` with `margin: auto` (2200px at >2400px).

---

## Current Module Structure

### Views

The module has **3 UI surfaces** (not subtabs -- overlays on a single list view):

| Surface | Trigger | Description |
|---------|---------|-------------|
| **Main List** | Tab click | Full-width sortable/filterable data table |
| **Contact Drawer** | Row click | Right-side panel showing contact details, outreach, correspondence |
| **Reconcile Modal** | "Reconcile" button | 3-step wizard: Preview -> Discover -> Apply |

### Status Pipeline (8 states)

| Status | Color Token | Hex | Meaning |
|--------|-------------|-----|---------|
| Not Contacted | `--text-mute` | `#a1a1aa` bg `rgba(113,113,122,0.14)` | Default, no outreach yet |
| Drafted | `--accent` | `#a78bfa` bg `rgba(167,139,250,0.16)` | Outreach email drafted |
| Sent | `--blue` | `#60a5fa` bg `rgba(96,165,250,0.16)` | Email sent |
| Replied | `--cyan` | `#22d3ee` bg `rgba(34,211,238,0.16)` | Got a response |
| Meeting Scheduled | `--orange` | `#f59e0b` bg `rgba(245,158,11,0.16)` | Call/meeting booked |
| Connected | `--green` | `#22c55e` bg `rgba(34,197,94,0.16)` | Relationship established |
| Dormant | gray | `#71717a` bg `rgba(82,82,91,0.14)` | Paused, not active |
| Archived | dim gray | `#52525b` bg `rgba(82,82,91,0.10)` | No longer relevant |

---

## View 1: Main List

### Current Layout

```
+------------------------------------------------------------------+
| Talent Acquisition                    [Show archived] [Reconcile] |
| 75 of 80 contacts - 44 companies - sorted by company             |
|                                                                   |
| [Not Contacted 32] [Sent 34] [Replied 1]  Archived 5             |
|                                                                   |
| [Search box ........................] [All states v] [All cos v]  |
|                                                                   |
| # | TARGET COMPANY | NAME | TITLE | CITY | STATE | STATUS | LAST |
|---|----------------|------|-------|------|-------|--------|------|
| ...rows (75 visible, scrollable, max-height: calc(100vh - 360px))|
+------------------------------------------------------------------+
```

### Header Section
- **Title**: "Talent Acquisition" -- `h2` equivalent, no card wrapper
- **Subtitle**: "{n} of {total} contacts - {n} target companies - sorted by {field}"
- **Top-right buttons**: "Show archived (n)" checkbox, "Reconcile" (accent bg), "Refresh" (ghost)

### Status Breakdown Chips
- Horizontal row of clickable pills showing counts per status
- Active statuses only (non-zero counts are colored, zero counts shown dimmed)
- Click to filter the table by that status

### Filter Bar
- Text search input (full-width minus dropdowns)
- "All states" dropdown
- "All target companies" dropdown
- Clear button (appears when filters active)

### Data Table
- Uses global `.tbl` / `.tbl-wrap` CSS classes
- Scrollable body with sticky header
- 8 columns with fixed widths:

| Column | Key | Width | Content |
|--------|-----|-------|---------|
| # | id | 50px | Row number, mono font |
| Target Company | company | 220px | Company name |
| Name | last | 180px | "{first} {last}" combined |
| Title | title | 240px | Job title |
| City | city | 110px | City name |
| State | state | 60px | State abbreviation |
| Status | status | 130px | Colored status pill |
| Last Touch | lastTouch | 100px | Date or "--" |

- Rows are clickable (open drawer)
- Sorted by company name ascending by default
- Sort toggles on column header click

### Current Issues / Design Opportunities
- No visual hierarchy -- it's a raw data table with no cards or sections
- Status chips at the top are functional but visually flat
- No summary KPIs (e.g., outreach rate, response rate, contacts per company)
- No empty state design for filtered-to-zero results
- The table dominates the full viewport -- no breathing room
- "Reconcile" and "Refresh" buttons feel disconnected from the data

---

## View 2: Contact Drawer

### Current Layout

```
+-----------------------------------------------+
| #923 [Sent] [+ 1 related app]          [X]    |
| Jane Doe                                       |
| Talent Acquisition Specialist                   |
| Example Corp                                    |
|                                                 |
| CONTACT                                         |
| Company Website | example.com      Copy         |
| Email           | jane@...        Copy         |
| Location        | Austin, TX                    |
| LinkedIn        | Open profile                  |
| Last Touch      | 2026-05-27                    |
|                                                 |
| RELATED APPLICATIONS AT EXAMPLE CORP        1  |
| [#332 Senior Operations Manager 4.6/5 Applied] |
|                                                 |
| PIPELINE STAGE                                  |
| [Not Contacted][Drafted][Sent][Replied]...      |
|                                                 |
| NOTES                                           |
| (textarea with existing notes)                  |
|                                                 |
| OUTREACH                                        |
| [+ Draft follow-up] [Log sent] [Log received]  |
|                                                 |
| CORRESPONDENCE                          1 MSG  |
| Sent                          2026-05-27 13:17  |
| Following up: Senior Operations Manager...     |
| (full email body)                               |
+-----------------------------------------------+
```

### Drawer Properties
- Uses global `.drawer.wide` class (slides in from right, ~520px wide)
- Backdrop dims the table behind it
- Close button (X) top-right

### Sections
1. **Header**: ID badge, status pill, "related app" count badge, name, title, company
2. **Contact info**: Key-value table (`.cs-table`) with Copy buttons and external links
3. **Related Applications**: Cards for applications at the same company (score, status)
4. **Pipeline Stage**: Horizontal button row for all 8 statuses (click to change)
5. **Notes**: Editable textarea with auto-save
6. **Outreach**: "Draft follow-up" (accent), "Log sent message", "Log received reply" buttons
7. **Correspondence**: Chronological message log with direction badges (Sent/Received)

### Current Issues / Design Opportunities
- Contact info table is dense and hard to scan
- Pipeline stage buttons are all inline with no visual indication of progression
- Correspondence messages are long unformatted text blocks
- No visual timeline or conversation threading
- Outreach section could surface AI-drafted message inline rather than replacing content
- Related applications card could show more context (score breakdown, interview stage)

---

## View 3: Reconcile Modal

### 3-Step Wizard Flow

**Step 1 -- Preview**
- Shows two sections:
  - "Archive candidates" -- contacts at companies with zero active applications
  - "Companies needing contacts" -- companies in pipeline with no TA contacts
- Each row has a checkbox for selection
- "Next" button advances to step 2

**Step 2 -- Discover**
- Claude performs web search for TA contacts at selected companies
- Shows results as a list of discovered contacts with name, title, company, LinkedIn URL
- Each result has a checkbox to include in bulk-add
- "Apply" button advances to step 3

**Step 3 -- Apply**
- Confirmation screen showing what was archived and what was added
- "Done" button closes modal and refreshes list

### Current Issues / Design Opportunities
- Modal is a basic full-screen overlay, no step indicator or progress bar
- No loading/spinner state during Claude's web search
- Results are plain text rows, could be cards with more structure
- No undo/rollback option after applying

---

## Data Shape (for mock data)

### Contact Record
```json
{
  "id": 923,
  "company": "Example Corp",
  "last": "Doe",
  "first": "Jane",
  "salute": "Ms.",
  "title": "Talent Acquisition Specialist",
  "city": "Austin",
  "state": "TX",
  "zip": "78701",
  "phone": "",
  "email": "jane.doe@example.com",
  "linkedin": "https://linkedin.com/in/example",
  "status": "Sent",
  "lastTouch": "2026-05-27",
  "notes": "Confirmed via LinkedIn; SHRM-CP certified"
}
```

### Current Data Stats
- **80 total contacts** (75 visible, 5 archived)
- **44 target companies**
- **Status breakdown**: Not Contacted 32, Sent 34, Replied 1, Archived 5, New 1
- **Status colors**: See pipeline table above

---

## Existing CSS Classes Used

The module uses these global classes from `styles.css` (do not rename or replace):

| Class | Purpose |
|-------|---------|
| `.tbl`, `.tbl-wrap` | Data table container and scrollable wrapper |
| `.tbl thead th` | Sticky column headers |
| `.card` | Generic card container (panel bg, border, radius 10px) |
| `.card-head`, `.card-title` | Card header with dot + uppercase mono title |
| `.cs-section`, `.cs-section-head` | Drawer content sections |
| `.cs-table` | Key-value info table inside drawer |
| `.drawer`, `.drawer.wide` | Slide-in right panel |
| `.drawer-backdrop` | Dimming overlay behind drawer |
| `.drawer-head`, `.drawer-body` | Drawer header and scrollable body |
| `.filterbar` | Filter controls container |
| `.btn`, `.btn.primary` | Button styles |
| `.mono`, `.dim`, `.muted` | Typography utilities |
| `.no-data` | Empty state text |
| `.subtabs`, `.subtab` | Sub-navigation tabs (if you add them) |
| `.field`, `.inp`, `.sel`, `.ta` | Form field, input, select, textarea |
| `.tag`, `.tag.accent` | Outlined tag chips |
| `.pill`, `.pill.green`, `.pill.accent` | Status pills with dots |
| `.mono-av`, `.mono-av.sm` | Monogram avatar circles |
| `.bar`, `.bar > span` | Progress bars |

---

## Design Direction / Wishlist

These are suggestions, not mandates -- use your judgment:

1. **Add summary KPIs at the top** (like LinkedIn SSI has): outreach rate, response rate, contacts per company avg, pipeline velocity
2. **Modernize the table** -- consider alternating row tones, hover states, or a card-list hybrid
3. **Improve the drawer** -- group contact info into a cleaner card, add a visual timeline for correspondence, show pipeline stage as a horizontal progress bar rather than flat buttons
4. **Add a step indicator to the Reconcile modal** (1/3, 2/3, 3/3) with transition animations
5. **Consider subtabs** if it makes sense -- e.g., "Contacts" (list), "Companies" (grouped view), "Analytics" (response rates)
6. **Status pills** could match the LinkedIn SSI badge style (outlined, mono font, colored border)

---

## File References

| File | Path | Purpose |
|------|------|---------|
| Component | `dashboard-web/src/target-talent.jsx` | All 3 views (940 lines) |
| Server API | `dashboard-web/server/index.mjs` (lines 1643-2059) | 10 REST endpoints |
| Data | `data/target-talent.md` | Contact records (markdown table) |
| Correspondence | `data/target-talent-correspondence/{id}.md` | Per-contact message history |
| Styles | `dashboard-web/src/styles.css` | Global design tokens + component classes |
| App wiring | `dashboard-web/src/app.jsx` (line 242) | `tab === "target-talent"` |
