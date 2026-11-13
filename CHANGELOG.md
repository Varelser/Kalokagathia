# Changelog

All notable changes to Kalokagathia / Monosphere are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions
match the GitHub releases of this repository.

## [Unreleased]

### Added
- **Chua catalog integration** — the 4 Chua double-scroll presets (2 GPGPU
  attractor, 2 motion) join the generated collection: **746 → 750 presets**,
  each with a catalog thumbnail, a share page and a per-preset JSON. New
  "Chua" series in the preset shelf and the catalog.
- `<meta name="description">` on the app entry page.
- English overview section in the README.

## [1.0.0] — 2026-11-14

First tagged release: the live site at https://monosphere.pages.dev/ as of
2026-11-14, with its full source published in this repository.

### Highlights
- Four-edge UI (slim header / left rail / right preset shelf / bottom deck +
  expandable sheet), Basic / Pro modes — the canvas centre is never covered
- Built-in library of 444 presets + generated collection of 746 presets with
  real thumbnails, lazy-loaded into the shelf (series: Coverage, Ignition,
  Theory, Lenia, Particle Life, DLA, L-System, Raymarch, Audio FFT)
- Chua circuit (double-scroll attractor) as both a scene motion and a GPGPU
  attractor type
- Evolution Lab (crossover / mutation), parameter timeline & morphing
  playback, partial preset apply & blending
- AI tab: natural-language preset generation and parameter control
  (BYOK: Groq / Gemini, direct from the browser; optional site relay)
- Optional cloud sync of user presets (Neon Postgres)
- Every preset has a share page with OGP cards; the site ships robots.txt
  and sitemap.xml (748 URLs); the Pages worker returns real 404s for
  missing files while keeping the SPA fallback for app routes
- Platform features: Wake Lock, Document Picture-in-Picture, Web Share,
  PNG clipboard copy, fullscreen, PWA

### Notes
- Not yet in this repo: `.github/workflows/deploy-pages.yml` and the binary
  PWA icon PNGs under `public/` (the live deployment includes both).
