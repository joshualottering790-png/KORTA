# KORTA — Premium Padel Equipment

South Africa's premium destination for padel rackets, balls, apparel and accessories.

A single-file, zero-dependency storefront. No build step, no npm install, no framework — open `index.html` and it runs.

---

## Quick start

```bash
git clone https://github.com/<your-username>/korta.git
cd korta
open index.html          # macOS
start index.html         # Windows
```

Or serve locally:

```bash
python3 -m http.server 8000     # visit http://localhost:8000
```

---

## Deploying

### GitHub Pages
1. Push this repo to GitHub
2. **Settings → Pages → Source:** `Deploy from a branch`
3. Branch `main`, folder `/ (root)` → **Save**
4. Live at `https://<your-username>.github.io/korta/`

For `korta.co.za`, add a file named `CNAME` at the root containing:

```
korta.co.za
```

then point your DNS at GitHub Pages.

### Netlify / Vercel / Cloudflare Pages
Drag the folder in or connect the repo. No build command; publish directory is the root.

---

## Features

**Homepage** — Hero · Featured Brands · Featured Rackets · Shop by Category · Why KORTA · Reviews · Trending Now · Newsletter · Find Your Perfect Racket · Footer

**Search** — full-catalogue search across name, category, play style, skill level, weight, balance and description. Quick-filter chips; results open the product detail view.

**Category browse** — every category tile opens a full product listing with sort by Featured / Price ↑ / Price ↓ / Top Rated. Counts read from the catalogue automatically.

**Product detail** — opens as a lightbox with large artwork, full specifications and a written description.

**Quick Compare** — select two rackets and compare weight, balance, level, play style and price side by side. The panel opens only once a second item is chosen.

**Cart** — slide-out drawer with quantities, per-item removal, live subtotal and totals.

**Wishlist** — same drawer pattern, with Move to Bag on each item and Move All to Bag.

**Checkout** — order summary plus payment options (Card, Instant EFT/Ozow, SnapScan, PayFast, Apple/Google Pay). **No gateway is connected — nothing is charged.**

**Racket finder quiz** — four questions, scored against the racket pool, returns the top three matches.

---

## Structure

Everything is in `index.html` — HTML, CSS and JavaScript in one file:

| Section | Contents |
|---|---|
| `:root` | Design tokens: colours, fonts, easing |
| Background | Aurora, court grid, motes, vignette |
| Preloader | Court lines → calligraphic K |
| Components | Nav, hero, cards, overlays, footer, mobile nav |
| `<script>` data | `PRODUCTS`, `BEST`, `MORE`, `CATS`, `REVIEWS`, `RACKET_POOL` |
| `<script>` art | `racketSVG()`, `productArt()`, `catArt()` |
| `<script>` behaviour | Reveals, tilt, cursor, search, cart, wishlist, compare, quiz |

---

## Design system

| Token | Value | Use |
|---|---|---|
| Matte Black | `#0B0B0B` | Primary background |
| Pure White | `#FFFFFF` | Primary text |
| Baby Blue | `#8ED6FF` | Accents, CTAs, hover, glow — used sparingly |

**Type:** Space Grotesk (display) · Inter (body) · Space Mono (labels, prices)

---

## Adding and editing products

Products live in four arrays: `PRODUCTS` (featured rackets), `BEST` (trending), `MORE` (the wider range) and `RACKET_POOL` (quiz). All feed a single `CATALOGUE`, so anything added is searchable and browsable automatically.

```js
{
  cat:"Rackets",                    // drives category browse
  name:"KORTA Pro Carbon X",
  price:"R 4,299",                  // "R " prefix; parsed for totals
  isRacket:true,                    // draws the racket artwork
  rating:5,
  weight:"365g", balance:"Medium",
  level:"Intermediate+", style:"Control",
  desc:"Longer description shown in the product lightbox.",
  tag:"New"                         // optional corner badge
}
```

For non-rackets use `art:` instead of `isRacket`: `"ball"`, `"bag"`, `"tee"`, `"shoe"` or `"grip"`.

### Swapping in real photography

All artwork is drawn in SVG, so nothing depends on an external image. To use real photos, drop `isRacket` / `art` and add image paths:

```js
{cat:"Rackets", name:"KORTA Pro Carbon X", price:"R 4,299",
 img1:"images/products/pro-carbon-x-1.jpg",
 img2:"images/products/pro-carbon-x-2.jpg",   // hover shot
 ...}
```

Category tiles work the same way — replace `art:"racket"` with `img:"images/categories/rackets.jpg"`.

**Sizes:** products 900×1125 (4:5) · categories 800×1067 (3:4) · hero 1920×1080

### Hero

Currently an Unsplash photo. To use your own, replace the `src` with `images/hero.jpg`, or swap the `<img>` for:

```html
<video autoplay muted loop playsinline poster="images/hero-poster.jpg">
  <source src="video/hero.mp4" type="video/mp4">
</video>
```

---

## Before going live

- [ ] Replace placeholder product artwork with supplier photography
- [ ] **Verify all specifications** — weights, balances and descriptions are plausible placeholders, not manufacturer data
- [ ] Connect a payment gateway (PayFast, Yoco, Ozow and Stripe all support ZAR)
- [ ] Connect the newsletter form to a mailing provider (currently front-end only)
- [ ] Confirm pricing and stock levels

---

## Performance & accessibility

- No frameworks or external JS — one request plus fonts
- Fonts load non-blocking with system fallbacks
- All animation runs on `transform` / `opacity` (GPU composited)
- Product artwork is inline SVG; images lazy-loaded
- `prefers-reduced-motion` respected
- Locked to a dark theme via `color-scheme`
- Hover transforms disabled on touch so links fire on first tap
- Mobile bottom navigation, 48px tap targets, safe-area insets

**Browser support:** current Chrome, Safari, Firefox, Edge.

---

## Roadmap

- [ ] Dedicated product pages with URLs
- [ ] Persistent cart and wishlist (currently session-only)
- [ ] Payment gateway integration
- [ ] Stock management / CMS
- [ ] Contact form (footer currently uses `mailto:`)

---

## Contact

**hello@korta.co.za**
[Instagram](https://www.instagram.com/korta.co.za) · [TikTok](https://www.tiktok.com/@korta.co.za)

---

© 2026 KORTA. All rights reserved.
