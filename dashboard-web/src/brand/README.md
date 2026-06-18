# trajecktory — Brand Mark

Logo assets for the trajecktory dashboard. Mark = **Rising Arc** (origin dot → trajectory curve → haloed apex node). Wordmark = **JetBrains Mono**, with the `ck` tinted violet so the spelling reads as intentional.

## Files

| File | Use |
|---|---|
| `trajecktory-mark.svg` | Icon only — sidebar brand mark, loaders, anywhere ≥20px. Pure vector, font-free. |
| `trajecktory-lockup-mono.svg` | Horizontal lockup (mark + wordmark + `Career Pipeline V3.0`). Wordmark uses `<text>` with JetBrains Mono — load that font where it renders. |
| `trajecktory-favicon.svg` | Rounded-tile app icon, knockout arc on the violet gradient. Use as favicon / PWA icon. |

## Color tokens (already in the dashboard)

```
--accent      #A78BFA   arc / apex / "ck" tint
--accent-2    #C4B5FD   gradient light stop, apex fill on dark
--accent-deep #6D28D9   gradient dark stop (favicon tile)
--text        #E8E8EA   wordmark on dark
--text-mute   #5D5D66   origin dot, sub-label
knockout      #0A0A0C   mark on accent surfaces
```

On a **light** surface, swap the arc/apex to `#7C3AED` and the origin dot to `#A1A1AA`.

---

## Integration — replace the sidebar brand block

The current dashboard sidebar (`shared.jsx`, `Sidebar` component) renders:

```jsx
<div className="sidebar-brand">
  <div className="brand-mark">CO</div>
  <div className="brand-text">
    <strong>Career-Ops</strong>
    <span>v2.4 · live</span>
  </div>
</div>
```

Replace it with the inline mark + mono wordmark:

```jsx
<div className="sidebar-brand">
  <div className="brand-mark trajecktory">
    <svg width="22" height="22" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="14" cy="50" r="3.2" fill="#5D5D66"/>
      <path d="M14 50 C 27 46 41 35 50 14" stroke="#C4B5FD" stroke-width="5" stroke-linecap="round"/>
      <circle cx="50" cy="14" r="7" fill="#C4B5FD"/>
    </svg>
  </div>
  <div className="brand-text">
    <strong className="mono">traje<span style={{ color: "var(--accent)" }}>ck</span>tory</strong>
    <span>Career Pipeline v3.0</span>
  </div>
</div>
```

Brand-mark tile style (replace the old gradient `CO` tile):

```css
.brand-mark.trajecktory {
  width: 34px; height: 34px;
  border-radius: 9px;
  display: grid; place-items: center;
  background: linear-gradient(155deg, #1a1320, #0d0d11);
  border: 1px solid var(--border-2);
  box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset;
}
.brand-text strong.mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-size: 14px;
}
```

> Prefer the **knockout-on-accent** variant? Use a `.brand-mark.solid` tile
> (`background: linear-gradient(155deg, var(--accent), var(--accent-deep))`)
> and set the SVG `stroke`/`fill` to `#0A0A0C`.

## Favicon

```html
<link rel="icon" type="image/svg+xml" href="/brand/trajecktory-favicon.svg" />
```

## Also update

- Page `<title>` → `trajecktory · Dashboard`
- Any "Career-Ops" string in headers/footers/command-palette → `trajecktory`
