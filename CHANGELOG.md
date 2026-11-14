# Changelog

All notable changes to Kalokagathia / Monosphere are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions
match the GitHub releases of this repository.

## [1.4.0] — 2026-11-14

Phase 7 — the app talks back: MIDI output for live rigs, and a receive
link from the companion Noise app.

### Added
- **MIDI output** — the Play tab's MIDI section gains an output
  subsection (device selector, channel, base CC, step note; settings
  persist in the browser). Three things are sent back to the selected
  port: macro positions as CC (base CC + macro index, coalesced to
  roughly one send per 30 ms), a step-note pulse every time the
  sequence lands on a new item (internal playback, MIDI clock, Ableton
  Link, note actions and manual clicks all share the item-load path,
  so each landed step fires exactly one pulse), and a Program Change
  whose number is the loaded preset's index in the current shelf
  order — enough to keep motorised faders and DAW-side program
  changes in step with the visuals.
- **Noise link receiver** — with the "Varelser Link" toggle enabled in
  the Noise app (another tab of the same browser), its playback state
  and levels (master, layers 1–3, binaural) arrive over
  BroadcastChannel and become modulation sources: the Modulation
  section shows a "Noise Link:" status line and its source selector
  gains a "Noise連携" group, so the noise bed can breathe through the
  particle scene. Nothing is received while Noise is not broadcasting.

### Integration notes
- MIDI output pairs with the input side shipped in 1.3.0 (note
  actions, clock sync) for two-way live setups — the same wiring the
  Meikyoshisui guide uses for DAW live performance — and tempo sync
  remains available via MIDI clock or the Ableton Link bridge
  (`tools/link-bridge/`). As in 1.3.0, endpoint behaviour is verified
  against virtual ports in the real-GPU smoke; a physical-controller
  pass remains a user-side check.

## [1.3.0] — 2026-11-14

Phase 6.5 / 6.6 — external-control synchronisation for live performance:

### Added
- **MIDI note actions** — keyboard / pad notes can be learned and assigned
  to five actions (next / previous preset, advance sequence one step,
  sequence play / stop, randomize) alongside the existing CC mapping for
  knobs and faders. Note On only; assignments persist in the browser.
- **MIDI clock sync** — the sequence can follow an external MIDI clock
  (Start / Continue / Stop, BPM detection) with a selectable step
  division, via the new "Sequence Sync" source selector in the Play tab's
  MIDI section. Steps advance through the same path as clicking a
  sequence item, so the internal timer never double-advances.
- **Ableton Link sync** — the same Sequence Sync selector can follow an
  Ableton Link session through a small local bridge
  (`tools/link-bridge/`, a dependency-light Node script bridging the
  Link session to the browser over WebSocket). If the bridge is not
  running the UI degrades gracefully and no steps are driven.
  Interop note: the bridge and its protocol handling are verified, and
  the browser client is verified against the bridge; a joint session
  check against Ableton Live itself is still pending (no Live in the
  build environment).

## [1.2.0] — 2026-11-14

Phase 6 ("ultimate") — five additions on top of the 1.1.0 feature set:

### Added
- **OpenRouter BYOK** — the AI tab now accepts a visitor's own OpenRouter
  API key (called directly from the browser, never via the site relay),
  alongside Groq and Gemini.
- **Global Undo / Redo** — header buttons and Ctrl/Cmd+Z /
  Shift+Ctrl/Cmd+Z step through parameter-config history.
- **Mesh export (OBJ / STL)** — surface layers (membrane, tubes) can be
  exported as mesh files for Blender / 3D printing, in addition to the
  existing point-cloud PLY, SVG, PNG and video exports.
- **Embed player** — `/?embed=1#p=<presetId>` plays a single preset in a
  chrome-free player with play / fullscreen controls, ready to iframe
  into notes and other sites.
- **Kiosk mode** — `/?kiosk=1` runs a canvas-only attract loop with
  auto-rotating presets for unattended exhibition use.

## [1.1.0] — 2026-11-14

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
