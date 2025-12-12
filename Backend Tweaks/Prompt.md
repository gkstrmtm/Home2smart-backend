# Home2Smart Pro Portal – UI / Styling Spec (v1)

This document is for the front-end / AI agent only.

- All core logic, endpoints, and data flow are already correct.
- Do not change business logic, JSON contracts, or API calls.
- Stay inside HTML, CSS, and minor structural tweaks that do not break existing hooks.

The goal is:
- Mobile-first UI
- Deep, modern dark theme
- Clean hierarchy
- Award-level polish without “flashy” gimmicks

---

## 1. Brand and Theme

### 1.1 Brand colors

Use these as tokens. Do not invent new hex codes unless updating this section.

- `--h2s-brand-cobalt: #0A2A5A`        primary brand
- `--h2s-brand-azure:  #1493FF`        primary CTA blue
- `--h2s-brand-green:  #22C96F`        earnings / success
- `--h2s-brand-gold:   #FFC857`        warnings, overdue, attention

### 1.2 Dark surfaces

- `--h2s-bg-root:          #020617`    global app background (almost black navy)
- `--h2s-bg-shell:         #050D1A`    page containers
- `--h2s-bg-card:          #071426`    standard card background
- `--h2s-bg-card-elevated: #081A33`    hero / highlight cards
- `--h2s-bg-input:         #030B18`    inputs and textareas
- `--h2s-border-subtle:    #0D223D`
- `--h2s-border-strong:    #1A3C6A`

Gradients:

- `--h2s-bg-root-gradient`  
  Radial gradient from top right: `#0A2A5A` fading into `#020617`.
- `--h2s-bg-card-gradient-soft`  
  Linear gradient 135deg, from `#071426` to `#050D1A` for elevated hero cards.

Do not use bright, milky blues as backgrounds. Bright blues are reserved for CTAs, badges, and small accents.

### 1.3 Typography and text colors

Font stack should remain consistent across the portal.

Text tokens:

- `--h2s-text-main:   #E6F2FF`   main body text
- `--h2s-text-muted:  #9BB0CC`   meta information
- `--h2s-text-soft:   #7183A0`   helper text, de-emphasised copy
- `--h2s-text-invert: #020617`   text on light or bright buttons

Rules:

- Body text: `--h2s-text-main` on any card.
- Secondary labels: `--h2s-text-muted`.
- Help text and long descriptions: `--h2s-text-soft`.
- Never place low contrast text on mid-tone backgrounds.

---

## 2. Layout Principles

### 2.1 Mobile first

- Base CSS is written for **mobile** (around 360–430px widths).
- Use `@media (min-width: 768px)` to upgrade to tablet / small desktop.
- Use `@media (min-width: 1024px)` for full desktop refinements.
- Desktop is not allowed to drive the design. Mobile is primary.

### 2.2 Page rail

On mobile:

- One main vertical rail.
- Global horizontal padding: `16px` from the screen edge.
- All cards and sections align to this rail.
- No horizontal scrolling.

On desktop:

- Content may sit in a centered container with max-width (for example 1040–1200px).
- You may introduce simple two or three column grids for summary cards and analytics, but the order and hierarchy must stay consistent with the mobile column.

### 2.3 Vertical rhythm

Use a consistent rhythm so nothing feels random.

- Section top margin: 24px from previous section’s last card.
- Card gap within a section: 12–16px.
- Card internal padding: 16px on mobile, up to 20–24px on desktop.
- Section titles:
  - 16px above the first card in that section.
  - 8px below the title before the first card.

Avoid extra spacer divs that break the rhythm.

---

## 3. Header (App Bar)

### 3.1 Purpose

On mobile the header is a compact app bar, not a hero. It should:

- Anchor the brand
- Expose navigation
- Stay out of the way of job cards

### 3.2 Structure

Header uses two groups:

- Left: logo and small title
- Right: icon buttons (Support optional, menu required)

Example structure:

```html
<header class="h2s-header">
  <div class="h2s-header-left">
    <img class="h2s-logo" src="..." alt="Home2Smart" />
    <span class="h2s-header-title">Pro Portal</span>
  </div>

  <div class="h2s-header-right">
    <!-- Optional: Support icon -->
    <button class="h2s-header-icon h2s-header-support" aria-label="Support"></button>

    <button class="h2s-header-icon h2s-header-menu" aria-label="Menu"></button>
  </div>
</header>
