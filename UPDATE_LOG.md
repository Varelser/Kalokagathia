## 2026-11-11 — フォローオンプログラム（11項目＋小物修正バンドル＋衛生）

2026-11-09〜10 の実装（AI Phase 0〜2、BYOK、自由配線 Stage 4、理論系プリセット、カタログ 692→719 件ほか）の詳細は各 IMPL_REPORT が正本。本エントリは 2026-11-11 のプログラム全体を記録する。

- 11項目プログラムを同日中に全件完了し本番反映した: (1) AI Phase 3 — /api/ai に IP 単位スライディングウィンドウ制限（8回/60秒＋20回/10分、429＋Retry-After、アイソレート内カウンタ）＋ AI タブ使用量パネル。(2) 理論系 27 件をカタログ統合（692→719 件、iMac 実測 fps 30–61、エラー0）。(3) AI Phase 2 プリセット生成（breed / assemble の 2 経路、検証ゲート＋フィードバック再試行）。(4) domain warp を PARAMETER_CATALOG と AI カタログへ登録。(5) FHN 表示マッピングを Gray-Scott から分離。(6) Kuramoto 読み出しを trails / ribbons / tubes へ拡張。(7) Physarum 球面表示（layer{2,3}PhysarumDisplay 'sheet'|'sphere'、既定 sheet）。(8) Basic / Pro 簡易モード（初回のみ Basic、選択を記憶、主要ラベル日本語化）。(9) プリセット部分適用 / ブレンド（9 グループ）。(10) 進化ラボ（6/12/18 件バッチ、実測スクリーニング、下位半分の淘汰）。(11) パラメータタイムライン記録（補間再生、キーフレーム編集、JSON 入出力、PNG 連番最大 240 フレーム）。
- 小物修正バンドル（デプロイ ae28ae98）: FHN 表示ゲイン layer{2,3}ReactionFhnGain（既定 1.0＝従来表示、0.2–4.0）。保存バグの発見と修正 — スターターライブラリ完全形は約 910 万文字でアプリ自身の読込上限 400 万文字と localStorage 容量を超え、保存が常に無言で失敗していた。lib/presetLibraryPersist.ts（検証付き保存＋ DEFAULT_CONFIG 差分への無損失圧縮で約 36.6 万文字、失敗は棚へ日本語通知）を導入。
- フォローオン: Physarum 球面の極圧縮修正（等面積緯度リマップ、表示側のみ。デプロイ 61b29bb7）。AI 制御カタログ拡張（実測 84→304 件、PARAMETER_CATALOG 371→397 件、リレーの 9,000 文字切断を 40,000/90,000 文字へ修正。デプロイ cf9f9cb5。Groq 無料枠 TPM 8,000 では 413 となり Gemini へ自動フォールバック）。可読性 Phase 4（デッキ内ラベル下限 11px＋日本語二重ラベル。デプロイ 401ff282）。重量プリセット残件（Lite S で 10fps 未満の 10 件が全件 10fps 以上に到達、コード最適化 3 件、Lite SS 変種 8 件を新設してカタログ 727 件、MAX_GPGPU_TEX_SIZE=512 で Coverage 456 のコンテキスト喪失連鎖を解消。デプロイ 55275d64）。
- BLOCKED: /api/ai 厳密レート制限（KV バインド Worker）は Cloudflare トークンの権限不足（Workers Scripts Edit なし、PUT 403 / KV 401）で未適用。本番は Phase 3 のアイソレート内制限のまま。Worker 一式と手順書は project/relay/ に完成済み（テスト 19/19）。
- 中止（利用者判断、2026-11-11）: WebGPU（スパイク含む）と GitHub 公開はプログラムから除外した。
- 衛生（デプロイ 24928640）: 死にキー layer2Opacity / layer3Opacity / layer2ParticleGlow を全プリセットプール（project 8 ファイル＋ preset-analysis 17 ファイル）と本番 /presets/*.json（727 ファイル）から計 6,302 件除去（書式を保った外科的除去、パース後の順序込み完全一致で検証）。発生源の operator suffix 辞書（materialPatch の Opacity / ParticleGlow）も除去し、スターターライブラリ全 444 件が正規キー範囲内であることを実行検証した。public-library.json と showcase、Phase 5 fixtures は混入なしを確認。CURRENT_STATUS.md と UPDATE_LOG.md を現状へ更新（Drive 版 CURRENT_STATUS は内容同一と照合済み）。Drive の stray 2 件（ルートの sceneVolumetricFieldSystem.tsx.bak-20261109、fixtures/project-state 直下の重複 phase5-legacy-v24.json）をゴミ箱へ移動。詳細は HYGIENE_IMPL_REPORT_20261111.md。静的ゲート: typecheck / verify:project-state / verify:public-library / verify:phase5 / verify:phase4 / verify:export / build すべて exit 0。

- 全件ツアーのコンソールエラー切り分け: 帰属拡張で発生プリセットを特定。GPGPU Attractor Smooth Tube の TypeError は SmoothTube の履歴バッファ競合 (フレームが effect より先行すると未初期化スロットへ書く) と特定しガードを追加。更新深度エラーは長時間セッションでのみ 4 件のプリセットで観測され、単独・短時間では再現しないため未修正の観測事項として記録。
- 監査の拡張: verify:shaders に TOUR_ALL=1 (棚の全プリセット走査) と SWEEP_TYPES=1 (Node Graph 経由で全 197 運動タイプ＋全 16 発生源タイプを Layer 2 で走査) を追加。失敗は導入したプリセット/タイプを名指しで記録する。既定の常設監査の速さは不変。
- プリセット棚の深化（印象タグ）: config から自動導出するタグ (lib/presetTags.ts、保存せず常に実態と一致) をタイルに表示し、頻出タグ (3件以上、上位10) をワンタップ絞り込みチップに。検索もタグにヒットする。GPGPU 23件・Reaction 5件など実ライブラリで頻度を実測。
- パラメータ説明（6D 深化）: 359 件全パラメータに一文説明 (lib/parameterDescriptions.ts、Layer 3 は Layer 2 から自動ミラーで全項目カバー)。Play タブのパラメータ検索の各行と ⌘K パレットに表示され、説明文そのものも検索対象になった。
# Upgrade log

Baseline: Google Drive `monosphere` snapshot (source last updated 2026-03-29..04-01),
reconstructed via Drive download. JSON files were canonicalized during reconstruction
(public-library re-sync + Phase 5 fixture regeneration, both verified semantically
identical) and the connector-injected `retrieved_at` fields were stripped.
The Google Drive original is never modified by this work.

Baseline verification (2026-11-07, before upgrade): npm ci OK, typecheck 0 errors,
production build OK, verify:project-state PASS, verify:public-library PASS.
Known pre-existing failure: verify:phase5 (parseProjectData dedupes preset ids in
lib/projectStateStorage.ts while scripts/verifyPhase5FixtureScenarios.ts expects
duplicates to survive parse). Recorded so upgrade regressions can be told apart.

## Stage A (2026-11-07): in-range updates + hygiene
- npm update within declared ranges: vite 6.4.1->6.4.5, tailwind 4.2.2->4.3.5,
  playwright 1.59->1.65, jszip 3.10.2, postprocessing 6.39.6, rollup 4.68, babel 7.29, etc.
- Added engines (node >=20) and .nvmrc (20), matching Netlify / GitHub Actions.
- Regression found and fixed within the stage: @types/three (transitive) 0.183->0.187
  dropped its @webgpu/types dependency, breaking WebGPU globals in lib/webgpuCompute.ts.
  Fixed properly by declaring @webgpu/types as a direct devDependency and adding it to
  tsconfig "types" (the project uses WebGPU APIs directly, so it should not rely on a
  transitive type package).
- Gates: npm ci OK, typecheck 0 errors, build OK, verify:project-state PASS,
  verify:public-library PASS. No new failures vs baseline.

## Stage B (2026-11-07): three + TypeScript
- three 0.160.0 -> 0.187.0, three-stdlib 2.29.4 -> 2.36.1.
- drei stayed in the v8-fiber ecosystem but had to move within v9: 9.99.0 (exact pin)
  -> ^9.122.0, because drei 9.99 imports LinearEncoding/sRGBEncoding which three removed
  in r162+; the build failed on that until drei was bumped. drei 9.122 peers
  (react ^18, fiber ^8, three >=0.137) match this stage.
- TypeScript: 5.8.3 -> 5.9.3 (0 errors). TS 6.0.3 was tried and rejected for now:
  98 type errors, mostly stricter JSX Element typing against React 18 types;
  re-evaluate after the React 19 type upgrade in Stage C.
- Gates: typecheck 0 errors, build OK, verify:project-state PASS,
  verify:public-library PASS, verify:phase5 fails with the same pre-existing
  assertion as baseline (no new failures).
- Note: three-core chunk grew 675 kB -> 761 kB (three itself grew; crosses the
  700 kB chunkSizeWarningLimit, warning only).

## Stage C-1 (2026-11-07): React 19 + R3F 9 + drei 10
- react / react-dom 18.2 -> ^19.3.1, @types/react(-dom) -> 19.x.
- @react-three/fiber 8.15 -> ^9.8.2, @react-three/drei -> ^10.7.9,
  @react-three/postprocessing 2.19 -> ^3.2.2 (pulls n8ao ^2), maath -> ^0.10.8.
- Removed direct dependencies react-reconciler and scheduler: nothing in the source
  imports them; they were pinned for fiber v8 and fiber 9 brings its own.
- Surprisingly smooth: typecheck 0 errors with no source changes, build OK,
  verify:project-state / verify:public-library PASS, verify:phase5 unchanged
  (same pre-existing failure).
- Runtime smoke (headless Chromium, built bundle via vite preview): page loads,
  1 canvas, zero console/page errors, screenshot shows the monochrome particle
  scene rendering (313 unique colors, white particles on black).

## Stage C-2a (2026-11-07): lucide 1.x, zustand removal
- lucide-react 0.344.0 -> ^1.70.0. All 39 icons used by the source still exist;
  typecheck passed with no source changes.
- zustand: bumped 4.5.2 -> 5.1.0 and then removed as a direct dependency, because
  nothing in the source imports it (grep across components/lib/scripts/workers = 0).
  It remains in node_modules only as a transitive dependency of drei.
- Gates: typecheck 0 errors, build OK, verify:project-state / verify:public-library PASS.

## Stage C-2b (2026-11-07): Vite 8 + plugin-react 6
- vite 6.4.5 -> ^8.3.6 (Rolldown-based), @vitejs/plugin-react 5 -> ^6.2.0
  (plugin-react 6 requires vite ^8). Build time 16-19s -> ~3s.
- vite.config.ts adaptations:
  - `__dirname` -> `import.meta.dirname` (Vite 8 native config loader warning).
  - Chunking: Rolldown silently ignores manualChunks. Its replacement,
    rolldownOptions.output.codeSplitting.groups, also captures the unclaimed
    dependencies of matched modules, so groups are ordered vendor-first
    (three-core 100 ... vendor 70, then app groups 60..40) to stop three/fiber
    being pulled into scene chunks. Resulting layout matches the Rollup era:
    three-core 751 kB, r3f-fiber 187 kB, r3f-drei 141 kB, react-vendor 211 kB,
    all app family chunks present, no mega-chunk. Internal boundaries between
    sibling app groups (depiction/starter, scene families) shifted slightly
    due to dependency capture; combined sizes are unchanged (~586 kB / ~422 kB).
- TypeScript 6.0.3 retried now that React 19 types are in: 112 errors (TS6 turns
  on stricter checks; was 98 under React 18 types). Rejected again per plan rule;
  staying on TypeScript 5.9.3. TS 6/7 adoption is a separate strictness project.
- Gates: typecheck 0 errors, build OK, verify:project-state / verify:public-library
  PASS, verify:phase5 unchanged. Runtime smoke: zero console/page errors, canvas
  renders; screenshot matches the Stage C-1 shot (313 unique colors; white-pixel
  count differs only by animation frame, 72,272 vs 72,244).

## Final verification (2026-11-07)
- Clean-slate run in this copy: rm node_modules/dist, npm ci (140 packages,
  down from 190 at baseline), typecheck 0 errors, build OK,
  verify:project-state PASS, verify:public-library PASS,
  verify:phase5 fails only with the pre-existing baseline assertion.
- Dev server (what the Mac launcher starts) boots and serves HTTP 200.
- Visual regression check: baseline commit built separately and screenshotted
  under identical headless conditions. Baseline vs final: both 313 unique
  colors, identical white-pixel count (72,244), 0 of 1,024,000 pixels differ
  by more than 10/255, mean absolute difference 0.017. No visual change.
- Not re-run: verify:library / verify:public-ui (need the Playwright browser
  download for 1.65, which did not complete in this environment; they were
  equally unverifiable at baseline).

## Post-upgrade fix (2026-11-07): verify:phase5 resolved
- Root cause: parseProjectData in lib/projectStateStorage.ts was doing the
  cleanup that the Phase 5 design assigns to import preparation — it deduped
  preset ids, deduped sequence ids, and dropped orphan sequence references,
  while the fixtures assert those inputs survive parse so that
  prepareImportedProjectData can repair/report them (the app import flow
  always goes through prepare).
- Fix: parseProjectData is now lossless for duplicate ids and orphan
  sequence references. The defensive dedupe/orphan-filter was moved into
  loadProjectData, whose parsed snapshot is consumed directly by the UI
  without an import-preparation pass, so persisted-snapshot loading keeps
  its previous cleanup behavior.
- Scope: lib/projectStateStorage.ts only (plus this log entry).
- Gates after the fix: verify:phase5 PASS (all 11 scenarios, including the
  previously blocked duplicate-import and orphan-sequence recoveries),
  typecheck 0 errors, build OK, verify:project-state PASS,
  verify:public-library PASS.
- Applied to the Google Drive monosphere folder on 2026-11-07 with the
  user's approval (this file and lib/projectStateStorage.ts only). The
  pre-upgrade Drive backup monosphere-backup-20261107 is retained until
  launch is confirmed on the user's iMac; this fix itself is revertible
  from this git history.

## Play tab (2026-11-07): roadmap Phase 6A / 6C / 7A

First step of the expression roadmap (workspace/goals/monosphere-inspection/files/monosphere-expression-roadmap.md), implemented additively in the upgrade git copy. Reflected to the Google Drive monosphere folder on 2026-11-07 with the user's approval (7 files; read-back md5 verified byte-for-byte).

- New "Play" tab, now the panel's default tab. Existing tabs (Main / L1 / L2 / L3 / Ambient / Audio FX) are untouched; Play is an entrance, not a replacement.
- Phase 6A macro controls (lib/macroControls.ts): 8 perceptual knobs (Density, Spread, Chaos, Speed, Weight, Trails, Burst, Glow), defined as data mappings onto existing ParticleConfig fields. A macro position is derived from the current config, never stored, and applying a macro only writes ordinary fields through updateConfig — presets, project files, and serialization are unaffected. Count-like targets interpolate logarithmically and round to their UI steps.
- Phase 6C preset shelf: the Play tab's top section is a management-free shelf — search plus category chips (reusing lib/presetCatalog) and two-column tiles with category tags, layer motion pair, and a performance-tier dot. Loading uses the existing onLoadPreset path; rename/delete/etc. stay in Main.
- Phase 7A expression map: aggregates getCoverageProfile over the whole library plus the current config. Family-level axes (motion/source/render/post/compute/solver) turn out to be saturated by the 472-preset library, so the map leads with the type-level axis: 157 of 197 catalogued motion types are used by some preset, and the unused types (field, liquid, wind, rossler, clifford, attractor, …) are shown as dashed gap chips.
- Files: lib/macroControls.ts (new), components/controlPanelPlayTab.tsx (new), components/controlPanelPartsCore.tsx (tab id), components/controlPanelChrome.tsx (tab entry), components/controlPanelTabs.tsx (content switch), components/useControlPanelLocalState.ts (default tab 'play').
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0. Browser smoke (dev server, headless Chromium): Play tab renders all three sections, macro sliders present, console errors 0; screenshots verified visually.

## Preset breeding (2026-11-07): roadmap Phase 7B

Implemented in the upgrade git copy. Reflected to the Google Drive monosphere folder on 2026-11-07 with the user's approval (8 files; read-back md5 verified byte-for-byte, new file lib/presetBreeding.ts).

- lib/presetBreeding.ts (new): seedable (mulberry32) crossover + mutation over ParticleConfig. Numeric fields interpolate, enum/boolean/string fields inherit per-field from either parent (uniform crossover), number arrays interpolate element-wise when lengths match, and data payloads (media luma maps, source positions) are inherited whole, never blended. Mutation perturbs a fraction (35%) of numeric fields by a relative amount. Children follow a fixed plan (blend 30–70%, mutation 0–45%) scaled by a UI mutation-scale slider, and every child passes through normalizeConfig. Same seed reproduces the same generation exactly (verified).
- Play tab gains a Breeding section between Macros and the Expression Map: two parent selectors (any library preset, or a previously bred child via the 親A/親B buttons on child tiles), a mutation-scale slider, and a 6-child grid. Each child can be previewed (applied instantly), adopted as a parent for the next generation, or saved as a regular preset.
- Wiring: App composes two new optional callbacks — onApplyConfig (applyConfigInstant) and onSaveBredPreset (new handleSaveBredPreset in lib/usePresetLibrary.ts, built on the existing createPresetRecord; returns null and posts the standard notice in the read-only public build) — threaded through ControlPanelProps / ControlPanel / ControlPanelContentProps.
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0. Browser end-to-end (headless Chromium): breeding produced 6 children, previewing a child applied it with 0 console errors, and saving a child marked it 保存済 and created the preset through the normal creation path.

## Parameter search + XY pad (2026-11-07): roadmap Phase 6D / 7C

Implemented in the upgrade git copy and applied to Drive on 2026-11-07 (md5-verified: Drive matched the pre-change state before the update, and the new files were read back byte-identical afterwards).

- lib/parameterCatalog.ts (new): 351 numeric parameters extracted from the panel's own Slider usages (label, range, step, owning tab), validated key-by-key against ParticleConfig (0 invalid). This is the index for both features below.
- Parameter Search section in the Play tab: cross-tab search by label or config key, an inline slider per result (using the UI's own range/step), and a chip that jumps to the owning tab (new optional onJumpToTab prop, wired to the panel's existing setActiveTab).
- XY Pad section in the Play tab: any two catalogued parameters on the X/Y axes (defaults: Layer 2 Speed / Complexity), pointer drag writes both through updateConfig, and the marker reflects the current values — including changes made elsewhere.
- Files: lib/parameterCatalog.ts (new), components/controlPanelPlayTab.tsx, components/controlPanelTabsShared.tsx, components/ControlPanel.tsx (jump wiring only).
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0. Browser smoke: searching "gravity" returned the Main/L2/L3 gravity sliders; an XY pad drag changed both axes with 0 console errors.

## History filmstrip (2026-11-07): roadmap Phase 7D

Implemented in the upgrade git copy and applied to Drive on 2026-11-07 (same md5-verified reflection as the parameter search / XY pad entry above).

- lib/useConfigHistory.ts (new): watches the live config and records a snapshot whenever it settles (unchanged for 900 ms), so preset morphs and slider drags leave only their final state. The strip holds up to 16 distinct states — settling on a state that already exists anywhere in the strip (e.g. by restoring an older card) does not append a duplicate. Session-local by design: it exists to recover "that shape I had a minute ago".
- Play tab History section: filmstrip cards (time + Layer 2/3 motion types, current state badged 現在), click a card to restore it via the existing instant-apply path, plus a clear-old-history action that keeps only the current state.
- Wiring: App holds the hook and passes entries/clear through ControlPanelProps → ControlPanel → ControlPanelContentProps (all optional).
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0. Browser end-to-end: loading a different preset appended a card; restoring the older card moved the 現在 badge with no duplicate appended after settling; console errors 0.

## Expression map: source × motion combinations (2026-11-07): roadmap Phase 7A deepening

Implemented in the upgrade git copy and applied to Drive on 2026-11-07 (md5-verified: Drive matched the pre-change state before the update, and the new files were read back byte-identical afterwards).

- The Expression Map gains a "Source × Motion" block. Measured over the whole library (472 presets, both layers, primary motion type per layer, enabled layers only): only 292 distinct source × motion pairs exist out of 2,758 theoretical (14 sources × 197 types) — about 11%. Families and types look saturated; combinations are the real frontier.
- For each enabled layer of the current config, the block shows which sources already have a preset paired with that layer's motion type (solid chips) and which have never been tried (dashed chips) — the dashed chips double as next-experiment candidates. A note lists the rarest sources (disc 1, cone/random 2, torus 3 uses).
- Presentation fix found by measurement: rows are built only from enabled layers. The library's most common primary type, flow (236 layer slots), is enabled in none of them — it is a placeholder for switched-off layers, so an all-dashed row for it would have misread as an untried combination space.
- Files: components/controlPanelPlayTab.tsx only.
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0. Browser check: the block renders with the measured 292/2758 figure and no console errors.

## Panel tiers Play / Design / Lab (2026-11-07): roadmap Phase 6B

Implemented in the upgrade git copy and applied to Drive on 2026-11-07 (md5-verified: Drive matched the pre-change state before the update, and the new files were read back byte-identical afterwards).

- Formalizes the three-tier progressive disclosure the Play tab started: Play shows only the Play tab; Design (the new default) adds Main + Layer 1/2/3; Lab reveals everything including the specialist Ambient and Audio FX tabs. Tiers only filter which tabs are offered in the rail, the collapsed dock, and the mobile tab bar — no config, preset, or project data is tied to them, and the choice is session-local panel state like the active tab.
- Switching to a tier that hides the active tab falls back to Play. Jumping to a parameter from the Play tab's Parameter Search automatically raises the tier when the owning tab lives in a higher one, so a jump never lands on a hidden tab.
- Files: components/controlPanelChrome.tsx (tier definitions, getTabsForTier, PanelTierSwitch), components/ControlPanel.tsx (wiring + jump handler), components/useControlPanelLocalState.ts, components/useControlPanelState.ts.
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0. Browser end-to-end: the rail shows 5 tabs in Design, 7 in Lab, 1 in Play; searching an Audio FX parameter and using its jump chip raised the tier to Lab and opened Audio FX; console errors 0.

## CSV / JSON data source (2026-11-07): roadmap Phase 8A

Implemented in the upgrade git copy and applied to Drive on 2026-11-07 (md5-verified: Drive matched the pre-change state before the update, and the new files were read back byte-identical afterwards).

- lib/dataSource.ts (new): parses CSV/TSV/whitespace rows (`x, y[, z][, value]`, header row tolerated) and JSON (tuples or {x, y, z?, v?} objects), caps input at 200k points, and rasterizes the XY plane into a luminance map in exactly the format the existing image/text media pipeline consumes (64×64, values 0..1, aspect preserved, Y flipped to data orientation). Brightness is point density, or the supplied value (or Z) when present. Includes a built-in two-arm spiral sample dataset.
- Play tab Data Source section: paste text or pick a file, see the parse summary (point count, ranges, value presence), choose Layer 2 or 3, and apply. Applying switches that layer to the image source with the data map through the standard updateConfig path, so the current motion type, render family, and post effects apply to the data shape unchanged. The resulting config is an ordinary config — it can be saved as a preset, bred, and exported like any other (the map is data the config already knew how to carry).
- Verified: unit checks of all parse paths, the rasterizer, and a normalize round-trip of an applied config; browser end-to-end — the sample dataset applied to Layer 2 (source became image with the map present) and rendered as a spread particle field with 0 console errors.
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0.

## MIDI control (2026-11-07): roadmap Phase 8B (MIDI half)

Implemented in the upgrade git copy; applied to Drive on 2026-11-07 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte). The camera half of 8B remained open at this point (the video source then took files only).

- lib/midiControl.ts (new): pure assignment model — a MIDI Control Change (channel + CC number) maps to either one of the 8 macros or any catalogued numeric parameter. Includes CC→range scaling, assignment resolution, target descriptions, and localStorage persistence with validation (stale targets are dropped on load). Assignments belong to the user's controller setup, so they deliberately live outside presets/project files.
- Play tab MIDI Control section: connect via Web MIDI (Chrome/Edge), pick a target (macro or any of the 351 catalogued parameters), press Learn and turn a hardware knob to bind it, then play. Incoming CCs drive the target through the standard updateConfig path; assignments can be deleted individually; the last received message is shown for debugging. Active while the Play tab is open.
- Verified: unit checks of scaling/resolution/storage round-trip; a full browser end-to-end with an injected fake MIDI controller — Learn bound CC21 to the Density macro, and CC 127/0 drove the Density slider to 1.0/0.0 exactly, with 0 console errors.
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0.

## Live camera input (2026-11-07): roadmap Phase 8B (camera half) — Phase 8B complete

Implemented in the upgrade git copy; applied to Drive on 2026-11-07 together with the MIDI batch (md5-verified the same way).

- SourceMediaSettings (video mode) gains a Use Camera / Stop Camera button: getUserMedia feeds the same video element and sampling loop the existing video-file path uses, so camera frames become the layer's luminance map with no renderer changes. Sampling passes the new flip option so the particle shape is mirrored, as users expect from a camera. Loading a file, pressing Clear, or unmounting stops the camera tracks.
- extractLumaMap gains an optional flipHorizontal parameter (default false; existing callers unchanged).
- Verification note: typecheck 0, build OK, verify:phase5 / project-state / public-library all exit 0. In this headless Chromium, getUserMedia({video}) resolves on a fresh page (fake device), but any getUserMedia call — including direct test calls unrelated to this change — hangs once a second particle layer is enabled (headless fake-device/GPU starvation), so the full click-through could not be completed in this environment. The camera path reuses the proven file-video sampling loop verbatim; on-hardware confirmation is folded into the pending iMac launch check.

## PLY point-cloud export (2026-11-07): roadmap Phase 9 (first slice)

Implemented in the upgrade git copy; applied to Drive on 2026-11-07 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- lib/pointCloudExport.ts (new): a one-shot capture channel (request flag + buffer + timestamp) plus the pure PLY builder. The GPGPU position texture stores xyz + age per texel; the builder emits ASCII PLY with x/y/z/age properties and drops non-finite positions.
- The simulation loop serves capture requests with a single forced readback (new `force` option in readbackParticlePositions; WebGPU-compute frames are exempt because their positions never pass through the WebGL target). The continuous metaball/tube readback is unchanged.
- Play tab gains an Export section: one click requests the current frame's GPGPU particle positions and downloads `monosphere-particles.ply`, reporting the exported point count; if no GPGPU particles are on screen it explains so after a short wait.
- Threading is one optional ref from App through the scene (AppBodyScene/AppRootLayout/AppScene/LayerContent/GpgpuSystem) and through the control panel's existing optional-prop chain.
- Verified end to end in the browser: enabled GPGPU + WebGL backend, exported a real file — 65,536 vertices, 3.8 MB, all rows finite with live positions and ages. (One THREE.WebGLProgram VALIDATE_STATUS warning appears in headless Chromium as soon as GPGPU is enabled, with or without this change; it is a SwiftShader validation quirk, unrelated to the readback.) Unit checks cover the PLY builder (NaN rows dropped, header count matches).
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0.

## Monochrome texture pack (2026-11-07): roadmap Phase 9

Implemented in the upgrade git copy; applied to Drive on 2026-11-07 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- lib/texturePack.ts (new): 8 procedural 64x64 luminance maps — halftone dots （網点）, concentric rings （同心円）, diagonal stripes （斜め縞）, crosshatch （クロスハッチ）, checkerboard （市松）, dot grid （ドット格子）, waves （波）, and cloud noise （雲ノイズ, fBm value noise). All generators are pure functions of pixel position (the noise hash is integer-based), so results are deterministic and identical on every machine. Maps use exactly the media-pipeline format.
- Play tab Texture Pack section: a tile per texture with a live canvas thumbnail rendered from the generated map itself, a Layer 2/3 target selector, and one-click apply through the same update path as the CSV/JSON data source (source becomes 'image' with the texture as its map). The result is an ordinary config — savable as a preset, breedable, exportable.
- Verified: unit checks (length/range/determinism for all 8, full-map distinctness, sensible mean brightness; an early skewed integer hash that collapsed the noise map to near-black was caught by these checks and replaced with a murmur-style finalizer). Browser end-to-end: 8 thumbnails render, applying 市松 switches Layer 2 to the image source with the map, particles render, 0 console errors.
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0.

## Performance recording & playback (2026-11-07): roadmap Phase 8D (record/scrub slice)

Implemented in the upgrade git copy; applied to Drive on 2026-11-07 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte). This covers the record/scrub half of 8D; seed determinism of the particle simulation itself remains out of scope (randomness is spread across the whole engine, and what a performer needs to keep is the control timeline).

- lib/performanceRecorder.ts (new): a take is a base config plus a timeline of per-key diffs (JSON-compared per key), sampled at 150 ms while recording; a frame is stored only when something changed, so takes stay small next to a full config. reconstructAt/frameIndexAt fold diffs back into a full config at any timestamp.
- Play tab Performance section: record (max 2 minutes, auto-stop), take readout (duration / frame count), play/pause with loop toggle, and a scrub slider that applies the reconstructed state at any point. Recording lives entirely in the Play tab (it samples the live config from props and plays back through the existing onApplyConfig path), so no App wiring was needed and nothing is persisted — takes are session-local.
- Verified: unit checks of diff/sample/reconstruct/index behavior; browser end-to-end recorded a take spanning a preset change and a macro move (frames stored, duration reported), started playback (playing state, playhead UI), 0 console errors. (Frame density in the headless software-rendered browser is lower than on real hardware because its timers are throttled under load.)
- Gates: typecheck 0 errors, build OK, verify:phase5 / verify:project-state / verify:public-library all exit 0.

## Source-position editor (2026-11-07): roadmap Phase 8C (first slice)

Implemented in the upgrade git copy; applied to Drive on 2026-11-07 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- lib/sourceEditor.ts (new): the emitter placement math, mirroring
  getConfiguredSourceOffset in lib/appStateCollision.ts —
  effective = manual offset + ring arrangement (SourceSpread circle).
  effectivePosition / offsetFromEffective / worldToPad / padToWorld
  (±5000 range, step-10 snap) / withPosition (sparse-array padding).
- Play tab "Source Editor" section: a top-view (X/Z) pad showing the
  *effective* position of every emitter of Layer 1/2/3 ( layer select);
  pointer down picks the nearest emitter and drags it, converting back
  to a manual offset on write, so what you see is where the emitter
  actually is. A Y slider edits the selected emitter's height, a
  Spread slider edits the ring radius, and a "Spread を 0 にする"
  shortcut switches to absolute manual placement (the existing panel
  tip). Readouts show the selected emitter's effective position and
  raw offset.
- This covers the practical half of 8C (direct manipulation of the
  only position-like data layers have). There are still no attractor /
  center fields to gizmo-edit; the GPGPU SDF collider uniforms have no
  config fields either — both remain future work if wanted.
- Verified: unit checks of the ring math, position round-trip, pad
  mapping and array padding; browser end-to-end (dragging to 75%/25%
  of the pad set the selected emitter's effective position to exactly
  (2500, 0, -2500), 0 console errors). Gates: typecheck 0 errors;
  build OK; verify:phase5 / verify:project-state /
  verify:public-library all exit 0.

## Solver-label honesty (2026-11-07): roadmap Phase 8E

Implemented in the upgrade git copy; applied to Drive on 2026-11-07 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- Investigation recap: the depiction-coverage "solver" families
  pbd-solver / mpm-material / destruction-fracture are resolved in
  lib/depictionCoverageFamilyResolvers.ts from shader modes
  (cloth/elastic/granular; sediment/viscous/melt; fracture modes).
  The engine contains no position-based-dynamics constraint solver,
  no material-point simulation and no destruction physics — the
  names classify the *appearance* a config evokes.
- lib/depictionCoverageTargets.ts: new SHADER_EMULATED_SOLVER_FAMILIES
  constant with a comment recording exactly that, next to
  TARGET_SOLVER_FAMILIES, so the distinction lives in the code and
  not only in this log.
- Play tab Expression Map: the Solvers axis now carries a visible
  note stating that those three families are shader-mode
  classifications rather than literal physics solvers.
- Nothing was renamed: the family ids are load-bearing for coverage
  matching and preset classification, and product-pack names that
  evoke MPM etc. are creative preset names, left as-is.
- Verified: typecheck 0 errors; build OK; verify:phase5 /
  verify:project-state / verify:public-library all exit 0; browser
  check shows the note under the Solvers axis (10/10), 0 console
  errors.

## SVG export (2026-11-07): roadmap Phase 9 (SVG slice)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 together with the code-hygiene batch (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- lib/svgExport.ts (new): buildSvgPointCloud projects the captured
  GPGPU position buffer (the same one-shot channel as the PLY
  export) onto a plane and emits a monochrome SVG — one white
  circle per particle on black, particle age mapped to opacity
  (0.35–1.0). Planes: 'xy' front view (world +Y up) and 'xz' top
  view (+Z down, matching the source editor). Bounds are fitted
  with padding; non-finite positions are dropped.
- Play tab Export section: the capture flow is generalized over
  format; a new "SVG書き出し" button sits next to the PLY button
  with a 前面（XY）/上面（XZ）plane selector.
- OSC / Syphon remain out of scope (they need an external bridge
  process; noted in the roadmap).
- Verified: unit checks (front-view Y flip, top-view Z mapping,
  age→opacity, NaN dropped, empty input). Browser end-to-end with
  GPGPU + WebGL backend: a real download of
  monosphere-particles-front.svg, 65,536 circles, 4.8 MB, status
  shown, 0 console errors (excluding the pre-existing headless
  VALIDATE_STATUS warning that also occurs without this change).
  Gates: typecheck 0 errors; build OK; verify:phase5 /
  verify:project-state / verify:public-library all exit 0.

## Code hygiene (2026-11-08): ESLint, version number, first strict flags

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 together with the SVG export batch (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- ESLint introduced (flat config, eslint.config.js): eslint 10 +
  typescript-eslint 8 + react-hooks 7 + react-refresh, with an
  `npm run lint` script. First-pass severities: the standard rule
  sets, with the mass legacy-pattern rules downgraded to warnings
  (unused vars 110, exhaustive-deps 28, sparse arrays 28 — shader /
  uniform tables — react-hooks compiler-era rules 43, explicit any
  17, etc.). Final state: **0 errors, 276 warnings**, lint exits 0.
  react-hooks/rules-of-hooks reports zero violations and stays an
  error. Three genuine findings were fixed on the way:
  a never-reassigned `let` in lib/appStateCollision.ts, an empty
  array-pattern artifact (`= [ ] = [`) in
  lib/starterLibraryPresetExtensionChunk01Atmospheric.ts (behavior
  preserved; its presets verified present), and the R3F JSX
  registration interface got a documented disable. Empty catch
  blocks are allowed (deliberate audio-teardown pattern).
- package.json version: 0.0.0 → 1.0.0 — the first numbered state,
  marking the library upgrade + Play-tab feature set baseline.
  Nothing in the code reads the version, so this is bookkeeping
  only.
- tsconfig: adopted noFallthroughCasesInSwitch and
  noImplicitOverride (measured 0 errors beforehand). Measured
  backlog for later: full strict = 112 errors, noUnusedLocals /
  noUnusedParameters = 109 errors.
- Gates: lint exit 0; typecheck 0 errors; build OK;
  verify:phase5 / verify:project-state / verify:public-library all
  exit 0; browser smoke 0 console errors.

## Strict burn-down 1 (2026-11-08): noImplicitAny adopted

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- tsconfig: `noImplicitAny: true` adopted permanently. Resolving it
  took 64 fixes in the implicit-any family:
  - 45 × TS7006 in the expression-atlas bundle files: the three
    bundle arrays (BaseCore / BaseExtended / BaseAnchors) were
    unannotated literals, so `patch: (layerIndex) => ...` got no
    contextual type even though ExpressionAtlasBundle already
    declares `patch: (layerIndex: 2 | 3) => Partial<ParticleConfig>`.
    Annotating the three arrays as ExpressionAtlasBundle[] fixed
    all 45 at the root.
  - 1 × TS7006 in the Play tab MIDI section (explicit MidiInputLike
    annotation on a Map.forEach callback).
  - 18 × TS7011/TS7018: callback return-type annotations in
    executionDiagnostics and starterLibrary (both already had
    honest target types — the literals just weren't contextually
    typed), mapper return annotations in useAppSnapshots, typed
    null/empty-array leaves in the phase5 fixture payloads, and
    `.catch(() => {})` in the source-media component.
- Effect on the remaining strict backlog: the full `--strict`
  error count dropped from 112 to 67 (TS2322 36, TS2741 25,
  TS2366 3, TS18047 3 — mostly strictNullChecks territory plus
  missing-property literals in sceneLineSystemRender and the atlas
  bundles).
- All annotations are type-only; the single runtime-touching change
  is `() => undefined` → `() => {}` in three promise catches
  (same behavior). Gates: typecheck 0 errors (with the new flag),
  lint exit 0, build OK, verify:phase5 / verify:project-state /
  verify:public-library all exit 0, browser smoke 0 console errors.

## Strict burn-down 2 (2026-11-08): three more strict flags adopted

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 together with burn-down 3 (md5-verified, no drift).

- Measured per-flag: every one of the 67 remaining `--strict`
  errors comes from `strictNullChecks` alone. The other unadopted
  flags measure zero: noImplicitThis 0, strictFunctionTypes 0,
  strictBindCallApply 0, strictPropertyInitialization 0.
- tsconfig adopts noImplicitThis, strictFunctionTypes and
  strictBindCallApply. strictPropertyInitialization cannot be
  adopted yet — TypeScript rejects it without strictNullChecks
  (TS5052) — so it waits with the last flag.
- strictNullChecks composition (67): TS2322 36, TS2741 25,
  TS2366 3, TS18047 3. The single biggest cluster is 24 × TS2741
  in components/sceneLineSystemRender.tsx: R3F `<bufferAttribute>`
  elements written without `args` (the v9 element type requires
  the constructor args even though R3F applies array/itemSize as
  props at runtime). The honest fix is adding
  `args={[array, itemSize]}` per element — mechanical, but it
  touches live line rendering, so it belongs to the dedicated
  strictNullChecks pass with a rendering check, not a drive-by.
  The rest spreads thinly (~25 files, 1–12 each, heaviest
  lib/operatorMatrixSourceAutoWeight.ts with 12).
- Gates: typecheck 0 errors (with the new flags), lint exit 0,
  build OK, verify:phase5 / verify:project-state /
  verify:public-library all exit 0.

## Strict burn-down 3 (2026-11-08): strict mode fully adopted

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 together with burn-down 2 (md5-verified, no drift).

- tsconfig now says `"strict": true` — the last flag,
  strictNullChecks, is resolved (67 errors) and
  strictPropertyInitialization rides along. `tsc --noEmit --strict`
  reports 0 errors. The strict journey: 112 → 67 → 0 across three
  passes, each adopted only when its count hit zero.
- How the 67 fell, by root cause:
  - Layout particleData (21): nine scene-system layout types
    declared `particleData: ReturnType<typeof generateParticleData>`
    (i.e. `ParticleData | null`), but every builder returns null
    before constructing a layout when generation fails — the field
    is non-null by construction. Declarations now say
    `particleData: ParticleData`.
  - R3F bufferAttribute args (25): `<bufferAttribute>` elements in
    sceneLineSystemRender (24) and sceneGlyphOutlineSystem (1)
    gained the canonical `args={[array, itemSize]}` the v9 element
    type requires.
  - Sparse-array holes in typed data (5 files): stray `}),,` and
    lone-comma lines in the starter preset chunks and hybrid
    recipe lists created undefined slots that spreads turned into
    real undefined entries. The empty slots are removed; no preset
    or recipe was removed (library gates + counts unchanged).
  - operatorMatrixSourceAutoWeight (12): the two preference
    functions now return `current` for sources without a preference
    (their contract), sourceAutoWeight throws a named error for
    sources outside the auto-weight table (callers dereference the
    result unconditionally — previously a latent TypeError), and
    the label-token table is typed Record<AutoWeightedSource,
    string> over exactly the handled sources.
  - Small honest widenings: LayerSummaryCard source/material are
    `string | undefined` with a '—' render fallback (the snapshot
    type already had them optional); the library file input ref is
    RefObject<HTMLInputElement | null> (React 19 useRef typing);
    the WebGPU readback callback guards a possibly-null
    DataTexture image buffer.
- Gates: typecheck 0 (strict), lint exit 0, build OK,
  verify:phase5 / verify:project-state / verify:public-library all
  exit 0. Browser: Torus Knot (line rendering through the changed
  bufferAttributes) and Procedural Crystal Crust (crystal
  deposition runtime) applied with 0 console errors and rendering
  confirmed by screenshot.

## Unused-code burn-down (2026-11-08): noUnusedLocals / noUnusedParameters adopted

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- tsconfig adopted `noUnusedLocals` and `noUnusedParameters`;
  the measured backlog (107 errors) is now 0.
- Composition of the cleanup:
  - 91 unused imports removed (type-heavy routing modules carried
    long lists of snapshot types and predicate functions they never
    referenced; starter chunks imported helpers they do not call).
    Four whole import statements were entirely unused.
  - 16 hand-reviewed cases: destructured bindings never read
    (canvas-stream clearDownload, particle-render auxMode,
    project-transfer validPresetIds, hybrid-fiber profile),
    parameters kept for signature compatibility renamed with the
    underscore convention (brush-line uniforms config, anyLayer
    config, shared-audio latestConfigRef), getBandByHz lost its
    unneeded fftSize parameter (two call sites updated; the
    caller's now-dead fftSize local went with it), the MIDI section
    lost its never-read config prop (type, destructure, call site),
    and dead code was deleted: a scratch Vector3 in the metaball
    system, the fog profiles' hash chain (signedHash/hash/fract —
    each only called by the next), an unused Primitive type alias,
    and unused reads/helpers in three phase5 scripts (one computed
    sha256 and its crypto import, one unused JSON read and path,
    one unused predicate helper).
  - Two cascades were caught by re-running the check (fog hash
    chain, audio fftSize local); a first-pass edit briefly touched
    the Data Source section's destructure instead of the MIDI
    section's and was corrected — the Data Source section does
    read config, the MIDI section does not.
- Gates: typecheck 0 (strict + unused flags), lint exit 0 —
  ESLint warnings fell 276 → 137 as the unused-vars block cleared —
  build OK, verify:phase5 / verify:project-state /
  verify:public-library all exit 0. Browser: Play tab probe
  (Data Source readout, MIDI section, shelf) all present, Torus
  Knot applied, 0 console errors (screenshot capture stalled on
  headless font loading; DOM evidence stands).

## ESLint warning burn-down (2026-11-08): zero errors, zero warnings

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte).

- `npm run lint` now reports nothing at all (was 0 errors / 137
  warnings at the start of this pass, 276 when ESLint was
  introduced). The user chose the full route: real fixes where the
  finding was real, explicit documented suppression where the rule
  and the codebase's idiom disagree.
- Real fixes (39 warnings):
  - 4 unused eslint-disable directives removed (autofix).
  - preserve-caught-error (2): shared-audio rethrows now attach
    `{ cause: error }`.
  - no-useless-assignment (12): never-read initial values dropped
    in particleData, useGpgpuRuntime, appStateCollision and two
    phase5 scripts; tsc definite-assignment analysis proves every
    path assigns before use, so behavior is identical.
  - no-explicit-any (16): the AppRootLayout audioRef is now
    MutableRefObject<AudioLevels>; the product-pack section props
    mirror the hook's declared state types; projectStateStorage
    narrows with `{ id?: unknown }`-style records; the two
    `routing as any` casts became `as LayerExecutionRoute` /
    `as GpgpuExecutionRoute` (the snapshot type is literally the
    routes' base type); the phase5 handoff script's JSON reads are
    typed with a small ArchiveJson interface.
  - exhaustive-deps (5): stable values added where the plugin was
    right (geometryRef in the fiber runtime effects,
    microphoneStreamRef / setSequenceLoopEnabled in video export)
    and two field deps already covered by a whole-config dep were
    dropped.
- Documented per-site suppressions (18): the scene systems compute
  layout dependencies through get*Deps() helpers (or literal field
  lists) naming the exact config fields a layout reads — a
  whole-config dependency would rebuild geometry on every slider
  change, so those useMemo sites carry a reasoned
  eslint-disable-next-line. Same treatment for the line system's
  deliberate force-rebuild dep (lineRefreshTick) and five
  set-state-in-effect sites that are intentional resets/syncs on
  mode changes (media playback flag, rasterize status, breeding
  selection repair, temporal timer, sequence progress).
- Config decisions, recorded in eslint.config.js: the two React
  Compiler-era rules (immutability, refs) are off — this project
  does not use the compiler, and they flag the react-three-fiber
  imperative idiom (mutating THREE objects, reading runtime refs)
  at ~40 sites; react-refresh/only-export-components is off
  (barrel modules and colocated helpers are the project's file
  organization; the rule is dev-experience only). Everything that
  reached zero by fixes is ratcheted to 'error', and unused
  disable directives are now errors too, so the zero state is
  self-guarding.
- Gates: typecheck 0, lint silent (exit 0), build OK,
  verify:phase5 / verify:project-state / verify:public-library all
  exit 0. Browser: app loads, Procedural Crystal Crust (a layout
  system whose deps helper is one of the suppressed sites) applies
  and renders with 0 console errors.

## GPGPU seed determinism (2026-11-08): reproducible initial cloud (8D seed slice)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte; lib/gpgpuInitialData.ts is new on Drive, id 1BMzPC7AkmAswsi9OcxDWmeGzgaDM8oFy).

- Audit first: the whole codebase has only 37 Math.random sites.
  The CPU particle layout (generateParticleData) was already
  deterministic (index-seeded hash). ID generators stay random on
  purpose. The preset randomizer is random by design (it is the
  shuffle feature). The one place where randomness decided what a
  preset LOOKS like was the GPGPU initial state: 14 Math.random
  calls filling the initial position/velocity textures.
- lib/gpgpuInitialData.ts (new): that generation is now a pure
  function buildGpgpuInitialData(texSize, bounceRadius, emitShape,
  seed) — the distribution math is the original code verbatim,
  only the random source changed to a seeded mulberry32. The same
  arrays seed both the WebGL and WebGPU backends, as before.
- New config field gpgpuSeed (default 1, in the GPGPU defaults
  block; presets/projects saved before this change pick the
  default up through the usual defaults merge). The runtime's
  init effect now also depends on the seed, so changing it
  re-seeds the cloud immediately. Main tab GPGPU section gained a
  Seed slider (0-999), also catalogued for Parameter Search /
  MIDI. Behavior change to note: with a fixed default seed, a
  GPGPU preset now opens with the SAME initial cloud every time
  instead of a fresh random one — that reproducibility is the
  feature; vary the seed (or the randomizer) for variety.
- The data-source spiral sample is seeded too (fixed seed), so
  サンプル（渦巻銀河） produces the same spiral on every click.
- Scope, stated plainly: this makes the INITIAL state
  reproducible (same config -> same starting positions and
  velocities, bit-for-bit). Frame-to-frame evolution still runs
  through time-based shader noise/respawn, so two runs are not
  frame-identical — full simulation determinism would need a
  fixed-timestep shader clock and remains a larger project.
- Proof: unit checks over all six emit shapes — same seed gives
  bit-identical pos/vel arrays, a different seed differs, all
  values finite, radii within the expected envelopes. Gates:
  typecheck 0, lint exit 0, build OK, verify:phase5 /
  verify:project-state / verify:public-library all exit 0.
  Browser: GPGPU enabled, the seeded cloud renders, Seed slider
  present in the GPGPU section, 0 console errors (excluding the
  known headless SwiftShader VALIDATE_STATUS quirk that appears
  whenever GPGPU is on).

## OSC control via a local bridge (2026-11-08): the last roadmap item (Phase 8 remainder)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte; new on Drive: lib/oscControl.ts id 1-z6OUHbjtUX1hEBQom2iaks1gPqHEyD2, tools folder id 1hEjIPUhNK2M6PXExXeK1eWQelZmDLGxl, tools/osc-bridge folder id 1T2ohIRph15A6p-TMdzantPBngyoJQQmH, osc-bridge.mjs id 1iIbzK0HRu0SDP30lhaXp89EJljQ-xB69, bridge README id 1prIm5Ig8KkN1Vmv6_mgBWCwDX2RtmFlf).

- Why a bridge: browsers have no UDP, and OSC rides on UDP — no
  in-page implementation is possible. The standard architecture
  (and the one every browser-based OSC tool uses) is a small local
  relay. tools/osc-bridge/osc-bridge.mjs is exactly that: a
  dependency-free Node script (built-in modules only, runs with
  the same Node as the launcher) relaying
  OSC --UDP :9000--> bridge --WebSocket :8765--> the app, and
  app --WebSocket--> bridge --UDP :9001--> OSC receivers. It
  includes a hand-written OSC codec (messages + bundles,
  f/i/s/T/F/b) and a minimal RFC 6455 WebSocket server.
  tools/osc-bridge/README.md documents usage.
- lib/oscControl.ts mirrors the MIDI model: an OSC address is
  bound (Learn) to one of the 8 macros or any catalogued
  parameter; assignments persist in localStorage
  (kalokagathia.oscAssignments.v1), deliberately outside
  presets/projects. Value convention: the first numeric argument
  is the control value; 0..1 is used as the ratio directly,
  larger values are read as a 0..127 controller scale.
- Play tab gained an OSC Control section right after MIDI
  Control: bridge URL (default ws://127.0.0.1:8765), connect /
  disconnect, the same target picker + Learn flow as MIDI,
  assignment list, last-message readout. Active while the Play
  tab is open.
- Verification: the codec round-trips (message and bundle) in
  node; the bridge's relay logic was exercised in both
  directions; and a full end-to-end run — the real bridge
  process + the real app in a browser — learned /monosphere/
  density onto the Density macro and drove it 0.65 -> 1.0 ->
  0.26 from OSC values, 0 console errors. One sandbox caveat:
  this development VM's network policy blocks real UDP sends
  (EPERM), so the controller->bridge UDP hop was simulated by
  delivering the encoded packet to the bridge's UDP handler
  directly; the bridge code paths themselves are the ones that
  ran. On a normal machine (the user's iMac) the UDP hop is
  plain dgram and needs no simulation.
- Syphon, honestly: a web page cannot originate a Syphon (or
  Spout) feed — there is no browser API for GPU texture sharing,
  and a network bridge cannot change that. The README documents
  the practical equivalent: run the app fullscreen and capture
  the window with a Syphon server tool (e.g. OBS Studio with a
  Syphon output) for Resolume / VDMX / TouchDesigner. Same
  pixels, no quality loss.
- Gates: typecheck 0, lint exit 0, build OK, verify:phase5 /
  verify:project-state / verify:public-library all exit 0.

## Node graph view (2026-11-08): the scene as connected nodes (Phase 10, first slice)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte; lib/graphModel.ts is new on Drive, id 1cJ5Rl2yRyrgd5q_sHXWGzgzzt9WXasa4).

- What a node graph is, in this app's terms: instead of hunting
  through flat panels, the scene's construction is drawn as
  boxes (stages) joined by wires. The engine's real architecture
  is a fixed set of parallel pipelines — Layer 1 (SDF core),
  Layer 2, Layer 3 and the GPGPU layer each run
  source -> motion -> render and are composited into one
  output — so the graph models exactly that: 9 nodes
  (L2/L3 source+motion+render, L1 core, GPGPU, Output) and the
  8 real edges between them.
- lib/graphModel.ts (new): node ids, default layout, edge list,
  option lists mirroring the engine's own unions (16 sources,
  sprite modes, connection styles, GPGPU emit shapes), and
  localStorage persistence for node positions
  (kalokagathia.graphLayout.v1) — positions are a view
  preference and never enter the config.
- Play tab gained a Node Graph section (before the Expression
  Map): a dotted-canvas with draggable node cards (drag the
  header; positions save automatically; a reset button restores
  the default layout). Each card edits the live config through
  the same updateConfig path the panels use — source/motion/
  render selects (motion uses the grouped 197-type catalog),
  key sliders via the parameter catalog, and per-layer On/Off.
  Disabled layers dim; the Output node is display-only (post FX
  lives in the FX tab). Editing is disabled in the public build.
- Scope, stated plainly: this is a node-graph VIEW and editor
  over the engine's fixed pipelines — stages can be reconfigured
  and rearranged visually, but the wiring order is the engine's
  structure, not free-form dataflow. A free-form dataflow engine
  (arbitrary nodes executing in the renderer) would be a core
  rewrite and remains out of scope.
- Browser-verified: all 9 nodes + edges render; changing the
  Layer 2 motion from the graph (flow -> torus_knot) writes the
  config; a real mouse drag moved a node by exactly the dragged
  delta and the layout persisted. Gates: typecheck 0, lint exit
  0, build OK, verify:phase5 / verify:project-state /
  verify:public-library all exit 0.

## Modulation engine (2026-11-08): signals routed to parameters (Phase 11 flagship)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 (md5-verified: the pre-reflection Drive files matched the pre-change git versions exactly, and post-reflection read-backs match the new files byte-for-byte; lib/modulation.ts is new on Drive, id 1Jr2RQ6RN1MciUY7nBQAY761SBHA9sobD).

- The synth-style heart the roadmap's "ultimate" discussion chose
  first: signals that keep moving parameters on their own, so a
  scene breathes and reacts without being touched.
- Architecture: the scene already renders from an *effective*
  config derived just before rendering (the built-in temporal
  profiles work exactly this way in
  components/useAppSceneTemporalConfig.ts). Modulation is a
  second overlay on that effective config — the base config,
  presets and project files are never written. The hook now also
  receives the scene's audioRef, and its clock ticks at 50 ms
  while modulation is active (83 ms for temporal profiles alone,
  as before). Pausing playback pauses modulation too.
- lib/modulation.ts (new): 4 LFO slots (sine / triangle / saw /
  square / drift — two incommensurate sines that never quite
  repeat), 5 audio band sources (bass / treble / pulse / bandA /
  bandB from the live AudioLevels), and routes from any source
  to any of the 352 catalogued numeric parameters with a depth
  of -1..1. Application math: base + (signal - center) * depth *
  catalog range, summed across routes onto the same parameter,
  clamped and step-snapped like every other input path. Setup
  persists in localStorage (kalokagathia.modulation.v1) with
  full validation on load, and is shared between the Play tab
  editor and the scene through a tiny useSyncExternalStore
  store in the same module.
- Play tab gained a Modulation section (after OSC): engine
  on/off, a starter-set button (LFO1 -> Layer 2 speed, Audio
  Bass -> Layer 2 size, LFO2 -> Layer 3 speed), 4 LFO cards with
  live level meters, and route cards (source select, target
  select grouped by tab, depth slider, delete). Editing is
  disabled in the public build.
- Verification: the pure core is unit-proven (waveforms bounded
  in [0,1]; disabled = object identity; LFO and audio
  contributions exact to the formula; base config never
  mutated). In the real app, a temporary debug trace (added,
  observed, removed) showed the overlay being applied
  continuously with the square-wave contribution alternating
  exactly between +20000 and -20000 on layer2Count as time
  advanced. Headless pixel sampling could not isolate the
  effect (headless rAF runs at ~2 fps under SwiftShader and the
  first probe targets — particle size/count — rebuild or
  attenuate heavily there); on the iMac the 50 ms tick runs at
  full rate. Gates: typecheck 0, lint exit 0, build OK,
  verify:phase5 / verify:project-state / verify:public-library
  all exit 0; the section itself renders with 0 console errors
  and the starter set installs and persists.

## Stage mode: A/B decks with crossfader (2026-11-08)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 (md5-verified: the pre-reflection Drive file matched the pre-change git version exactly, and post-reflection read-backs match the new files byte-for-byte).

- Discovery that shaped this batch: the app's score system already exists — the
  Main tab sequence editor (per-item hold + transition seconds + easing), morph
  transitions between presets (`applyConfigMorph`), loop playback, and even a
  "Sequence" video export mode are all in the original code. Building a second
  score system would have duplicated it. The missing performance piece was a
  manual, scrubbable crossfade between two looks, which is what this adds.
- Play tab gains a **Stage section** (after Macros): Deck A / Deck B cards, each
  loading any library preset or capturing the current live scene as a snapshot,
  and a 0..1000 crossfader between them. Blending uses the engine's own
  `interpolateConfig` (the same interpolation the sequence morphs use: numbers
  lerp, arrays element-wise, discrete fields switch at the midpoint), applied
  through the standard instant-apply path — presets themselves are never
  modified, and a blended state can be saved as a new preset as usual.
- Controls: A/B cut buttons, an auto-fade button (ease-in-out, towards the far
  side) with 1/2/4/8 second duration chips, and a live mix readout. Loading a
  preset into a deck re-applies the blend at the current fader position.
  Editing is disabled in the public read-only build.
- Verification: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.
  Browser check: Stage section renders; loading two presets enabled the fader;
  fader at 0 showed Deck A's motion type in the live config (via the Node
  Graph readout) and its Density macro value; fader at 1 switched the live
  config to Deck B's motion type and Density; 0 console errors.

## Preset similarity map (2026-11-08)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 in the consolidated 4-batch reflection (25 files, all read-back verified byte-identical).

- `lib/presetSimilarity.ts` (new): every preset becomes a 778-dim feature
  vector — the 352 catalogued numeric parameters normalized to 0..1, plus
  weight-0.6 one-hot blocks for layer 2/3 motion type (197) and source (16).
  Cosine similarity over the vectors ranks neighbors; a deterministic PCA
  (fixed-seed power iteration over the numeric block) projects the library
  onto 2D. Pure functions, nothing stored.
- Play tab gains a **Similarity Map section** (after Node Graph): an SVG
  scatter of the whole library (click a dot to select, the loaded preset is
  ringed), the selected preset with a load button, and its 8 nearest
  neighbors with similarity percentages and load buttons.
- Verification: unit checks in node — identical configs score exactly 1.0;
  two same-motion near-identical configs rank each other first; the PCA
  projection is bit-deterministic across runs; 513-preset PCA takes ~220 ms,
  neighbor search ~60 ms. Browser check: map renders all 444 presets of the
  private library as dots, selection readout and 8 neighbor rows appear,
  0 console errors. One real bug was caught by the unit check: MOTION_GROUPS
  exposes `ids`, not `types` — the first version silently produced empty
  motion blocks.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## GPU feedback: true screen-space feedback pass (2026-11-08)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 in the consolidated 4-batch reflection (25 files, all read-back verified byte-identical).

- Pre-check finding: the app had feedback LOOKALIKES only — the
  screen-persistence overlay is a synthetic time-based shader (no
  previous-frame sampling), plus geometry ghost trails. Real feedback is new.
- `components/feedbackPass.ts` (new): a custom `Pass` for the existing
  postprocessing EffectComposer. Each frame it composites the current frame
  with the previous composite — sampled with a zoom/rotation transform,
  softened by a 4-tap blur, scaled by decay — using `max()` so bright
  structures persist, swirl and fade. Two HalfFloat targets ping-pong so the
  shader never samples its own render destination; a second draw presents
  the composite to the output buffer or screen. The pass is registered as
  the 'feedback' stage, last in every stack profile, so it feeds on the
  fully processed frame.
- Config: `postFeedbackEnabled` (default off), `postFeedbackDecay`
  (0..0.97, default 0.85), `postFeedbackZoom` (0.95..1.05, default 1),
  `postFeedbackRotation` (-0.1..0.1 rad/frame, default 0) — with defaults in
  the post defaults block, controls in the Main tab Post Processing section
  (Feedback (GPU) toggle + 3 sliders), and parameter-catalog entries, so
  search / MIDI / OSC / modulation can drive them too. The parameter catalog
  grows 352 → 355 entries. The coverage resolver's 'feedback-field' family
  now also triggers on the real thing, not only on the lookalikes.
- Implementation notes: @react-three/postprocessing collects raw Pass
  children through the R3F instance graph (`<primitive object={pass}>`), the
  vertex shader mirrors postprocessing's shared fullscreen shader (vUv from
  position), and rendering goes through the Pass base scene/camera — the
  first draft used a nonexistent helper and typecheck caught it.
- Verification: typecheck 0, lint clean, build OK, all three verifies pass.
  Browser check with a temporary frame counter (added, observed, removed):
  the pass renders every frame once enabled; with identity transform and
  decay at max, the bright-pixel fraction of the canvas grows monotonically
  (0.108 → 0.120 → 0.127) — the running-max accumulation signature. An
  earlier zoom test was inconclusive because the live scene itself was
  dispersing; the identity-transform test isolates the effect. 0 console
  errors throughout.

## Deterministic render export (2026-11-08)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 in the consolidated 4-batch reflection (25 files, all read-back verified byte-identical).

- `lib/deterministicRender.ts` (new) + `components/DeterministicRenderManager.tsx`
  (new, mounted in AppScene): the Play tab Export section gains a
  **Deterministic Render** block (length 1–8 s, 12/24/30 fps, max 240
  frames). The manager switches the frameloop to 'never', resets the
  in-scene clock, and advances it by exactly 1/fps per frame, copying each
  rendered frame to a PNG; frames ship as a STORE-compressed ZIP
  (`frame-0000.png` … plus `render.json`). Unlike the realtime video
  export, frame i always shows the scene at (i+1)/fps seconds.
- `lib/sceneGeneration.ts` (new): the export bumps a scene generation,
  which remounts AppScene's layer content and camera rig so per-system
  accumulated state restarts from its initial values, and waits for the
  remount plus — when a GPGPU system is present — the backend's async
  initialization settle (composition/settled notes wired through
  AppSceneLayerContent and useGpgpuRuntime), so no frame can switch
  execution path mid-take.
- Findings during verification (kept honest in the UI copy): two takes of
  the default GPGPU scene in headless SwiftShader agree on ~97.7% of
  pixels — same shape, counts and timing — with a residual per-particle
  float divergence inside the GPU sim passes on that software GL stack;
  byte-identity of GPU-simulated scenes is therefore part of the iMac
  on-hardware check. A real defect was found and fixed along the way:
  JSZip's default DEFLATE re-compressed the already-compressed PNG frames
  and could stall for minutes on dense frames; the ZIP now uses STORE.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.
  Browser check: repeated end-to-end exports complete, 0 console errors.

## Custom GLSL force + WebGPU boundary (2026-11-08)

Implemented in the upgrade git copy; applied to Drive on 2026-11-08 in the consolidated 4-batch reflection (25 files, all read-back verified byte-identical).

- **Custom GLSL force** (the tractable slice of the "WebGPU + custom GLSL"
  candidate): `gpgpuCustomForceEnabled` / `gpgpuCustomForceCode` config
  fields (saved with presets/projects like any other field). The Main tab
  GPGPU Forces section gains a Custom Force block with a code editor,
  an example snippet, and an apply flow. On apply, `lib/gpgpuCustomForce.ts`
  validates the snippet (length cap; no preprocessor directives, no
  `gl_FragColor`, no uniform/attribute/varying declarations, no texture
  sampling) and compile-checks it inside a harness shader exposing the
  documented interface — `pos` / `vel` (vec3), `uTime` / `uDelta` (float) —
  in the same block scope it will occupy. Only then does
  `buildVelocityFragment` (components/gpgpuShaderSimulationVelocity.ts)
  inject it into the velocity shader after all built-in forces, before
  the speed clamp/damping/boundary, and the material is swapped. Any
  failure keeps the previous shader and shows the compiler's message.
- Environment finding (pre-existing, not caused by this change): the
  stock velocity shader does not compile under headless SwiftShader/
  ANGLE at all — its vnoise mix cascade is rejected
  (`'mix': no matching overloaded function found`, link fails), which is
  why the GPGPU sim cannot run in the headless test browser and why the
  harness (not the full shader) is the compile-check target. On real GPU
  stacks (the user's iMac) the stock shader compiles and this feature
  applies on top of it; the end-to-end apply/reject flow was verified in
  the browser here (example accepted and swapped in; an undefined
  function rejected with the compiler log, previous shader kept).
- **WebGPU boundary, stated plainly**: a real WebGPU compute path already
  exists for the GPGPU subsystem (WGSL velocity/position pipelines in
  lib/webgpuCompute.ts, engaged by the execution routing when the backend
  preference allows; unsupported features fall back to WebGL, and PLY
  readback is skipped on that path). The custom GLSL force applies to the
  WebGL velocity shader, as the UI states. A *full* WebGPU migration —
  the CPU motion families (197 types), line/tube/surface renderers and
  the post chain — is a core rewrite, not a slice; per the roadmap its
  go/no-go stays gated on WebGPU performance measured on the user's iMac,
  which is still pending. No migration was faked here.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.
  Unit checks: validator token rules, example validity, injection point
  before the speed clamp, empty code returns the stock shader byte-equal.

## Coverage completion generator (2026-11-08)

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (consolidated reflection, 21 files, md5-verified).

- `lib/coverageCompletion.ts` (new): computes covered source × motion
  pairs with exactly the Expression Map's accounting (enabled layers 2/3
  of every preset plus the live config), lists uncovered pairs for a
  chosen motion type (all 16 sources) or source (all 197 motion types),
  and generates donor-clone presets for them — a preset already running
  the target motion keeps its tuned parameters with only its layer 2
  source swapped (or vice versa); the other layer is switched off so each
  generated preset is a focused single-pair study. Donor choice rotates
  in library order; batches are capped at 24.
- Play tab Expression Map gains a **Coverage Completion** block: motion /
  source axis toggle, target select, covered-pair readout against the
  full 16 × 197 = 3,152-pair universe, and a generate button that adds
  the batch through the existing bred-preset save path (blocked in the
  read-only public library).
- Verification: unit checks — pair accounting matches the map's rule on
  synthetic libraries, generation fills exactly the uncovered set, output
  is deterministic. Browser check on the real library: the grid starts at
  the known 292 covered pairs; generating for `flow` (enabled in zero
  presets) adds 16 presets, the readout moves 292 → 308, and the shelf
  shows the 16 new "Coverage ·" tiles; 0 console errors.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## New post effects: kaleidoscope / mirror + slit-scan (2026-11-08)

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (consolidated reflection, 21 files, md5-verified).

- `components/kaleidoscopePass.ts` (new): a stateless custom post pass
  that folds the frame in polar space into mirrored wedges (segments
  2–16, rotation offset, aspect-corrected). Config
  `postKaleidoscopeEnabled/Segments/Rotation`, Main tab Post Processing
  controls, parameter catalog entries.
- `components/slitScanPass.ts` (new): a temporal pass over a ping-pong
  history pair — the frame is split into horizontal bands (4–64) and
  each band refreshes only on its slot of a repeating frame cycle
  (2–120), so motion shears across time slices. The first cycle is a
  warmup where every band refreshes. Config
  `postSlitScanEnabled/Bands/Cycle`, controls and catalog entries.
- Both are stages in `lib/postFxStack.ts` (ordered just before the
  feedback stage in every profile) and mount in AppScenePostFx beside
  the feedback pass. Coverage gains two post families:
  `kaleidoscope-fold` and `slit-scan` (targets + resolvers).
- Verification: browser — enabling Kaleidoscope drops the measured
  6-fold-symmetry error of the rendered frame from 38.2 to 5.7 (mean
  absolute brightness difference between points 60° apart); Slit Scan
  enables alongside it and the scene keeps rendering; 0 console errors.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## Clean output window (2026-11-08)

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (consolidated reflection, 21 files, md5-verified).

- `lib/cleanOutput.ts` (new): opens a chrome-less popup that mirrors
  the live main canvas via `canvas.captureStream(60)` into a fullscreen
  <video> — no second render pass, no state sync; every control change
  appears on the output immediately. Clicking the video toggles
  fullscreen; the cursor is hidden over the output. Popup-blocked and
  no-canvas states are reported. Audio is not mirrored.
- Play tab gains a **Clean Output** section right after Stage: an
  open/close toggle with live open-state polling and guidance (drag the
  window to the projector display, click for fullscreen).
- Verification: headless browser — the popup opens, its video reaches
  readyState 4 at the main canvas's 1600×1000 with real frame content
  flowing (non-black samples); 0 console errors.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## Command palette (⌘K) (2026-11-08)

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (consolidated reflection, 21 files, md5-verified).

- `components/CommandPalette.tsx` (new): a global keyboard-first
  launcher, mounted by ControlPanel in both its open and collapsed
  states. ⌘K / Ctrl+K toggles it from anywhere; one query searches
  presets by name (Enter loads the preset) and the numeric parameter
  catalog via the existing `searchParameters` (Enter jumps to the
  owning tab through the same tier-raising jump as parameter search).
  ↑/↓ + Enter + Esc (handled at window level so it works regardless of
  focus) and mouse hover/click are supported.
- The Play tab parameter-search description now points at ⌘K.
- Verification: headless browser — Ctrl+K opens; "Feedback Decay"
  finds the parameter and Enter jumps to the Main tab (Post Processing
  visible) and closes; preset search + Enter loads and closes; Esc
  closes; 0 console errors.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## Prompt-to-preset drafts (words → starter presets) (2026-11-08)

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (consolidated reflection, 21 files, md5-verified).

- `lib/promptPreset.ts` (new): a transparent local interpreter — no
  external AI. Motion words (渦 / 雲 / 結晶 / 螺旋 … plus English) map
  to real motion types; mood words (儚い / 激しい / 静か / 重い …) map
  to macro positions applied through the macro data mappings. The base
  is a donor preset already running the chosen motion (falling back to
  the current config, which the notes say out loud); two seeded
  mutations of the base (breeding machinery, text-hash seed) join it as
  variations. Every interpretation is returned as notes.
- Play tab gains a **Prompt Draft** section after Breeding: phrase
  input, the interpretation notes, and three draft cards with
  apply / save (save uses the bred-preset path; blocked in the public
  library).
- Verification: unit checks — the phrase 「渦巻いて上昇する儚い雲」
  resolves to a spiral_motion donor with density/trails/glow/weight
  macros applied (layer2Count 8000 → 800), all drafts keep the motion,
  output is deterministic, no-match phrases fall back to mutation-only
  with an explanatory note. Browser: drafts generate, apply and save
  work, 0 console errors.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## Deterministic render → in-app video (WebCodecs) (2026-11-08)

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (consolidated reflection, 21 files, md5-verified).

- `lib/videoEncode.ts` (new): feeds the deterministically captured PNG
  frames to a WebCodecs VideoEncoder with exact timestamps (frame i at
  i/fps) and muxes in-app — WebM/VP9 via `webm-muxer`, MP4/H.264 via
  `mp4-muxer` (both added as dependencies). Support is probed via
  `VideoEncoder.isConfigSupported`; unsupported browsers raise
  VideoEncodeUnsupportedError and the UI steers the user to the PNG
  sequence instead. Bitrate scales with pixels/fps (2–24 Mbps).
- `renderDeterministicVideo` in `lib/deterministicRender.ts` reuses the
  same stepped capture handler; the Play tab Deterministic Render block
  gains a format choice: PNG連番 ZIP (unchanged) / WebM / MP4.
- Verification: end-to-end through the real UI in the browser — a WebM
  (513 KB) whose metadata reads back as a valid 1600×1000 video of
  2.92 s (≈ the 36 stepped frames at 12 fps), and an MP4 (865 KB), both
  produced with 0 console errors.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## Docs refresh: CURRENT_STATUS / UPGRADE_ROADMAP brought current (2026-11-08)

Applied directly to the Drive Google Docs (append-only; Docs version
history preserves the previous text) and verified by read-back.

- CURRENT_STATUS.md (29,229 → 30,516 chars): a dated 2026-11-08 section
  summarizing everything after the Phase 5 closeout it previously ended
  at — the library upgrade and the adopted verify:phase5 fix, strict /
  lint-zero hygiene, the Phase 6–9 Play tab work, the color decision
  (monochrome only), the "ultimate" feature run, and the operating
  state (Drive as canonical, backup retained until the iMac launch
  check, WebGPU migration gated on iMac measurements). The Phase 5
  completion judgment itself is unchanged.
- UPGRADE_ROADMAP.md (9,156 → 9,853 chars): a short addendum stating
  that Phases 1–5 are complete and that post-Phase-5 work is tracked in
  UPDATE_LOG.md, not in that document.
- DOCS_INDEX.md needed no change (no documents were added or renamed).

## Node graph: motion-mix wiring + free-wiring assessment (2026-11-08)

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (consolidated reflection, 21 files, md5-verified).

- The graph's Layer 2 / 3 Motion nodes gain a **Motion Mix** editor:
  the engine's existing per-emitter motion assignment
  (`layerNMotionMix` + `layerNMotions[i]`, written through
  `updateMotionArray`) is now editable from the graph — different
  emitters of one layer can run different motions, wired in place.
  Renderer and data format unchanged.
- Free-form wiring (an arbitrary DAG evaluated by the engine) was
  assessed and deliberately NOT attempted: the layer systems are fixed
  source → motion → render pipelines in their runtime snapshots, and a
  graph evaluator would replace the particle update loops — a core
  rewrite whose visual-equivalence gate needs the real GPU (the iMac
  launch check is still pending). The full assessment with a staged
  plan (serial motion chains → cross-layer routing → DAG evaluator)
  is in the goal workspace: free-wiring-assessment.md.
- Verification: browser — Mix toggles on inside the graph card,
  per-source selects appear, changing source 0 writes
  layer2Motions[0] ('vortex'); 0 console errors.
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## Bug fix: GPGPU velocity shader never compiled — vnoise mix() missing u.z (2026-11-08)

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (md5-verified).

- Root cause of the long-standing "headless SwiftShader quirk": the
  Perlin `vnoise` in `components/gpgpuShaderSimulationVelocity.ts`
  called its outermost `mix()` with only two arguments — the `u.z`
  interpolation factor was missing — so the fragment shader failed to
  compile on EVERY GLSL compiler ('mix': no matching overloaded
  function found), and the whole WebGL velocity program never linked.
  It was never a SwiftShader/ANGLE strictness issue. Reproduced
  standalone in a raw WebGL2 context; adding `, u.z` compiles cleanly.
- The WGSL twin in `lib/webgpuCompute.ts` had the identical missing
  argument and got the identical one-token fix (no WebGPU adapter is
  available in the dev environment, so its compile verification joins
  the iMac check; the defect and fix are structurally identical).
- Consequence: on the WebGL path the GPGPU simulation (curl noise and
  every other velocity force — they share the one program) has been
  silently dead; only the CPU-seeded initial cloud rendered. After the
  fix, enabling GPGPU in the app under SwiftShader produces 0 console
  errors (previously the shader error appeared every time) and the
  simulation runs. Behavior change: GPGPU scenes now actually evolve
  under their forces on WebGL.
- The stale comment in `lib/gpgpuCustomForce.ts` that attributed the
  failure to SwiftShader was corrected.
- Also relevant to the deterministic render: part of the residual
  divergence measured headless came from the dead program; GPU-scene
  takes should agree better now (byte-identity across different GPUs
  remains impossible in general — float rounding differs by hardware).
- Gates: typecheck 0 errors, lint clean, production build OK,
  verify:phase5 / verify:project-state / verify:public-library all pass.

## 2026-11-08 — GPU compatibility audit + in-app GPU diagnostics

A full shader audit: a WebGL hook in headless Chromium counted every shader
compile and program link while the app was driven through GPGPU (incl. SPH
and fluid advection), the entire post chain, and a 34-preset tour across the
library (162 shader sources, 152 compiles / 81 links in the first pass).
Three more latent defects of the same class as the vnoise bug — identifiers
used without declaration, fatal on every GLSL compiler — were found and
fixed:

- components/sceneDepositionFieldSystem.tsx: the fragment shader used
  uSootStain / uRuneRetention / uVelvetMatte / uVaporLift without declaring
  them (only the vertex shader did), so every deposition-family mode
  (capillary sheet, corrosion front, biofilm skin, ...) silently failed to
  render its material.
- components/sceneReactionDiffusionShaders.ts: the display vertex shader
  sampled reactionTexture and used contourTightness / heightGain /
  ridgeGain / pitGain / wetness / scarStrength without declaring them (the
  runtime supplied all of them; the fragment shader declared its subset), so
  the reaction-diffusion display never linked.

After the fixes the same audit is fully clean: 148 compiles, 74 links,
0 failures, 0 console errors.

Also added (Play tab, after Clean Output): a GPU Diagnostics section backed
by lib/gpuDiagnostics.ts — one click reports WebGL2 availability, the
unmasked renderer string, software-rendering detection, float color-buffer
support (the GPGPU requirement), max texture size, fragment highp support,
and WebGPU adapter status. When software rendering is detected it offers a
one-click lighten (Layer2/3 counts halved, GPGPU count quartered, applied
through the normal config path). Verified in the software-GL environment:
SwiftShader is correctly reported as software rendering and the lighten
flow applies. Remaining environment boundary, unchanged: the WebGPU/WGSL
path can only be compile-verified on real hardware (the iMac check), and
pixel-identical output across different GPUs is impossible in principle —
"runs everywhere" is the achievable guarantee, and after this audit the
WebGL path's shader surface is verified end to end.

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (md5-verified).

## 2026-11-08 — Shader audit made permanent: verify:shaders

The one-off GPU compatibility audit is now a standing check:
scripts/verify-shaders.mjs, run as `npm run verify:shaders`. Following the
existing verify scripts' convention it drives an already-running app
(APP_URL, default http://127.0.0.1:3000/) in headless Chromium with a WebGL
hook that counts every shader compile and program link, enables the GPGPU
simulation (incl. SPH and fluid advection) and the full post chain, then
tours the preset shelf strided (34 of ~450 presets) so the per-family scene
systems mount. A missing UI toggle fails the run loudly (the audited
surface must not silently shrink), and any compile/link failure or console
error exits 1 with the shader log. CHROMIUM_PATH can point at a specific
Chromium build; a Playwright browser install is the only prerequisite.

First standing run (this environment, software GL): 210 compiles,
105 links, 0 shader failures — but the run printed FAIL because a single
resource-load console error (one HTTP 404, not reproduced since; the full
tour re-run with response logging shows no failing request) tripped the
console-error gate, and the invoking shell pipeline masked the exit code,
so the result was initially misreported as a clean PASS with wrong counts.
Correction: the script now records failed requests by URL and reports
resource-load errors as named warnings instead of hard failures (shader
compile/link failures and real console/page errors still fail the run).
Verified after the correction: 212 compiles, 106 links, 0 failures,
0 console errors, 0 resource warnings — PASS, exit code captured directly. The iMac launch checklist
was also refreshed for everything since its first version (revived GPGPU
simulation / deposition / reaction-diffusion checks, the GPU Diagnostics
readout incl. the WGSL compile confirmation, Stage mode now included).

Implemented in the upgrade git copy and applied to Drive on 2026-11-08 (md5-verified).
