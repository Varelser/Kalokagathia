import React from 'react';
import { Compass, Dna } from 'lucide-react';
import type { ParticleConfig, PresetRecord } from '../types';
import { TARGET_COMPUTE_BACKENDS, TARGET_MOTION_FAMILIES, TARGET_POST_FAMILIES, TARGET_RENDER_FAMILIES, TARGET_SOLVER_FAMILIES, TARGET_SOURCE_FAMILIES, getCoverageProfile } from '../lib/depictionCoverage';
import { MOTION_GROUPS } from '../lib/motionGrouping';
import { generateOffspring, type BredChild } from '../lib/presetBreeding';
import { sampleCanvasMetrics, scoreChild, type ScreenMetrics } from '../lib/evolutionLab';
import { GRAPH_SOURCE_OPTIONS } from '../lib/graphModel';
import { COVERAGE_BATCH_LIMIT, COVERAGE_MOTIONS, COVERAGE_SOURCES, generateCoverageCandidates, getCoveredSourceMotionPairs, listUncoveredPairs } from '../lib/coverageCompletion';
import { Slider } from './controlPanelParts';
import { SectionTitle } from './controlPanelPlayTabShared';

export type CoverageAxis = {
  label: string;
  gloss: string;
  covered: string[];
  targets: readonly string[];
  note?: string;
};

export const SourceMotionCombos: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  allMotionTypeCount: number;
}> = ({ config, presets, allMotionTypeCount }) => {
  const data = React.useMemo(() => {
    const sourceFrequency = new Map<string, number>();
    const pairs = new Set<string>();
    const absorb = (cfg: ParticleConfig) => {
      const layers = [
        { enabled: cfg.layer2Enabled, source: cfg.layer2Source as string, type: cfg.layer2Type as string },
        { enabled: cfg.layer3Enabled, source: cfg.layer3Source as string, type: cfg.layer3Type as string },
      ];
      layers.forEach(({ enabled, source, type }) => {
        if (!enabled || !source || !type) return;
        sourceFrequency.set(source, (sourceFrequency.get(source) ?? 0) + 1);
        pairs.add(`${source}×${type}`);
      });
    };
    presets.forEach((preset) => absorb(preset.config));
    absorb(config);
    const sources = [...sourceFrequency.entries()].sort((a, b) => b[1] - a[1]).map(([source]) => source);
    return { sources, pairs, sourceFrequency };
  }, [config, presets]);

  // Only enabled layers render anything, so only they get a row. This
  // matters in practice: the most common primary type in the library
  // (flow) sits in 236 layer slots but is enabled in none of them — it is
  // a placeholder for switched-off layers, and an all-dashed row for it
  // would misread as an untried combination.
  const rows = [
    { layer: 'Layer 2', type: config.layer2Type as string, enabled: config.layer2Enabled },
    { layer: 'Layer 3', type: config.layer3Type as string, enabled: config.layer3Enabled },
  ]
    .filter((row) => row.enabled)
    .filter((row, index, list) => list.findIndex((other) => other.type === row.type) === index);

  const theoretical = data.sources.length * allMotionTypeCount;

  return (
    <div className="mt-7 border-t border-white/10 pt-5">
      <div className="flex justify-between text-[10px] uppercase tracking-widest font-medium opacity-70 mb-1.5">
        <span>Source × Motion · 発生源×運動</span>
        <span className="font-mono">
          {data.pairs.size}/{theoretical}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        系統や型が揃っていても、その組み合わせはまだ1割ほどしか試されていません。いま表示中の運動タイプについて、どの発生源と組んだプリセットがあるか（実線）／まだ無いか（破線）を示します。破線はそのまま「次の実験」の候補です。
      </p>
      {rows.length === 0 && (
        <p className="text-[11px] text-white/40 mb-4">
          現在の設定では Layer 2 / Layer 3 が両方とも無効です。有効なレイヤーの運動タイプについて組み合わせを表示します。
        </p>
      )}
      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.layer}>
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">
              {row.layer} · <span className="text-white/80 normal-case tracking-normal">{row.type}</span>
            </p>
            <div className="flex flex-wrap gap-1">
              {data.sources.map((source) =>
                data.pairs.has(`${source}×${row.type}`) ? (
                  <span
                    key={source}
                    className="px-1.5 py-0.5 rounded border border-white/25 bg-white/10 text-[9px] tracking-wide text-white/75"
                  >
                    {source}
                  </span>
                ) : (
                  <span
                    key={source}
                    className="px-1.5 py-0.5 rounded border border-dashed border-white/20 text-[9px] tracking-wide text-white/40"
                  >
                    {source}
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-white/35 mt-4">
        使用頻度が最も低い発生源：
        {data.sources
          .slice(-4)
          .map((source) => `${source}（${data.sourceFrequency.get(source) ?? 0}）`)
          .join('、')}
      </p>
    </div>
  );
};

export const ExpressionMap: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  isPublicLibrary?: boolean;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ config, presets, isPublicLibrary, onSaveBredPreset }) => {
  const axes = React.useMemo<CoverageAxis[]>(() => {
    const unions = {
      motionFamilies: new Set<string>(),
      sourceFamilies: new Set<string>(),
      renderFamilies: new Set<string>(),
      postFamilies: new Set<string>(),
      computeBackends: new Set<string>(),
      solverFamilies: new Set<string>(),
    };
    const absorb = (cfg: ParticleConfig) => {
      const profile = getCoverageProfile(cfg);
      (Object.keys(unions) as (keyof typeof unions)[]).forEach((key) => {
        profile[key].forEach((entry) => unions[key].add(entry));
      });
    };
    presets.forEach((preset) => absorb(preset.config));
    absorb(config);
    const usedMotionTypes = new Set<string>();
    const absorbTypes = (cfg: ParticleConfig) => {
      usedMotionTypes.add(cfg.layer2Type);
      usedMotionTypes.add(cfg.layer3Type);
      cfg.layer2Motions.forEach((motion) => usedMotionTypes.add(motion));
      cfg.layer3Motions.forEach((motion) => usedMotionTypes.add(motion));
    };
    presets.forEach((preset) => absorbTypes(preset.config));
    absorbTypes(config);
    const allMotionTypes = MOTION_GROUPS.flatMap((group) => group.ids as unknown as string[]);
    return [
      { label: 'Motion Types', gloss: '運動の型', covered: [...usedMotionTypes], targets: allMotionTypes },
      { label: 'Motion', gloss: '運動系統', covered: [...unions.motionFamilies], targets: TARGET_MOTION_FAMILIES },
      { label: 'Sources', gloss: '発生源', covered: [...unions.sourceFamilies], targets: TARGET_SOURCE_FAMILIES },
      { label: 'Rendering', gloss: '描画', covered: [...unions.renderFamilies], targets: TARGET_RENDER_FAMILIES },
      { label: 'Post FX', gloss: '画面効果', covered: [...unions.postFamilies], targets: TARGET_POST_FAMILIES },
      { label: 'Compute', gloss: '計算', covered: [...unions.computeBackends], targets: TARGET_COMPUTE_BACKENDS },
      {
        label: 'Solvers',
        gloss: '物理',
        covered: [...unions.solverFamilies],
        targets: TARGET_SOLVER_FAMILIES,
        note: 'pbd-solver / mpm-material / destruction-fracture は、物理ソルバーそのものではなく、シェーダーモード（布・粘性・破砕などの見た目）による分類です。',
      },
    ];
  }, [config, presets]);

  return (
    <section>
      <SectionTitle icon={<Compass size={12} />}>Expression Map · 表現マップ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-5">
        ライブラリ全体（現在の設定を含む）が、表現の各系統をどこまで踏んでいるかの地図です。系統レベルはほぼ飽和していますが、「運動の型」レベルにはまだプリセット未使用の型が残っています。破線チップが未踏の領域です。
      </p>
      <div className="space-y-5">
        {axes.map((axis) => {
          const coveredCount = axis.targets.filter((target) => axis.covered.includes(target)).length;
          const gaps = axis.targets.filter((target) => !axis.covered.includes(target));
          const ratio = axis.targets.length === 0 ? 0 : coveredCount / axis.targets.length;
          return (
            <div key={axis.label}>
              <div className="flex justify-between text-[10px] uppercase tracking-widest font-medium opacity-70 mb-1.5">
                <span>
                  {axis.label} · {axis.gloss}
                </span>
                <span className="font-mono">
                  {coveredCount}/{axis.targets.length}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2">
                <div className="h-full rounded-full bg-white/70" style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
              {gaps.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {gaps.slice(0, 10).map((gap) => (
                    <span
                      key={gap}
                      className="px-1.5 py-0.5 rounded border border-dashed border-white/20 text-[9px] tracking-wide text-white/40"
                    >
                      {gap}
                    </span>
                  ))}
                  {gaps.length > 10 && (
                    <span className="px-1.5 py-0.5 text-[9px] text-white/35">+{gaps.length - 10} more</span>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-white/40">Fully covered by the current library.</p>
              )}
              {axis.note && <p className="text-[10px] leading-relaxed text-white/35 mt-1.5">{axis.note}</p>}
            </div>
          );
        })}
      </div>
      <SourceMotionCombos config={config} presets={presets} allMotionTypeCount={axes[0]?.targets.length ?? 0} />
      <CoverageGenerator
        config={config}
        presets={presets}
        isPublicLibrary={isPublicLibrary}
        onSaveBredPreset={onSaveBredPreset}
      />
    </section>
  );
};

export const CoverageGenerator: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  isPublicLibrary?: boolean;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ config, presets, isPublicLibrary, onSaveBredPreset }) => {
  const [axis, setAxis] = React.useState<'motion' | 'source'>('motion');
  const [motion, setMotion] = React.useState<string>(COVERAGE_MOTIONS[0]);
  const [source, setSource] = React.useState<string>(COVERAGE_SOURCES[0]);
  const [message, setMessage] = React.useState('');

  const covered = React.useMemo(
    () => getCoveredSourceMotionPairs(presets, config),
    [presets, config],
  );
  const totalPairs = COVERAGE_SOURCES.length * COVERAGE_MOTIONS.length;
  const request = React.useMemo(
    () => ({ axis, value: axis === 'motion' ? motion : source }),
    [axis, motion, source],
  );
  const uncovered = React.useMemo(
    () => listUncoveredPairs(covered, request),
    [covered, request],
  );
  const batchCount = Math.min(uncovered.length, COVERAGE_BATCH_LIMIT);

  const generate = () => {
    if (!onSaveBredPreset) return;
    const candidates = generateCoverageCandidates(presets, config, request);
    candidates.forEach((candidate) => onSaveBredPreset(candidate.config, candidate.name));
    setMessage(
      candidates.length > 0
        ? `${candidates.length} 件のプリセットを追加しました（${request.value} の未踏ペア ${uncovered.length} 件中）。カバー率は ${covered.size} → ${covered.size + candidates.length} / ${totalPairs} ペア相当です。`
        : '生成できる未踏ペアがありませんでした。',
    );
  };

  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
      <p className="text-[11px] font-semibold tracking-wide">Coverage Completion · カバレッジ補完</p>
      <p className="text-[11px] leading-relaxed text-white/45">
        未踏の「発生源 × 運動」ペアを埋めるプリセットを自動生成してライブラリに追加します。その運動を使っている既存プリセットを土台に発生源だけを差し替える（無ければ逆）ので、調整済みの動きのまま新しい組み合わせを試せます。1回で最大 {COVERAGE_BATCH_LIMIT} 件まで。
      </p>
      <div className="flex items-center gap-2">
        {(['motion', 'source'] as const).map((option) => (
          <button
            key={option}
            onClick={() => setAxis(option)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold ${axis === option ? 'bg-white text-black' : 'bg-white/10 text-white/60'}`}
          >
            {option === 'motion' ? '運動から' : '発生源から'}
          </button>
        ))}
        {axis === 'motion' ? (
          <select
            value={motion}
            onChange={(event) => setMotion(event.target.value)}
            className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs outline-none focus:border-white/40"
          >
            {COVERAGE_MOTIONS.map((id) => (
              <option key={id} value={id} className="bg-neutral-900">{id}</option>
            ))}
          </select>
        ) : (
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs outline-none focus:border-white/40"
          >
            {GRAPH_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="bg-neutral-900">{option.label}</option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={generate}
          disabled={isPublicLibrary || !onSaveBredPreset || batchCount === 0}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
        >
          未踏ペアを生成して追加（{batchCount}件）
        </button>
        <span className="font-mono text-[10px] text-white/40">
          covered {covered.size}/{totalPairs}
        </span>
      </div>
      {uncovered.length === 0 && (
        <p className="text-[11px] text-white/50">この{axis === 'motion' ? '運動' : '発生源'}のペアはすべて踏破済みです。</p>
      )}
      {isPublicLibrary && (
        <p className="text-[11px] text-white/50">公開ライブラリは読み取り専用のため生成できません。</p>
      )}
      {message && <p className="text-[11px] text-white/55">{message}</p>}
    </div>
  );
};

export type ParentOption = { key: string; name: string; config: ParticleConfig };

export const BreedingSection: React.FC<{
  presets: PresetRecord[];
  config: ParticleConfig;
  isPublicLibrary: boolean;
  onApplyConfig?: (config: ParticleConfig) => void;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ presets, config, isPublicLibrary, onApplyConfig, onSaveBredPreset }) => {
  const [bredParents, setBredParents] = React.useState<ParentOption[]>([]);
  const [parentAKey, setParentAKey] = React.useState<string>('');
  const [parentBKey, setParentBKey] = React.useState<string>('');
  const [mutationScale, setMutationScale] = React.useState(1);
  const [children, setChildren] = React.useState<(BredChild & { key: string })[]>([]);
  const [savedKeys, setSavedKeys] = React.useState<Set<string>>(new Set());
  const [generation, setGeneration] = React.useState(0);
  // Evolution lab: batch size, real canvas screening results, culling.
  const [batchSize, setBatchSize] = React.useState(6);
  const [screenResults, setScreenResults] = React.useState<Record<string, ScreenMetrics>>({});
  const [screening, setScreening] = React.useState(false);
  const [labNote, setLabNote] = React.useState('');
  const screenAbort = React.useRef(0);

  const options = React.useMemo<ParentOption[]>(
    () => [
      ...bredParents,
      ...presets.map((preset) => ({ key: `preset:${preset.id}`, name: preset.name, config: preset.config })),
    ],
    [bredParents, presets],
  );

  React.useEffect(() => {
    if (options.length >= 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- repairs the parent selection when the option list changes (selected preset removed or list shrank); the selection must stay valid.
      if (!options.some((option) => option.key === parentAKey)) setParentAKey(options[0].key);
      if (!options.some((option) => option.key === parentBKey)) setParentBKey(options[1].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const parentA = options.find((option) => option.key === parentAKey) ?? options[0];
  const parentB = options.find((option) => option.key === parentBKey) ?? options[1];

  const handleBreed = () => {
    if (!parentA || !parentB || parentA.key === parentB.key) return;
    const batches = Math.max(1, Math.round(batchSize / 6));
    const all: (BredChild & { key: string })[] = [];
    for (let b = 0; b < batches; b += 1) {
      const seed = ((Date.now() & 0xffffff) ^ (generation * 7919) ^ (b * 104729)) >>> 0;
      const offspring = generateOffspring(parentA.name, parentA.config, parentB.name, parentB.config, seed, mutationScale);
      offspring.forEach((child, index) => all.push({ ...child, key: `gen${generation}b${b}-${index}` }));
    }
    setChildren(all);
    setScreenResults({});
    setLabNote('');
    setGeneration((value) => value + 1);
  };

  // Real screening: apply each child briefly, sample the live canvas
  // (lit% / mean luminance), then restore the config the user had.
  const handleScreen = async () => {
    if (!onApplyConfig || children.length === 0 || screening) return;
    const runId = screenAbort.current + 1;
    screenAbort.current = runId;
    setScreening(true);
    const original = config;
    const results: Record<string, ScreenMetrics> = {};
    try {
      for (const child of children) {
        if (screenAbort.current !== runId) break;
        onApplyConfig(child.config);
        await new Promise((resolve) => window.setTimeout(resolve, 800));
        if (screenAbort.current !== runId) break;
        const metrics = sampleCanvasMetrics();
        if (metrics) results[child.key] = metrics;
      }
    } finally {
      if (screenAbort.current === runId) {
        onApplyConfig(original);
        setScreenResults(results);
        setLabNote(`スクリーニング完了: ${Object.keys(results).length} 件を実測しました`);
      }
      setScreening(false);
    }
  };

  const rankOf = (child: BredChild & { key: string }): number => {
    const screened = screenResults[child.key];
    if (screened) return screened.litPct * 2 + screened.meanLum * 0.2;
    return scoreChild(child.config).score;
  };

  const handleCull = () => {
    if (children.length <= 2) return;
    const ranked = [...children].sort((a, b) => rankOf(b) - rankOf(a));
    const keep = ranked.slice(0, Math.max(2, Math.ceil(ranked.length / 2)));
    setChildren(keep);
    setLabNote(`淘汰: ${ranked.length} 件 → ${keep.length} 件（${Object.keys(screenResults).length > 0 ? '実測' : '適応度推定'}の上位を残しました）`);
  };

  const handleAdoptTop = () => {
    if (children.length === 0) return;
    const ranked = [...children].sort((a, b) => rankOf(b) - rankOf(a));
    if (ranked[0]) adoptAsParent(ranked[0], 'A');
    if (ranked[1] && ranked[1].key !== ranked[0]?.key) adoptAsParent(ranked[1], 'B');
    setLabNote('最上位2件を次世代の親にセットしました');
  };

  const adoptAsParent = (child: BredChild & { key: string }, slot: 'A' | 'B') => {
    const option: ParentOption = { key: `bred:${child.key}:${child.name}`, name: child.name, config: child.config };
    setBredParents((prev) => (prev.some((entry) => entry.key === option.key) ? prev : [option, ...prev]));
    if (slot === 'A') setParentAKey(option.key);
    else setParentBKey(option.key);
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<Dna size={12} />}>Breeding · 交配と突然変異（進化ラボ）</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        2つのプリセットを親にして、数値の補間と項目ごとの遺伝、それに突然変異で子をまとめて作ります。スクリーニングで各子を実際に描画して明るさを実測し、下位を淘汰して上位を次世代の親にする「進化ラボ」として使えます。気に入った子は保存すれば棚に増えます。
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">Parent A</span>
          <select value={parentA?.key ?? ''} onChange={(event) => setParentAKey(event.target.value)} className={selectClass}>
            {options.map((option) => (
              <option key={option.key} value={option.key} className="bg-neutral-900">
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">Parent B</span>
          <select value={parentB?.key ?? ''} onChange={(event) => setParentBKey(event.target.value)} className={selectClass}>
            {options.map((option) => (
              <option key={option.key} value={option.key} className="bg-neutral-900">
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Slider label="Mutation Scale · 変異の強さ" value={mutationScale} min={0} max={2} step={0.1} onChange={setMutationScale} />
      <label className="block mb-3">
        <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">Batch · 子の数</span>
        <select data-testid="evo-batch" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} className={selectClass}>
          <option value={6} className="bg-neutral-900">6</option>
          <option value={12} className="bg-neutral-900">12</option>
          <option value={18} className="bg-neutral-900">18</option>
        </select>
      </label>
      <button
        onClick={handleBreed}
        disabled={!parentA || !parentB || parentA.key === parentB.key || screening}
        className="w-full py-2.5 text-[11px] font-bold uppercase tracking-wider rounded bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Breed · 交配する
      </button>
      {children.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="evo-screen"
            onClick={handleScreen}
            disabled={screening || !onApplyConfig}
            className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {screening ? 'スクリーニング中…' : 'スクリーニング（実測）'}
          </button>
          <button
            type="button"
            data-testid="evo-cull"
            onClick={handleCull}
            disabled={screening || children.length <= 2}
            className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            下位半分を淘汰
          </button>
          <button
            type="button"
            data-testid="evo-adopt-top"
            onClick={handleAdoptTop}
            disabled={screening}
            className="rounded border border-white/20 px-3 py-1.5 text-[10px] tracking-wider text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            最上位2件を次世代の親に
          </button>
          {labNote ? <span className="w-full text-[10px] text-emerald-300/90" data-testid="evo-note">{labNote}</span> : null}
        </div>
      )}
      {children.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-4">
          {children.map((child) => {
            const isSaved = savedKeys.has(child.key);
            return (
              <div key={child.key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="text-xs font-semibold tracking-wide leading-snug">{child.name}</div>
                <div className="mt-1 text-[9px] uppercase tracking-widest text-white/35">
                  blend {Math.round(child.spec.t * 100)}% · mutation {Math.round(child.spec.mutation * mutationScale * 100)}%
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-widest text-white/35">
                  {child.config.layer2Type} / {child.config.layer3Type}
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-widest text-white/35">
                  適応度 {scoreChild(child.config).score}
                  {screenResults[child.key]
                    ? ` · 実測 lit ${screenResults[child.key].litPct}% / 輝度 ${screenResults[child.key].meanLum}`
                    : ''}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1">
                  <button
                    onClick={() => onApplyConfig?.(child.config)}
                    className="py-1.5 text-[9px] font-bold uppercase rounded border border-white/20 hover:bg-white/10"
                  >
                    試す
                  </button>
                  <button
                    onClick={() => adoptAsParent(child, 'A')}
                    className="py-1.5 text-[9px] font-bold uppercase rounded border border-white/20 hover:bg-white/10"
                  >
                    親A
                  </button>
                  <button
                    onClick={() => adoptAsParent(child, 'B')}
                    className="py-1.5 text-[9px] font-bold uppercase rounded border border-white/20 hover:bg-white/10"
                  >
                    親B
                  </button>
                  <button
                    onClick={() => {
                      onSaveBredPreset?.(child.config, child.name);
                      setSavedKeys((prev) => new Set(prev).add(child.key));
                    }}
                    disabled={isPublicLibrary || isSaved || !onSaveBredPreset}
                    className="py-1.5 text-[9px] font-bold uppercase rounded bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {isSaved ? '保存済' : '保存'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {isPublicLibrary && (
        <p className="mt-3 text-[10px] text-white/40">Public build では保存できません（試す・交配は可能です）。</p>
      )}
    </section>
  );
};

