# trajecktory Dashboard Design Audit
## For Claude Design Brief

---

## **Color Palette**

### Dark Theme (Default)
```
--bg:        #08080b      (darkest background)
--bg-2:      #0d0d11      (secondary bg, used in sidebar)
--panel:     #111116      (card/panel background)
--panel-2:   #16161c      (hover/secondary panel)

--border:    #1f1f27      (primary borders)
--border-2:  #2a2a33      (secondary borders, hover state)

--text:      #e8e8ea      (primary text, body copy)
--text-dim:  #8b8b94      (secondary text, muted)
--text-mute: #5d5d66      (very muted, labels, small text)

--accent:    #a78bfa      (purple, CTAs, highlights)
--accent-2:  #c4b5fd      (lighter purple for hover)
--accent-bg: rgba(167,139,250,0.12) (purple background with transparency)

--green:     #22c55e      (status: success, positive)
--yellow:    #eab308      (status: warning)
--red:       #ef4444      (status: danger, negative)
--blue:      #60a5fa      (accent: secondary)
--cyan:      #22d3ee      (accent: tertiary)
--orange:    #f59e0b      (accent: tertiary)
```

### Light Theme
- Inverted: light backgrounds (#f5f5f4), darker text (#18181b)
- Accent: purple (#7c3aed) → darker purple (#6d28d9) on hover
- Same semantic colors (green, red, yellow) with light theme values

---

## **Typography**

| Usage | Font | Size | Weight | Letter-spacing |
|-------|------|------|--------|-----------------|
| Body text | Inter, system sans-serif | 13px | 400 | -0.005em |
| Headings | Inter | 22px | 600 | -0.02em |
| Monospace (numbers, IDs) | JetBrains Mono | various | 600-700 | varies |
| Labels, status | JetBrains Mono | 10-11px | 500 | 0.08em–0.14em |
| Card titles | JetBrains Mono | 11px | 500 (uppercase) | 0.14em |
| Sidebar nav | Inter | 13px | 400 | normal |

**Compact mode**: font-size reduces to 12px

---

## **Spacing & Layout**

### Gaps / Gutters
- **Cards**: 14px padding (padded-lg: 18px)
- **Grid gaps**: 14px (standard)
- **Sidebar padding**: 14px horizontal, 12px vertical
- **Content area**: 18px top/bottom, 22px left/right
- **Content bottom padding**: 60px (scroll clearance)

### Border Radius
- **Cards, panels**: 10px
- **Buttons, inputs, pills**: 6–8px
- **Navigation items**: 6px
- **Rounded (full circle)**: 999px (pills, avatars)

### Sizing
- **Sidebar width**: 232px
- **Icon buttons**: 30px × 30px
- **KPI tiles**: flexible, min padding 14px 16px
- **Card head margin-bottom**: 12px

---

## **Component Patterns**

### Cards/Panels
```
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
}
```
- Used for: app containers, KPIs, content sections
- Hover: background changes to --panel-2
- Selected: background becomes --accent-bg

### Buttons
```
.btn — default (secondary)
.btn.primary — accent background, dark text
.btn.success — green tinted
.btn.danger — red tinted
.btn.ghost — transparent, no border
.btn.accent — lighter accent background
.btn.sm — smaller padding/font
```

### Chips / Pills (Filters, Status)
```
.chip {
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
}
.chip.on { background: var(--accent-bg); color: var(--accent); }
```

### Status Indicators (Pill)
- Colored dot + text
- Used in tables for status labels (Applied, Interview, Offer, etc.)

### KPI Tiles
```
.kpi {
  display: flex; flex-direction: column; gap: 4px;
  padding: 14px 16px;
  background: var(--panel); border: 1px solid var(--border);
}
```
- Label (10px, muted, monospace)
- Large value (28px, bold, monospace)
- Delta indicator (small, green/red)
- Sparkline chart (faint, bottom-right)

### Tables
```
.tbl-wrap { border-radius: 10px; background: var(--panel); }
.tbl thead { background: var(--panel-2); monospace labels }
.tbl tbody tr:hover { background: var(--panel-2); }
.tbl tbody tr.selected { background: var(--accent-bg); }
```

### Tab Strip (Top Navigation)
```
.tabs {
  display: flex; gap: 2px;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px;
}
.tabs button.active { background: var(--bg); color: var(--text); }
```

### Sidebar Navigation Item
```
.nav-item {
  padding: 7px 10px; border-radius: 6px;
  color: var(--text-dim);
}
.nav-item.active {
  background: var(--accent-bg);
  border-left: 2px solid var(--accent);
}
```

---

## **Density & Spacing Rules**

### Comfortable (Default)
- Font size: 13px
- Button padding: 6px 12px
- Card padding: 14px 16px
- Gap between elements: 14px

### Compact
- Font size: 12px
- Table cell padding: 6px 12px (instead of 9px 12px)
- Tighter vertical spacing

---

## **Shadows & Depth**

### Inset Shadow (panel depth)
```
--shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 
          0 12px 40px -12px rgba(0,0,0,0.6)
```

### Icon Shadows (brand mark accent glow)
```
box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset, 
            0 4px 12px -4px var(--accent);
```

### Streak Flame (sidebar)
```
box-shadow: 0 0 16px -4px rgba(245,158,11,0.5);
```

---

## **Key Visual Behaviors**

### Hover States
- Buttons: background → --panel-2, border → --border-2
- Nav items: background → --panel
- Cards/tables: subtle background lighten

### Active/Selected States
- Accent background with accent color text
- Left border indicator (2px accent) for nav items
- Full background fill for buttons

### Focus States
- Input focus: border-color → accent, box-shadow with accent-bg

### Status Indicators
- **Green** (#22c55e): success, completed, active
- **Red** (#ef4444): failed, rejected, negative
- **Yellow** (#eab308): warning, pending, caution
- **Accent purple** (#a78bfa): primary actions, highlights

---

## **Grid Layouts**

### Responsive Grids
```
.grid.cols-2 { grid-template-columns: 1fr 1fr; }
.grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
.grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
.grid.overview { grid-template-columns: 1fr 1.1fr; }
```

- **Kanban columns**: 240px min, 5 columns at medium width
- **Content area**: max-width ~1400px (implicit via grid)

---

## **Current LinkedIn SSI Module Issues**

✗ **Inconsistencies**:
1. Not using standard `.card` class structure
2. Inline styles instead of CSS variables (hardcoded colors)
3. Button styling doesn't match `.btn` variants
4. Typography not consistently using monospace for labels
5. Spacing/padding inconsistent with other modules
6. Missing accent indicator dots on card titles
7. Form inputs not styled with dashboard standard (--panel background, --border outline)

---

## **Design Recommendation for Claude Design**

Share:
1. **Screenshots** of LinkedIn SSI current module
2. **Screenshots** of reference modules (Overview, Pipeline, Analytics)
3. **This audit** (CSS variables, component patterns, spacing rules)

**Request Claude Design**:
- Redesign LinkedIn SSI to use card/panel patterns, standard button styles, consistent typography
- Maintain the 5-view structure (Dashboard, Influencers, Activity Log, Weekly Tracker, AI Response Generator)
- Ensure all buttons follow .btn/.btn.primary patterns
- Ensure all labels are uppercase, monospace, 10-11px
- Maintain consistent accent color usage (purple #a78bfa)
- Use grid layouts matching other modules
- Ensure form inputs follow dashboard standards

---

## **Files to Review**

- `styles.css` — full design system (500+ lines)
- `overview.jsx` — reference component structure
- `pipeline.jsx` — reference table/kanban layout
- `recruiters.jsx` — reference form/input patterns
- `linkedin-ssi.jsx` — current module (needs refresh)
