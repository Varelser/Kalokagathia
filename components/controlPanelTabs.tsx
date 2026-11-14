import React from 'react';
import { createPortal } from 'react-dom';
import { AmbientTabContent, AudioTabContent } from './controlPanelTabsAudio';
import { GlobalTabContent } from './controlPanelTabsGlobal';
import { Layer1TabContent, Layer2TabContent, Layer3TabContent } from './controlPanelTabsLayers';
import { PlayTabContent } from './controlPanelPlayTab';
import { AiTabContent } from './controlPanelAiTab';
import { ControlPanelContentProps } from './controlPanelTabsShared';
import { PARAMETER_CATALOG } from '../lib/parameterCatalog';
import { BASIC_PRIMARY_KEYS, basicAppliesTo } from '../lib/basicPrimaryParameters';
import { isSharedView, subscribeSharedView } from '../lib/shareLink';
import { getParameterDescription } from '../lib/parameterDescriptions';
import { NOTE_GUIDE_URL, NOTE_LINK_BY_KEY } from '../lib/noteBacklinks';
import {
  CONTROL_KEY_DESCRIPTIONS,
  CONTROL_KEY_NOTE_LINKS,
  getControlDescription,
  getControlNoteLink,
} from '../lib/controlDescriptions';

const FOLD_STORAGE_KEY = 'kalokagathia.folds.v1';
type FoldMap = Record<string, boolean>;
const loadFolds = (): FoldMap => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_STORAGE_KEY) || '{}') as FoldMap;
  } catch {
    return {};
  }
};

export const DECK_MODE_STORAGE_KEY = 'kalokagathia.deckMode.v1';
export type DeckMode = 'basic' | 'pro';
export const loadDeckMode = (): DeckMode => {
  try {
    // Basic on first visit only; the choice is remembered afterwards.
    return localStorage.getItem(DECK_MODE_STORAGE_KEY) === 'pro' ? 'pro' : 'basic';
  } catch {
    return 'basic';
  }
};

export const ControlPanelContent: React.FC<ControlPanelContentProps> = (props) => {
  const { activeTab, isPublicLibrary, config, activePresetId, isPresetTransitioning } = props;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [changedOnly, setChangedOnly] = React.useState(false);
  const [ownDeckMode] = React.useState<DeckMode>(loadDeckMode);
  // Four-edge layout: the mode state is lifted to ControlPanel (the top
  // header switches it at any time). The local state is only the
  // standalone fallback initialised from the same localStorage key;
  // ControlPanel always passes deckMode + onDeckModeChange.
  const deckMode = props.deckMode ?? ownDeckMode;
  const [basicHiddenCount, setBasicHiddenCount] = React.useState(0);
  const deckModeRef = React.useRef(deckMode);
  deckModeRef.current = deckMode;


  // --- Changed-vs-baseline tracking (idea 3) --------------------------------
  // Baseline = the config right after a preset is applied (or at mount).
  const baselineRef = React.useRef<{ id: string | null; snap: Record<string, unknown> } | null>(null);
  const transRef = React.useRef(false);
  React.useEffect(() => {
    const wasTransitioning = transRef.current;
    transRef.current = isPresetTransitioning;
    const base = baselineRef.current;
    if ((!base || base.id !== activePresetId || (wasTransitioning && !isPresetTransitioning)) && !isPresetTransitioning) {
      baselineRef.current = { id: activePresetId, snap: { ...(config as unknown as Record<string, unknown>) } };
    }
  }, [activePresetId, config, isPresetTransitioning]);

  const changedKeys = React.useMemo(() => {
    const base = baselineRef.current;
    if (!base) return [] as string[];
    const cfg = config as unknown as Record<string, unknown>;
    return PARAMETER_CATALOG.filter((e) => cfg[e.key] !== base.snap[e.key]).map((e) => e.key);
  }, [config]);
  const changedInTab = React.useMemo(
    () => PARAMETER_CATALOG.filter((e) => e.tab === activeTab && changedKeys.includes(e.key)).length,
    [activeTab, changedKeys],
  );

  const [sharedView, setSharedView] = React.useState(isSharedView());
  React.useEffect(() => subscribeSharedView(() => setSharedView(isSharedView())), []);

  // Refs keep markChanges referentially stable across config edits, so the
  // structural effect below does not re-run (and re-scan) on every tick.
  const changedKeysRef = React.useRef(changedKeys);
  changedKeysRef.current = changedKeys;
  const changedOnlyRef = React.useRef(changedOnly);
  changedOnlyRef.current = changedOnly;

  const markChanges = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.toggle('mg-changed-only', changedOnlyRef.current);
    const changed = new Set(changedKeysRef.current);
    const candidates = Array.from(root.querySelectorAll('span, div')).map((el) => ({
      el,
      text: (el.textContent || '').trim().toLowerCase(),
    })).filter((c) => c.text.length > 0 && c.text.length <= 60);
    PARAMETER_CATALOG.filter((e) => e.tab === activeTab).forEach((entry) => {
      const label = entry.label.trim().toLowerCase();
      const hit =
        candidates.find((c) => c.text === label || c.text.split('/').map((x) => x.trim()).includes(label)) ||
        candidates.find((c) => c.text.startsWith(label)) ||
        candidates.find((c) => c.text === label.split(' ')[0]);
      if (!hit) return;
      const headerDiv = hit.el.closest('div');
      const row = (headerDiv?.parentElement as HTMLElement | null) || (headerDiv as HTMLElement | null) || (hit.el as HTMLElement);
      const on = changed.has(entry.key);
      row.classList.toggle('mg-dot-on', on);
      row.classList.toggle('mg-dot-off', !on);
      const desc = getParameterDescription(entry.key);
      const note = NOTE_LINK_BY_KEY[entry.key];
      // Phase 4 guard: a catalog tip must never land on (or inside) a
      // segmented Toggle root — that element is a different control and gets
      // its own description from applyControlTips. Loose fallback matches
      // otherwise climb into the toggle (e.g. "Bloom Radius" resolving to
      // the Bloom toggle's label while its sliders are unrendered).
      const inToggle =
        (hit.el as HTMLElement).closest('[data-control-tip-label]') !== null ||
        row.hasAttribute('data-control-tip-label');
      if (!inToggle) {
        if (desc) row.dataset.tip = desc;
        else delete row.dataset.tip;
        if (desc && note) row.dataset.note = note;
        else delete row.dataset.note;
      }
    });
  }, [activeTab]);

  // --- Control tooltips (Renewal Phase 4) ------------------------------------
  // The catalog pass above only covers numeric slider rows. This pass gives
  // the remaining controls — Toggle segmented controls (tagged by the shared
  // component with data-control-tip-label), selects (aria-label config key,
  // else the visible label next to them), and action buttons (exact text
  // match) — a data-tip from lib/controlDescriptions.ts, plus a data-note
  // backlink where the tech guide has a genuinely matching heading. Elements
  // that already carry a catalog tip keep it (catalog wins).
  const applyControlTips = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll('[data-control-tip-label]').forEach((el) => {
      const node = el as HTMLElement;
      if (node.dataset.tip) return;
      const label = node.getAttribute('data-control-tip-label') || '';
      const desc = getControlDescription(label);
      if (!desc) return;
      node.dataset.tip = desc;
      const note = getControlNoteLink(label);
      if (note) node.dataset.note = note;
    });
    root.querySelectorAll('select').forEach((sel) => {
      const node = sel as HTMLSelectElement;
      if (node.dataset.tip) return;
      const aria = node.getAttribute('aria-label') || '';
      if (aria && CONTROL_KEY_DESCRIPTIONS[aria]) {
        node.dataset.tip = CONTROL_KEY_DESCRIPTIONS[aria];
        const note = CONTROL_KEY_NOTE_LINKS[aria];
        if (note) node.dataset.note = note;
        return;
      }
      let label = '';
      let el: HTMLElement | null = node.parentElement;
      for (let i = 0; i < 4 && el && !label; i += 1) {
        const cand = Array.from(el.querySelectorAll('span, div')).filter(
          (c) =>
            (c.className || '').toString().includes('tracking-widest') &&
            (c.textContent || '').trim().length > 0 &&
            (c.textContent || '').trim().length <= 60 &&
            !c.contains(node),
        );
        if (cand.length) label = (cand[0].textContent || '').trim();
        el = el.parentElement;
      }
      if (!label) return;
      const desc = getControlDescription(label);
      if (!desc) return;
      node.dataset.tip = desc;
      const note = getControlNoteLink(label);
      if (note) node.dataset.note = note;
    });
    root.querySelectorAll('button').forEach((btn) => {
      const node = btn as HTMLElement;
      if (node.dataset.tip) return;
      if (node.closest('[data-tip]') || node.closest('[data-control-tip-label]')) return;
      const text = (node.textContent || '').trim();
      if (!text || text.length > 40) return;
      const desc = getControlDescription(text);
      if (!desc) return;
      node.dataset.tip = desc;
      const note = getControlNoteLink(text);
      if (note) node.dataset.note = note;
    });
  }, []);

  // --- Basic (simple) mode ---------------------------------------------------
  // DOM post-processing pass in the same spirit as folds/change-dots: rows
  // whose config key is not in the per-tab primary allowlist are tagged
  // .mg-basic-off and hidden by CSS while the root carries .mg-basic-only.
  // Sections made purely of non-primary catalog rows are hidden whole.
  // Pro mode applies nothing at all (the UI is byte-identical to before).
  const applyDeckMode = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const basic = deckModeRef.current === 'basic' && basicAppliesTo(activeTab);
    root.classList.toggle('mg-basic-only', basic);
    if (!basic) {
      root.querySelectorAll('.mg-basic-off').forEach((el) => el.classList.remove('mg-basic-off'));
      root.querySelectorAll('[data-basic-reveal]').forEach((el) => el.removeAttribute('data-basic-reveal'));
      setBasicHiddenCount(0);
      return;
    }
    const primary = BASIC_PRIMARY_KEYS[activeTab] ?? new Set<string>();
    const candidates = Array.from(root.querySelectorAll('span, div')).map((el) => ({
      el,
      text: (el.textContent || '').trim().toLowerCase(),
    })).filter((c) => c.text.length > 0 && c.text.length <= 60);
    // A catalog row is the SMALLEST ancestor of the label that holds the
    // slider itself: guards against the fuzzy label match climbing into a
    // big container (preset lists, sequence editors) and hiding hundreds
    // of unrelated controls.
    const resolveRow = (hitEl: Element): HTMLElement | null => {
      let el: HTMLElement | null = hitEl as HTMLElement;
      for (let depth = 0; depth < 4 && el; depth += 1) {
        const ranges = el.querySelectorAll('input[type="range"]').length;
        const textLen = (el.textContent || '').trim().length;
        if (ranges >= 1 && ranges <= 3 && textLen <= 90 && !el.querySelector('h3')) return el;
        el = el.parentElement;
      }
      return null;
    };
    let hidden = 0;
    PARAMETER_CATALOG.filter((e) => e.tab === activeTab).forEach((entry) => {
      const label = entry.label.trim().toLowerCase();
      const hit =
        candidates.find((c) => c.text === label || c.text.split('/').map((x) => x.trim()).includes(label)) ||
        candidates.find((c) => c.text.startsWith(label)) ||
        candidates.find((c) => c.text === label.split(' ')[0]);
      if (!hit) return;
      const row = resolveRow(hit.el);
      if (!row) return;
      const off = !primary.has(entry.key);
      row.classList.toggle('mg-basic-off', off);
      row.classList.toggle('mg-basic-on', !off);
      if (off) hidden += 1;
    });
    // Hide sections that contain only non-primary catalog rows (and at
    // least 3 of them, so mixed toggle/editor sections stay reachable).
    // Containers that hold other sections or very many sliders are never
    // hidden whole — the row-level pass already did the fine work there.
    Array.from(root.querySelectorAll('h3')).filter((h) => (h.className || '').includes('tracking-widest')).forEach((h) => {
      const container = (h.closest('section') as HTMLElement | null) || (h.parentElement as HTMLElement | null);
      if (!container || container.hasAttribute('data-basic-reveal')) return;
      if (container.querySelectorAll('h3').length > 1) return;
      if (container.querySelectorAll('input[type="range"]').length > 80) return;
      const offs = container.querySelectorAll('.mg-basic-off').length;
      const ons = container.querySelectorAll('.mg-basic-on').length;
      const pure = offs >= 3 && ons === 0;
      container.classList.toggle('mg-basic-off', pure);
      if (pure) hidden += 1;
    });
    setBasicHiddenCount(hidden);
  }, [activeTab]);

  // --- Readability Phase 4: Japanese dual labels -----------------------------
  // DOM post-processing pass in the same spirit as markChanges/applyDeckMode:
  // every catalog row in the active tab gets a data-jp attribute on its label
  // header carrying a short Japanese gloss (the first sentence of the
  // parameter description). styles.css renders it as a sublabel line under
  // the English label via ::after, so the label's own textContent — which
  // the change-dot, Basic-mode and reveal matchers all read — never changes,
  // and no DOM nodes are added (the MutationObserver below watches childList
  // only, so tagging cannot retrigger itself). Rows whose label cannot be
  // resolved safely keep the English label only. Applies in Basic and Pro.
  // Tab-mapping note: the Ambient Dust rows (ambient* keys) are catalogued
  // under tab 'audio' but render on the Ambient tab, so that tab also scans
  // those entries; without this they could never be tagged.
  const applyDualLabels = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const depthOf = (el: Element) => {
      let d = 0;
      let p: Element | null = el;
      while (p && p !== root) { d += 1; p = p.parentElement; }
      return d;
    };
    const candidates = Array.from(root.querySelectorAll('span, div')).map((el) => ({
      el,
      text: (el.textContent || '').trim().toLowerCase(),
    })).filter((c) => c.text.length > 0 && c.text.length <= 60);
    // Exact label matches grouped per label, deepest element first (the
    // label span itself rather than a wrapper with identical text).
    const exactByLabel = new Map<string, Element[]>();
    candidates.forEach((c) => {
      const list = exactByLabel.get(c.text);
      if (list) list.push(c.el);
      else exactByLabel.set(c.text, [c.el]);
    });
    exactByLabel.forEach((list) => list.sort((a, b) => depthOf(b) - depthOf(a)));
    const consumed = new Set<Element>();
    const claimedTargets = new Set<Element>();
    // Duplicate labels (Opacity, Strength, X…) are told apart by context:
    // the catalog key minus its layer prefix and minus the words already in
    // the English label leaves a hint (Wind, Spin, Metaball, Curl…) that the
    // row's surrounding group/section text usually contains.
    const hintWords = (entry: (typeof PARAMETER_CATALOG)[number]): string[] => {
      const stem = entry.key.replace(/^(layer\d|gpgpu|audio|synth|ambient|screen|post|camera|sdf|interLayer)/, '');
      const words = stem.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ').filter(Boolean);
      const labelWords = new Set(entry.label.toLowerCase().split(/[^a-z]+/).filter(Boolean));
      return words.filter((w) => w.length >= 3 && !labelWords.has(w));
    };
    const contextOf = (el: Element): string => {
      let text = '';
      let p: Element | null = el;
      for (let i = 0; i < 6 && p && p !== root; i += 1) {
        text += ' ' + (p.textContent || '').slice(0, 400);
        p = p.parentElement;
      }
      return text.toLowerCase();
    };
    PARAMETER_CATALOG.filter((e) => e.tab === activeTab
      || (activeTab === 'ambient' && e.tab === 'audio' && e.key.startsWith('ambient'))).forEach((entry) => {
      const desc = getParameterDescription(entry.key);
      if (!desc) return;
      const gloss = desc.split('。')[0].trim();
      if (!gloss) return;
      const label = entry.label.trim().toLowerCase();
      let hitEl: Element | undefined;
      const pool = (exactByLabel.get(label) || []).filter((el) => !consumed.has(el));
      if (pool.length === 1) {
        hitEl = pool[0];
      } else if (pool.length > 1) {
        const hints = hintWords(entry);
        let bestScore = -1;
        pool.forEach((el) => {
          const ctx = contextOf(el);
          const score = hints.reduce((acc, w) => acc + (ctx.includes(w) ? 1 : 0), 0);
          if (score > bestScore) { bestScore = score; hitEl = el; }
        });
      }
      if (!hitEl) {
        const fallback = candidates.find((c) => !consumed.has(c.el) && c.text.split('/').map((x) => x.trim()).includes(label))
          || candidates.find((c) => !consumed.has(c.el) && c.text.startsWith(label));
        hitEl = fallback?.el;
      }
      if (!hitEl) return;
      consumed.add(hitEl);
      const target = (hitEl.closest('div') as HTMLElement | null) || (hitEl.parentElement as HTMLElement | null);
      if (!target || claimedTargets.has(target) || target.hasAttribute('data-jp')) return;
      if (target.classList.contains('mg-h') || target.classList.contains('mg-h2')) return;
      if (target.closest('h3') || target.querySelector('h3')) return;
      if ((target.textContent || '').trim().length > 90) return;
      claimedTargets.add(target);
      target.setAttribute('data-jp', gloss);
      target.setAttribute('data-jp-key', entry.key);
    });
  }, [activeTab]);

  const applyFolds = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const folds = loadFolds();
    const heads = Array.from(root.querySelectorAll('h3')).filter((h) =>
      (h.className || '').includes('tracking-widest'),
    );
    heads.forEach((h, i) => {
      const container = (h.closest('section') as HTMLElement | null) || (h.parentElement as HTMLElement | null);
      if (!container) return;
      h.classList.add('mg-h');
      const keep = Array.from(container.children).find((c) => c === h || c.contains(h));
      if (keep) (keep as HTMLElement).classList.add('mg-keep');
      const key = activeTab + '|' + (h.textContent || '').trim();
      const open = key in folds ? folds[key] : i === 0;
      container.classList.toggle('mg-fold', !open);
      container.dataset.foldKey = key;
    });
    // Level-2 folding: titled sub-blocks inside each section —
    // (a) bordered rounded boxes with a title first child (Deterministic Render,
    //     Coverage Completion, post-stack boxes, deck boxes),
    // (b) grid axis groups whose first child is a col-span label (Wind / Bias…),
    // (c) border-t blocks with an uppercase label header (Nearby Connections…).
    const markSub = (container: HTMLElement, titleEl: HTMLElement, keepEl: HTMLElement, subKey: string, indexInSection: number) => {
      titleEl.classList.add('mg-h2');
      keepEl.classList.add('mg-keep2');
      const open = subKey in folds ? folds[subKey] : indexInSection === 0;
      container.classList.toggle('mg-fold2', !open);
      container.dataset.foldKey2 = subKey;
    };
    heads.forEach((h) => {
      const section = (h.closest('section') as HTMLElement | null) || (h.parentElement as HTMLElement | null);
      if (!section) return;
      const sectionTitle = (h.textContent || '').trim();
      const claimed = new Set<HTMLElement>();
      let subIndex = 0;
      const candidates: { container: HTMLElement; titleEl: HTMLElement; keepEl: HTMLElement; title: string }[] = [];
      // (a) bordered rounded boxes
      Array.from(section.querySelectorAll('div')).forEach((box) => {
        const cls = (box.className || '').toString();
        if (!cls.includes('rounded-xl') || !cls.includes('border')) return;
        if (cls.includes('absolute')) return; // node-graph cards etc. keep their layout
        if (box.children.length < 2) return;
        const first = box.children[0] as HTMLElement;
        if (['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'CANVAS'].includes(first.tagName)) return;
        const title = (first.textContent || '').trim();
        if (!title || title.length > 60) return;
        candidates.push({ container: box, titleEl: first, keepEl: first, title });
      });
      // (b) grid axis groups
      Array.from(section.querySelectorAll('div')).forEach((label) => {
        const cls = (label.className || '').toString();
        if (!cls.includes('col-span') || !cls.includes('tracking-widest')) return;
        const grid = label.parentElement as HTMLElement | null;
        if (!grid || !(grid.className || '').toString().includes('grid') || grid.children.length < 3) return;
        const title = (label.textContent || '').trim();
        if (!title || title.length > 40) return;
        candidates.push({ container: grid, titleEl: label, keepEl: label, title });
      });
      // (c) border-t blocks
      Array.from(section.querySelectorAll('div')).forEach((block) => {
        const cls = (block.className || '').toString();
        if (!cls.includes('border-t')) return;
        const header = Array.from(block.children).find((c) => {
          const cc = (c.className || '').toString();
          const t = (c.textContent || '').trim();
          return (cc.includes('tracking-widest') || cc.includes('uppercase')) && t.length > 0 && t.length <= 60;
        }) as HTMLElement | undefined;
        if (!header || block.children.length < 2) return;
        candidates.push({ container: block, titleEl: header, keepEl: header, title: (header.textContent || '').trim() });
      });
      candidates
        .filter((c) => {
          // outermost wins; skip anything inside an already-claimed container
          let el: HTMLElement | null = c.container;
          while (el && el !== section) {
            if (claimed.has(el)) return false;
            el = el.parentElement;
          }
          claimed.add(c.container);
          return true;
        })
        .forEach((c) => {
          markSub(c.container, c.titleEl, c.keepEl, activeTab + '|' + sectionTitle + '|' + c.title, subIndex);
          subIndex += 1;
        });
    });
  }, [activeTab]);

  const pendingReveal = React.useRef<{ label: string; tab: string } | null>(null);

  const tryReveal = React.useCallback(() => {
    if (!pendingReveal.current) {
      const stash = (window as unknown as { __mgPendingReveal?: { label: string; tab: string; at: number } }).__mgPendingReveal;
      if (stash && Date.now() - stash.at < 10000) {
        pendingReveal.current = { label: stash.label, tab: stash.tab };
      }
    }
    const pending = pendingReveal.current;
    const root = rootRef.current;
    if (!pending || !root) return;
    if (pending.tab !== activeTab) return;
    const label = pending.label.trim().toLowerCase();
    const spans = Array.from(root.querySelectorAll('span, div'));
    const matches = (sp: Element) => {
      const t = (sp.textContent || '').trim().toLowerCase();
      if (!t || t.length > 60) return false;
      return t === label || t.split('/').map((x) => x.trim()).includes(label);
    };
    const hit = spans.find(matches) || spans.find((sp) => {
      const t = (sp.textContent || '').trim().toLowerCase();
      return t.length > 0 && t.length <= 60 && t.startsWith(label);
    }) || spans.find((sp) => {
      // Many sliders render only while their feature toggle is on; fall back to
      // the toggle itself (label's head word, e.g. "Bloom" for "Bloom Intensity").
      const t = (sp.textContent || '').trim().toLowerCase();
      const head = label.split(' ')[0];
      return head.length >= 3 && t === head;
    });
    if (!hit) return;
    const headerDiv = hit.closest('div');
    const row = (headerDiv?.parentElement as HTMLElement | null) || (headerDiv as HTMLElement | null) || (hit as HTMLElement);
    // Unfold every folded ancestor and persist the open state so applyFolds keeps it open.
    let el = row as HTMLElement | null;
    while (el && el !== root) {
      if (el.classList.contains('mg-basic-off')) {
        // Search/reveal wins over Basic hiding for this visit: mark the
        // ancestor so applyDeckMode leaves it visible.
        el.classList.remove('mg-basic-off');
        el.setAttribute('data-basic-reveal', '1');
      }
      if (el.classList.contains('mg-fold') || el.classList.contains('mg-fold2')) {
        el.classList.remove('mg-fold');
        el.classList.remove('mg-fold2');
        const k = el.dataset.foldKey || el.dataset.foldKey2;
        if (k) {
          const folds = loadFolds();
          folds[k] = true;
          try {
            localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(folds));
          } catch {
            /* storage unavailable */
          }
        }
      }
      el = el.parentElement;
    }
    pendingReveal.current = null;
    (window as unknown as { __mgPendingReveal?: unknown }).__mgPendingReveal = undefined;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('mg-flash');
    window.setTimeout(() => row.classList.remove('mg-flash'), 1900);
  }, [activeTab]);

  React.useEffect(() => {
    const onReveal = (e: Event) => {
      const d = (e as CustomEvent).detail as { label: string; tab: string };
      if (!d || !d.label) return;
      pendingReveal.current = { label: d.label, tab: d.tab };
      tryReveal();
      [200, 500, 1000, 1800, 2800].forEach((ms) => window.setTimeout(() => tryReveal(), ms));
    };
    window.addEventListener('kalokagathia:reveal-setting', onReveal);
    return () => window.removeEventListener('kalokagathia:reveal-setting', onReveal);
  }, [tryReveal]);

  React.useEffect(() => {
    applyFolds();
    tryReveal();
    markChanges();
    applyDeckMode();
    applyDualLabels();
    applyControlTips();
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const obs = new MutationObserver((records) => {
      // Structural work is only needed when nodes were ADDED (sections or
      // rows mounting late). Removal-only or text churn must not retrigger
      // the full scans; bursts are coalesced into one pass per frame.
      if (!records.some((r) => r.addedNodes.length > 0)) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyFolds();
        tryReveal();
        markChanges();
        applyDeckMode();
        applyDualLabels();
        applyControlTips();
      });
    });
    obs.observe(root, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [applyFolds, tryReveal, markChanges, applyDeckMode, applyDualLabels, applyControlTips]);

  // Re-apply Basic filtering immediately when the mode flips.
  React.useEffect(() => {
    applyDeckMode();
  }, [deckMode, applyDeckMode]);

  // Change dots follow config edits directly: one coalesced marking pass per
  // frame during slider drags, instead of re-running the structural effect
  // (and its timer tail) on every committed config change.
  const dotRaf = React.useRef(0);
  React.useEffect(() => {
    if (dotRaf.current) cancelAnimationFrame(dotRaf.current);
    dotRaf.current = requestAnimationFrame(() => {
      dotRaf.current = 0;
      markChanges();
    });
    return () => {
      if (dotRaf.current) cancelAnimationFrame(dotRaf.current);
    };
  }, [markChanges, changedKeys, changedOnly]);

  // --- Tooltip (hover descriptions + note backlink, Renewal Phase 4) ---------
  // Flat surface (Noise-token language: #171717 face, radius 12). When the
  // row carries a data-note backlink, the bubble becomes pointer-events:auto
  // and leaving the row starts a ~350ms grace timer instead of hiding at
  // once, so the pointer can travel the gap and click the link; entering the
  // bubble cancels the timer, leaving it hides. Without a link the bubble
  // stays pointer-events:none and behaves exactly as before.
  const [tip, setTip] = React.useState<{ text: string; note?: string; x: number; y: number; below: boolean } | null>(null);
  const tipTimer = React.useRef<number | null>(null);
  const tipHideTimer = React.useRef<number | null>(null);
  const tipRow = React.useRef<HTMLElement | null>(null);
  const tipNoteRef = React.useRef<string | undefined>(undefined);
  const clearTipTimer = () => {
    if (tipTimer.current) {
      window.clearTimeout(tipTimer.current);
      tipTimer.current = null;
    }
  };
  const clearTipHideTimer = () => {
    if (tipHideTimer.current) {
      window.clearTimeout(tipHideTimer.current);
      tipHideTimer.current = null;
    }
  };
  const hideTip = React.useCallback(() => {
    clearTipTimer();
    clearTipHideTimer();
    tipRow.current = null;
    tipNoteRef.current = undefined;
    setTip(null);
  }, []);
  const handleTipOver = (e: React.MouseEvent) => {
    const row = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!row || row === tipRow.current) return;
    clearTipTimer();
    clearTipHideTimer();
    tipRow.current = row;
    const text = row.dataset.tip || '';
    if (!text) return;
    const note = row.dataset.note || undefined;
    tipTimer.current = window.setTimeout(() => {
      if (tipRow.current !== row) return;
      const rect = row.getBoundingClientRect();
      const x = Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150);
      // Keep the bubble inside the viewport: prefer below when there is
      // room, flip above when there is not, and clamp the anchor either way.
      const estH = note ? 88 : 64;
      const fitsBelow = rect.bottom + 8 + estH <= window.innerHeight;
      const fitsAbove = rect.top - 8 - estH >= 0;
      const below = fitsBelow ? true : fitsAbove ? false : rect.top < 110;
      const y = below ? Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - estH - 8)) : rect.top - 8;
      tipNoteRef.current = note;
      setTip({ text, note, x, y, below });
    }, 400);
  };
  const handleTipOut = (e: React.MouseEvent) => {
    const row = tipRow.current;
    if (!row) return;
    const related = e.relatedTarget as Node | null;
    if (related && row.contains(related)) return;
    if ((e.target as HTMLElement).closest('[data-tip]') !== row) return;
    if (tipNoteRef.current) {
      clearTipHideTimer();
      tipHideTimer.current = window.setTimeout(() => hideTip(), 350);
    } else {
      hideTip();
    }
  };

  const handleFoldClick = (e: React.MouseEvent) => {
    const sub = (e.target as HTMLElement).closest('.mg-h2') as HTMLElement | null;
    if (sub) {
      const target = (sub.closest('[data-fold-key2]') as HTMLElement | null) || (sub.parentElement as HTMLElement | null);
      if (!target || !target.dataset.foldKey2) return;
      const nowFolded = target.classList.toggle('mg-fold2');
      const folds = loadFolds();
      folds[target.dataset.foldKey2] = !nowFolded;
      try {
        localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(folds));
      } catch {
        /* storage unavailable */
      }
      return;
    }
    const h = (e.target as HTMLElement).closest('h3.mg-h') as HTMLElement | null;
    if (!h) return;
    const container = (h.closest('section') as HTMLElement | null) || (h.parentElement as HTMLElement | null);
    if (!container) return;
    const nowFolded = container.classList.toggle('mg-fold');
    const key = container.dataset.foldKey;
    if (!key) return;
    const folds = loadFolds();
    folds[key] = !nowFolded;
    try {
      localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(folds));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div ref={rootRef} onClick={handleFoldClick} onMouseOver={handleTipOver} onMouseOut={handleTipOut} onScroll={hideTip} className="mg-content-scroll flex-1 overflow-y-auto px-5 py-5 sm:px-6">
      {tip && createPortal(
        <div
          onMouseEnter={clearTipHideTimer}
          onMouseLeave={hideTip}
          className={`fixed z-[120] w-64 max-w-[80vw] rounded-xl border border-white/15 bg-[#171717] px-3 py-2 text-[11px] leading-relaxed text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.55)] ${
            tip.note ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          style={{
            left: tip.x,
            top: tip.y,
            transform: tip.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          {tip.text}
          {tip.note && (
            <a
              href={`${NOTE_GUIDE_URL}#${tip.note}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 block text-white underline decoration-white/40 underline-offset-2 transition-colors hover:decoration-white"
            >
              noteで詳しく読む →
            </a>
          )}
        </div>, document.body)}
      {isPublicLibrary && (
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] uppercase tracking-[0.24em] text-white/60">
          Public exhibition mode: scene parameters and sequence editing are locked. You can still load, morph, play, and export.
        </div>
      )}
      <div className="mb-4 flex w-full flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const root = rootRef.current;
            if (!root) return;
            const folds = loadFolds();
            Array.from(root.querySelectorAll('h3')).filter((h) => (h.className || '').includes('tracking-widest')).forEach((h) => {
              folds[activeTab + '|' + (h.textContent || '').trim()] = true;
            });
            Array.from(root.querySelectorAll('[data-fold-key2]')).forEach((el) => {
              const k = (el as HTMLElement).dataset.foldKey2;
              if (k) folds[k] = true;
            });
            try { localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(folds)); } catch { /* storage unavailable */ }
            applyFolds();
          }}
          className="rounded-md px-3 py-1.5 text-[10px] tracking-wider text-[#a3a3a3] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          すべて開く
        </button>
        <button
          type="button"
          onClick={() => {
            const root = rootRef.current;
            if (!root) return;
            const folds = loadFolds();
            Array.from(root.querySelectorAll('h3')).filter((h) => (h.className || '').includes('tracking-widest')).forEach((h) => {
              folds[activeTab + '|' + (h.textContent || '').trim()] = false;
            });
            Array.from(root.querySelectorAll('[data-fold-key2]')).forEach((el) => {
              const k = (el as HTMLElement).dataset.foldKey2;
              if (k) folds[k] = false;
            });
            try { localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(folds)); } catch { /* storage unavailable */ }
            applyFolds();
          }}
          className="rounded-md px-3 py-1.5 text-[10px] tracking-wider text-[#a3a3a3] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          すべて閉じる
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setChangedOnly((v) => !v)}
          className={`rounded-md px-3 py-1.5 text-[10px] tracking-wider transition-colors ${
            changedOnly ? 'bg-sky-300/15 text-sky-200' : 'text-[#a3a3a3] hover:bg-white/[0.08] hover:text-white'
          }`}
          title="読み込んだプリセットから変更した項目だけを表示（水色ドットが変更印）"
        >
          変更だけ表示{changedInTab > 0 ? ` (${changedInTab})` : ''}
        </button>
        {deckMode === 'basic' && basicAppliesTo(activeTab) && basicHiddenCount > 0 ? (
          <span className="text-[10px] tracking-wider text-white/45">Basic表示中: {basicHiddenCount} 件の詳細設定を非表示（Pro 詳細で全て表示）</span>
        ) : null}
        {sharedView ? <span className="text-[10px] tracking-wider text-amber-200/80">共有リンクで表示中（AIオフ）</span> : null}
      </div>
      <div className="mg-flow w-full" data-tab={activeTab}>
        {activeTab === 'play' && <PlayTabContent {...props} />}
        {activeTab === 'global' && <GlobalTabContent {...props} />}
        {activeTab === 'layer1' && <Layer1TabContent {...props} />}
        {activeTab === 'layer2' && <Layer2TabContent {...props} />}
        {activeTab === 'layer3' && <Layer3TabContent {...props} />}
        {activeTab === 'ambient' && <AmbientTabContent {...props} />}
        {activeTab === 'audio' && <AudioTabContent {...props} />}
        {activeTab === 'ai' && <AiTabContent {...props} />}
      </div>
    </div>
  );
};
