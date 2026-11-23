import React from 'react';

import type { ParticleConfig } from '../types';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

import { Slider, Toggle } from './controlPanelParts';
import { MorphObjImportBlock, MorphSvgImportBlock, ObjMeshBlock, TerrainTextureImageBlock } from './controlPanelGlobalDisplayGpgpuForcesImportBlocks';
import { TerrainDerivedMapsBlock } from './controlPanelGlobalDisplayGpgpuForcesMapBlocks';
import { getMeshSdfBakeStatus } from '../lib/meshSdfCollider';
import {
  buildFragmentCollection,
  fragmentSignatureDiffs,
  getPublishedFragmentBake,
  parseFragmentCollection,
  serializeFragmentCollection,
  type FragmentCollectionSignature,
  type FragmentSignatureField,
} from '../lib/fragmentCollection';
import { clampFractureCells } from '../lib/voronoiFracture';
import { PcgGraphEditorBlock } from './controlPanelPcgGraphEditor';

// Mesh SDF bake status (Phase BY): the bake runs async on the
// CPU; this line polls while it is in flight so the user can see
// when the collider becomes live (or why it was refused).
const MeshSdfBakeStatusLine: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const [, setTick] = React.useState(0);
  const status = getMeshSdfBakeStatus(config);
  React.useEffect(() => {
    if (status.state !== 'baking') return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [status.state]);
  let text: string;
  if (status.state === 'ready') {
    text = `ベイク完了（${status.resolution}³・${status.format === 'r16f' ? 'R16F' : 'Float32'}・${status.triangleCount} 三角形）。モーフ配置（中心・スケール）の位置で衝突します。`;
    if (status.minFeatureVoxels < 1.5) {
      text += ` ※ 最薄部が約 ${status.minFeatureVoxels.toFixed(1)} ボクセルしかなく、解像度不足の可能性があります。`;
    }
  } else if (status.state === 'baking') {
    text = `ベイク中… ${Math.round(status.progress * 100)}%（完了するまでコライダは無効です）`;
  } else if (status.state === 'refused') {
    text = status.reason === 'not-closed'
      ? '開いたメッシュのためベイクできません（符号付き距離には閉じたメッシュが必要です）。従来のコライダのまま動作します。'
      : status.reason === 'degenerate'
        ? '退化したメッシュ（体積ゼロ）のためベイクできません。従来のコライダのまま動作します。'
        : 'OBJ を読み取れないためベイクできません。';
  } else if (status.state === 'no-source') {
    text = 'Morph の OBJ Source を取り込むと距離場を焼きます（閉じたメッシュのみ）。';
  } else {
    text = '';
  }
  if (!text) return null;
  return <div className="mt-1 text-[9px] leading-relaxed text-white/40">{text}</div>;
};

const FRAGMENT_SIGNATURE_FIELD_LABELS: Record<FragmentSignatureField, string> = {
  sourceTarget: 'モーフ目標',
  particleCount: '粒子数',
  cells: 'セル数',
  fractureSeed: '分割シード',
  gap: '分離量',
};

// Fragment collection (Phase 17 stage 4): save the CURRENT bake's
// fracture division as a named asset in the config key, and show
// how a saved collection compares with the current conditions.
// The bake's cell table reaches the panel only through the
// runtime's publication (lib/fragmentCollection.ts) — it exists
// while the rigid solver path produced cell data. A saved
// collection is compared, never silently applied: restoration of
// the assignment into a bake is not wired in this stage, so what
// is stored is the asset (signature + assignment + clusters) and
// the explicit match / mismatch report below.
const FragmentCollectionBlock: React.FC<{ config: ParticleConfig; updateConfig: GlobalDisplayEffectsSharedProps['updateConfig'] }> = ({ config, updateConfig }) => {
  const [, setTick] = React.useState(0);
  const [notice, setNotice] = React.useState('');
  // The published bake changes outside React; poll lightly so the
  // availability / match lines follow re-bakes.
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const savedJson = config.gpgpuFragmentCollectionJson;
  const saved = parseFragmentCollection(savedJson);
  const bake = getPublishedFragmentBake();
  // Conditions derivable from config alone (particle count is not
  // one of them — it comes from the published bake's signature).
  const configSignature: FragmentCollectionSignature = {
    sourceTarget: config.gpgpuMorphTarget,
    particleCount: bake?.signature.particleCount ?? 0,
    cells: clampFractureCells(config.gpgpuMorphFractureCells),
    fractureSeed: Number.isFinite(config.gpgpuMorphFractureSeed) ? Math.round(config.gpgpuMorphFractureSeed) : 1,
    gap: config.gpgpuMorphFractureEnabled ? config.gpgpuMorphFractureGap : 0,
  };
  let matchLine = '';
  if (saved) {
    if (bake) {
      const diffs = fragmentSignatureDiffs(saved.signature, bake.signature);
      matchLine = diffs.length === 0
        ? '現在のベイク条件と一致しています。'
        : `現在のベイク条件と一致しません（${diffs.map((d) => FRAGMENT_SIGNATURE_FIELD_LABELS[d]).join('・')}）。保存済みの分割は適用されません。`;
    } else {
      const partial = fragmentSignatureDiffs(saved.signature, configSignature)
        .filter((d) => d !== 'particleCount');
      matchLine = partial.length === 0
        ? '設定値（目標・セル数・シード・分離量）とは一致しています。粒子数はベイク未取得のため未照合です。'
        : `設定値と一致しません（${partial.map((d) => FRAGMENT_SIGNATURE_FIELD_LABELS[d]).join('・')}）。保存済みの分割は適用されません。`;
    }
  }
  const handleSave = () => {
    const current = getPublishedFragmentBake();
    if (!current) {
      setNotice('現在のベイクのセル表がまだありません。剛体ソルバ（Rigid Bodies）を On にしてベイクが走ると、その分割を保存できます。');
      return;
    }
    const collection = buildFragmentCollection(current.cellData, {
      name: `破片 ${current.signature.sourceTarget} ${current.signature.particleCount}点 ${current.cellData.bodyCount}片`,
      signature: current.signature,
    });
    const text = serializeFragmentCollection(collection);
    if (!text) {
      setNotice('コレクションが大きすぎて保存できませんでした。');
      return;
    }
    updateConfig('gpgpuFragmentCollectionJson', text);
    setNotice(`保存しました（${collection.bodyCount} 破片・${collection.clusters.length} クラスタ・${text.length.toLocaleString()} 文字）。`);
  };
  return (
    <>
      <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Fragment Collection （破片コレクション）</div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSave}
          className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10"
        >
          現在の分割を保存
        </button>
        {savedJson && (
          <button
            onClick={() => { updateConfig('gpgpuFragmentCollectionJson', ''); setNotice('保存済みコレクションを消去しました。'); }}
            className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10"
          >
            消去
          </button>
        )}
      </div>
      {saved && (
        <div className="mt-1 text-[9px] leading-relaxed text-white/40">
          保存済み: {saved.name} — {saved.bodyCount} 破片・{saved.clusters.length} クラスタ・{saved.signature.particleCount.toLocaleString()} 点・{(savedJson.length / 1024).toFixed(1)} KB。{matchLine}
        </div>
      )}
      {!saved && savedJson && (
        <div className="mt-1 text-[9px] leading-relaxed text-white/40">
          保存済みコレクションを読み取れませんでした（データが壊れている可能性があります）。分割は適用されません。
        </div>
      )}
      {!saved && !savedJson && (
        <div className="mt-1 text-[9px] leading-relaxed text-white/40">
          {bake
            ? `現在のベイクの分割（${bake.cellData.bodyCount} 破片）を資産として保存できます。`
            : '剛体ソルバ（Rigid Bodies）が On のベイクでセル表が作られると、その分割を資産として保存できます。'}
        </div>
      )}
      {notice && <div className="mt-1 text-[9px] leading-relaxed text-white/60">{notice}</div>}
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        保存されるのは分割そのもの（署名・セル割当・接着クラスタ）で、剛体の落下後の状態は含みません。保存済み分割のベイクへの復元適用は本段階では行わず、条件の照合までです。
      </div>
    </>
  );
};

export const GlobalDisplayGpgpuForcesMorphSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    {/* Morph Targets (Kinetix integration B1a) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Morph Targets" value={config.gpgpuMorphEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphEnabled', v)} />
      {config.gpgpuMorphEnabled && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Target Shape</div>
          <select
            value={config.gpgpuMorphTarget}
            onChange={(e) => updateConfig('gpgpuMorphTarget', e.target.value as typeof config.gpgpuMorphTarget)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="trefoil">Trefoil (三つ葉結び)</option>
            <option value="torusKnot">Torus Knot (3,5)</option>
            <option value="galaxy">Galaxy (渦巻銀河)</option>
            <option value="mobius">Möbius (メビウス帯)</option>
            <option value="geodesic">Geodesic (測地ドーム)</option>
            <option value="crown">Crown (王冠)</option>
            <option value="blackhole">Black Hole (降着円盤+ジェット)</option>
            <option value="klein">Klein Bottle (クラインの壺)</option>
            <option value="cymatic">Cymatic (球面調和シェル)</option>
            <option value="gyroid">Gyroid (ジャイロイド曲面)</option>
            <option value="dnaRibbon">DNA Ribbon (二重螺旋)</option>
            <option value="hypercube">Hypercube (4次元立方体)</option>
            <option value="mandelbulb">Mandelbulb (点群近似)</option>
            <option value="shell">Shell (オウムガイ)</option>
            <option value="text">Text (レイヤー2のテキストマップ)</option>
            <option value="image">Image (レイヤー2の画像マップ)</option>
            <option value="svg">SVG (取り込んだロゴ/図形)</option>
            <option value="obj">OBJ (取り込んだ3Dメッシュ)</option>
            <option value="terrain">Terrain (地形・フラクタル高度場)</option>
            <option value="data">Data (属性点群 — Phase AK)</option>
            <option value="contour">Contour (輪郭のベクタ線化 — Phase AM)</option>
            <option value="polygon">Polygon (正多角形プレート — Phase AW)</option>
          </select>
          {config.gpgpuMorphTarget === 'polygon' && (
            <>
              <Slider label="Polygon Sides （辺数）" value={config.gpgpuMorphPolygonSides} min={3} max={12} step={1} onChange={(v) => updateConfig('gpgpuMorphPolygonSides', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                正多角形の内側を面積一様に埋める薄いプレートです。辺数3で三角形、12で円に近づきます。
              </div>
            </>
          )}
          {config.gpgpuMorphTarget === 'data' && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              Play タブ → Data Source で登録した属性点群の位置をターゲットにします（未登録の間は球殻にフォールバック）。点群の列は属性（Forces の Attributes 節、Data 源）として粒子へ渡ります。
            </div>
          )}
          {config.gpgpuMorphTarget === 'image' && (
            <>
              <Toggle label="Noise Field Supply （ノイズ場を供給源にする）" value={config.gpgpuMorphNoiseMapEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphNoiseMapEnabled', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                On の間、画像マップの代わりにノイズ場（Forces の Noise Map の設定）の静止断面をベイクの形に使います。ベイクは静止画なので場の時間発展は入りません（発展は表示側の場が担います）。
              </div>
            </>
          )}
          {config.gpgpuMorphTarget === 'contour' && (
            <>
              <Toggle label="Contour Source （輪郭の抽出源）" value={config.gpgpuMorphContourSource} options={[{ label: 'Text', val: 'text' as const }, { label: 'Image', val: 'image' as const }]} onChange={(v) => updateConfig('gpgpuMorphContourSource', v)} />
              <Slider label="Contour Threshold （抽出閾値）" value={config.gpgpuMorphContourThreshold} min={0.02} max={0.98} step={0.01} onChange={(v) => updateConfig('gpgpuMorphContourThreshold', v)} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                抽出源の輝度を閾値で切り取り、輪郭をポリライン化（marching squares）して粒子を線の上に並べます。Text はレイヤー2 TextMap、Image はレイヤー2のメディア輝度マップです。輪郭が取れない（全面が閾値の片側）場合は球殻にフォールバックします。
              </div>
            </>
          )}
          {config.gpgpuMorphTarget === 'svg' && (
            <MorphSvgImportBlock config={config} updateConfig={updateConfig} />
          )}
          {config.gpgpuMorphTarget === 'svg' && (
            <>
              <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Path （パス沿い配置）</div>
              <Toggle label="Mode" value={config.gpgpuMorphPathMode} options={[{ label: 'Off', val: 'off' as const }, { label: 'Along', val: 'along' as const }, { label: 'Write-on', val: 'writeOn' as const }, { label: 'Stamp', val: 'stamp' as const }]} onChange={(v) => updateConfig('gpgpuMorphPathMode', v)} />
              {config.gpgpuMorphPathMode !== 'off' && (
                <>
                  <Toggle label="Subpaths （サブパス配分）" value={config.gpgpuMorphPathSubpathMode} options={[{ label: 'Proportional', val: 'proportional' as const }, { label: 'Even', val: 'even' as const }, { label: 'First', val: 'first' as const }]} onChange={(v) => updateConfig('gpgpuMorphPathSubpathMode', v)} />
                  {config.gpgpuMorphPathMode === 'stamp' && (
                    <>
                      <Toggle label="Stamp Shape （スタンプ形状）" value={config.gpgpuMorphStampShape} options={[{ label: 'Disc', val: 'disc' as const }, { label: 'Ring', val: 'ring' as const }, { label: 'Star', val: 'star' as const }, { label: 'Diamond', val: 'diamond' as const }, { label: 'OBJ', val: 'obj' as const }]} onChange={(v) => updateConfig('gpgpuMorphStampShape', v)} />
                      <Slider label="Stamp Spacing （間隔・パス割合）" value={config.gpgpuMorphStampSpacing} min={0.02} max={0.5} step={0.005} onChange={(v) => updateConfig('gpgpuMorphStampSpacing', v)} />
                      <Slider label="Stamp Size （大きさ）" value={config.gpgpuMorphStampSize} min={0.02} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphStampSize', v)} />
                      <Toggle label="Stamp Align （接線に整列）" value={config.gpgpuMorphStampAlign} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphStampAlign', v)} />
                      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                        パス上に形状を等間隔（弧長）でスタンプします。OBJ 形状は取り込んだ OBJ の点群をスタンプに使います（OBJ 未取り込み時は Disc で代替）。
                      </div>
                    </>
                  )}
                  {config.gpgpuMorphPathMode === 'writeOn' && (
                    <>
                      <Slider label="Write-On Start （開始・割合）" value={config.gpgpuMorphPathWriteOnStart} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphPathWriteOnStart', v)} />
                      <Slider label="Write-On End （終了・割合）" value={config.gpgpuMorphPathWriteOnEnd} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphPathWriteOnEnd', v)} />
                    </>
                  )}
                  {config.gpgpuMorphPathMode !== 'stamp' && (
                  <Slider label="Taper （テーパー）" value={config.gpgpuMorphPathTaper} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphPathTaper', v)} />
                  )}
                  {config.gpgpuMorphPathTaper > 0 && (
                    <Toggle label="Taper Shape （形状）" value={config.gpgpuMorphPathTaperShape} options={[{ label: 'Linear', val: 'linear' as const }, { label: 'Smooth', val: 'smooth' as const }, { label: 'Bell', val: 'bell' as const }]} onChange={(v) => updateConfig('gpgpuMorphPathTaperShape', v)} />
                  )}
                  <Slider label="Path Offset （パスの平行オフセット・Phase AM）" value={config.gpgpuMorphPathOffset} min={-0.5} max={0.5} step={0.005} onChange={(v) => updateConfig('gpgpuMorphPathOffset', v)} />
                  <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                    パス全体を法線方向へ平行移動します（正＝進行方向の左、閉パスでは外側）。全パスモード共通で、0 で従来同一です。
                  </div>
                  {(config.gpgpuMorphPathMode === 'along' || config.gpgpuMorphPathMode === 'writeOn') && (
                    <>
                      <Toggle label="Text on Path （パス上文字）" value={config.gpgpuMorphTextOnPathEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphTextOnPathEnabled', v)} />
                      {config.gpgpuMorphTextOnPathEnabled && (
                        <>
                          <Slider label="Text Delay （文字ごとの遅延）" value={config.gpgpuMorphTextOnPathDelay} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTextOnPathDelay', v)} />
                          <Slider label="Text Size （グリフの大きさ）" value={config.gpgpuMorphTextOnPathSize} min={0.25} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTextOnPathSize', v)} />
                          <Slider label="Glyph Scale Var （文字ごとの拡大ばらつき・Phase AM）" value={config.gpgpuMorphTextOnPathGlyphScale} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTextOnPathGlyphScale', v)} />
                          <Slider label="Glyph Rotate Var （文字ごとの回転ばらつき・度・Phase AM）" value={config.gpgpuMorphTextOnPathGlyphRotate} min={0} max={180} step={1} onChange={(v) => updateConfig('gpgpuMorphTextOnPathGlyphRotate', Math.round(v))} />
                          <Slider label="Glyph Fade Var （文字ごとのフェードばらつき・Phase AM）" value={config.gpgpuMorphTextOnPathGlyphFade} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTextOnPathGlyphFade', v)} />
                          <Toggle label="Vertical Text （縦書き・Phase 17）" value={config.gpgpuMorphTextOnPathVertical} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphTextOnPathVertical', v)} />
                          {config.gpgpuMorphTextOnPathVertical && (
                            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                              文字列を TextMap 縦書きと同じ段組み（Column Length・禁則・縦中横・ルビのトークン化を共有）で計画し、段（右→左）→段内（上→下）の読み順でパスに並べます。各字は縦軸をパスの接線に合わせ、字の上を進行方向の逆へ向けます。ルビは計画に含まれますが、パス上では親文字のセルだけを配置します。
                            </div>
                          )}
                          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                            文字単位の変形は文字 index の決定的ハッシュで引くため、同じ設定では常に同じ崩れ方になります。Fade は透明化ではなく密度（その文字の粒子の一部が通常のパス配置へ落ちる）で表します。全て 0 で従来同一です。
                          </div>
                          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                            レイヤー2 TextMap の文字列を1文字ずつパス上に並べます（文字の形に粒子を配置）。Delay は文字ごとの弧長スロットをずらし、Write-on の窓を動かすと文字が順に現れます。文字列は TextMap の Text で編集します。
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                Off では従来どおり輪郭点群から無作為に抽出します。Along は粒子をパスの弧長順に割り当て、Write-on は窓［Start, End］の範囲だけを描いた状態にします。Taper はパスの法線方向へ配置帯を広げます（最大幅 0.1 固定、窓の始点基準）。複製（Replicas）と組み合わせると、複製ごとにパスの連続区間が割り当てられます。
              </div>
            </>
          )}
          {config.gpgpuMorphTarget === 'obj' && (
            <MorphObjImportBlock config={config} updateConfig={updateConfig} />
          )}
          {config.gpgpuMorphTarget === 'terrain' && (
            <>
              <div className="mb-1 mt-1 text-[9px] uppercase tracking-widest opacity-60">Terrain （地形）</div>
              <Slider label="Amplitude （標高の振幅）" value={config.gpgpuMorphTerrainAmplitude} min={0} max={1.5} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainAmplitude', v)} />
              <Slider label="Frequency （周波数）" value={config.gpgpuMorphTerrainFrequency} min={0.4} max={4} step={0.1} onChange={(v) => updateConfig('gpgpuMorphTerrainFrequency', v)} />
              <Slider label="Octaves （オクターブ）" value={config.gpgpuMorphTerrainOctaves} min={1} max={6} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainOctaves', Math.round(v))} />
              <Slider label="Terrain Seed （地形シード）" value={config.gpgpuMorphTerrainSeed} min={0} max={999} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainSeed', Math.round(v))} />
              <Toggle label="Recipe （生成レシピ）" value={config.gpgpuMorphTerrainKind} options={[{ label: 'fBm', val: 'fbm' as const }, { label: 'Ridge （尾根）', val: 'ridge' as const }, { label: 'Terrace （段々）', val: 'terrace' as const }, { label: 'Cellular （細胞状）', val: 'cellular' as const }]} onChange={(v) => updateConfig('gpgpuMorphTerrainKind', v)} />
              {config.gpgpuMorphTerrainKind === 'terrace' && (
                <Slider label="Terrace Steps （段数）" value={config.gpgpuMorphTerrainTerraceSteps} min={2} max={32} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainTerraceSteps', Math.round(v))} />
              )}
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                シード付き高度場の表面に粒子を敷きます。同じ設定からは常に同じ地形になります。レシピ（Phase AI）は fBm（従来）／Ridge（尾根）／Terrace（段々）／Cellular（細胞状）で、メッシュ・派生マップ・地形コライダにも同じ形が使われます。高さで色を変えるには Kinetix Color Gradient の Driver を Height にしてください（谷→山頂でグラデーションが進みます）。
              </div>
              <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Terrain Erosion （地形侵食）</div>
              <Slider label="Water （水力侵食）" value={config.gpgpuMorphTerrainErosionWater} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionWater', v)} />
              <Slider label="Droplets （水滴量）" value={config.gpgpuMorphTerrainErosionDroplets} min={0} max={2} step={0.1} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionDroplets', v)} />
              <Slider label="Deposit （堆積率）" value={config.gpgpuMorphTerrainErosionDeposit} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionDeposit', v)} />
              <Slider label="Thermal （熱侵食）" value={config.gpgpuMorphTerrainErosionThermal} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionThermal', v)} />
              <Slider label="Talus （タラス角）" value={config.gpgpuMorphTerrainErosionTalus} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionTalus', v)} />
              <Slider label="Thermal Passes （緩和パス）" value={config.gpgpuMorphTerrainErosionThermalPasses} min={1} max={80} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionThermalPasses', Math.round(v))} />
              <Slider label="Erosion Seed （侵食シード）" value={config.gpgpuMorphTerrainErosionSeed} min={0} max={999} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionSeed', Math.round(v))} />
              <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                生成済みの高度場をベイク時に彫り直す侵食シミュレーションです（Phase AP）。Water は水滴が谷を刻む水力侵食、Thermal はタラス角を超えた斜面が崩れる熱侵食で、どちらも 0 のときは従来の地形と完全に同一です。侵食後の地形はモーフ・メッシュ・派生マップ・コライダ・影で共有されます。トンネル表示のときは平面前提が崩れるため侵食は無効です。
              </div>
              <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Terrain Scatter （地形散布）</div>
              <Toggle label="Scatter （散布文法）" value={config.gpgpuMorphScatterEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphScatterEnabled', v)} />
              {config.gpgpuMorphScatterEnabled && (
                <>
                  <Slider label="Density （密度）" value={config.gpgpuMorphScatterDensity} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScatterDensity', v)} />
                  <Slider label="Height Min （高度帯・下限）" value={config.gpgpuMorphScatterHeightMin} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScatterHeightMin', v)} />
                  <Slider label="Height Max （高度帯・上限）" value={config.gpgpuMorphScatterHeightMax} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScatterHeightMax', v)} />
                  <Slider label="Slope Max （斜度上限）" value={config.gpgpuMorphScatterSlopeMax} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScatterSlopeMax', v)} />
                  <Slider label="Align Normal （法線整列）" value={config.gpgpuMorphScatterAlignNormal} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScatterAlignNormal', v)} />
                  <Slider label="Species （種別ゾーン数）" value={config.gpgpuMorphScatterSpecies} min={1} max={4} step={1} onChange={(v) => updateConfig('gpgpuMorphScatterSpecies', Math.round(v))} />
                  {config.gpgpuMorphScatterSpecies >= 2 && (
                    <>
                      <Toggle label="Species 2 Geom （種別2の形状・Phase 16）" value={config.gpgpuGeomSpecies2Mode} options={[{ label: 'Follow', val: 'follow' as const }, { label: 'Point', val: 'point' as const }, { label: 'Cube', val: 'cube' as const }, { label: 'Tetra', val: 'tetra' as const }, { label: 'Octa', val: 'octa' as const }, { label: 'Icosa', val: 'icosa' as const }, { label: 'Torus', val: 'torus' as const }, { label: 'Cone', val: 'cone' as const }, { label: 'OBJ', val: 'obj' as const }]} onChange={(v) => updateConfig('gpgpuGeomSpecies2Mode', v)} />
                      {config.gpgpuMorphScatterSpecies >= 3 && (
                        <Toggle label="Species 3 Geom （種別3の形状・Phase 16）" value={config.gpgpuGeomSpecies3Mode} options={[{ label: 'Follow', val: 'follow' as const }, { label: 'Point', val: 'point' as const }, { label: 'Cube', val: 'cube' as const }, { label: 'Tetra', val: 'tetra' as const }, { label: 'Octa', val: 'octa' as const }, { label: 'Icosa', val: 'icosa' as const }, { label: 'Torus', val: 'torus' as const }, { label: 'Cone', val: 'cone' as const }, { label: 'OBJ', val: 'obj' as const }]} onChange={(v) => updateConfig('gpgpuGeomSpecies3Mode', v)} />
                      )}
                      {config.gpgpuMorphScatterSpecies >= 4 && (
                        <Toggle label="Species 4 Geom （種別4の形状・Phase 16）" value={config.gpgpuGeomSpecies4Mode} options={[{ label: 'Follow', val: 'follow' as const }, { label: 'Point', val: 'point' as const }, { label: 'Cube', val: 'cube' as const }, { label: 'Tetra', val: 'tetra' as const }, { label: 'Octa', val: 'octa' as const }, { label: 'Icosa', val: 'icosa' as const }, { label: 'Torus', val: 'torus' as const }, { label: 'Cone', val: 'cone' as const }, { label: 'OBJ', val: 'obj' as const }]} onChange={(v) => updateConfig('gpgpuGeomSpecies4Mode', v)} />
                      )}
                      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                        種別ゾーンごとにジオメトリ形状を変えて描画を分割します（フォリッジ分割、Phase 16）。Follow は Geometry Mode に追従し、種別1は常に Geometry Mode です。Point を選んだ種別は立体を描きません（ポイント描画側で表示されます）。
                      </div>
                    </>
                  )}
                  <Slider label="Scale Random （スケール無作為化）" value={config.gpgpuMorphScatterScaleRandom} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScatterScaleRandom', v)} />
                  <Slider label="Rotation Random （回転無作為化）" value={config.gpgpuMorphScatterRotRandom} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScatterRotRandom', v)} />
                  <Slider label="Bend （ベンド・下り方向への倒れ）" value={config.gpgpuMorphScatterBend} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScatterBend', v)} />
                  <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                    候補点を最大5回抽選し、密度×高度帯×斜度の受理確率で残す散布文法です（Phase AI）。高度帯と斜度で生息域を作り、法線整列で表面の向きに沿わせ、種別は高度帯ゾーンとして放出キックの強さに効きます。全パラメータ既定（密度1・帯0..1・斜度1・整列0・種別1）のときは散布を有効にしても従来の配置と完全に同一です。仕上げ（Phase AX）: Scale/Rotation Random は粒子ごとに法線の大きさ・方位をばらつかせ、Bend は法線を斜面の下り方向へ倒します（点群の姿勢仕上げで、メッシュの曲げや種別ごとのメッシュ差し替えではありません）。全て 0 で従来同一です。
                  </div>
                  <PcgGraphEditorBlock config={config} updateConfig={updateConfig} />
                </>
              )}
            </>
          )}
          <>
            <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Form Deformation （フォーム専用変形: 配置変形）</div>
            <Slider label="Disperse Amount （拡散量）" value={config.gpgpuMorphDisperseAmount} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuMorphDisperseAmount', v)} />
            {config.gpgpuMorphDisperseAmount !== 0 && (
              <Toggle label="Disperse Direction （拡散方向）" value={config.gpgpuMorphDisperseDirection} options={[{ label: 'Radial', val: 'radial' as const }, { label: 'X', val: 'x' as const }, { label: 'Y', val: 'y' as const }, { label: 'Z', val: 'z' as const }]} onChange={(v) => updateConfig('gpgpuMorphDisperseDirection', v)} />
            )}
            <Slider label="Twist Amount （ねじり量）" value={config.gpgpuMorphTwistAmount} min={-4} max={4} step={0.1} onChange={(v) => updateConfig('gpgpuMorphTwistAmount', v)} />
            {config.gpgpuMorphTwistAmount !== 0 && (
              <Toggle label="Twist Axis （ねじり軸）" value={config.gpgpuMorphTwistAxis} options={[{ label: 'X', val: 'x' as const }, { label: 'Y', val: 'y' as const }, { label: 'Z', val: 'z' as const }]} onChange={(v) => updateConfig('gpgpuMorphTwistAxis', v)} />
            )}
            <Slider label="Fractal Amount （フラクタル変位量）" value={config.gpgpuMorphFractalAmount} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuMorphFractalAmount', v)} />
            {config.gpgpuMorphFractalAmount !== 0 && (
              <>
                <Slider label="Fractal Frequency （周波数）" value={config.gpgpuMorphFractalFrequency} min={0.2} max={8} step={0.1} onChange={(v) => updateConfig('gpgpuMorphFractalFrequency', v)} />
                <Slider label="Fractal Evolution （時間発展）" value={config.gpgpuMorphFractalEvolution} min={0} max={20} step={0.25} onChange={(v) => updateConfig('gpgpuMorphFractalEvolution', v)} />
              </>
            )}
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              モーフ配置そのものへの専用変形です（Flow／Vortex 等のモーションとは別系統）。全て 0 では従来と完全同一になります。
            </div>
          </>
          <>
            <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Fracture （Voronoi 破砕）</div>
            <Toggle label="Voronoi Fracture （ボロノイ破砕）" value={config.gpgpuMorphFractureEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphFractureEnabled', v)} />
            {config.gpgpuMorphFractureEnabled && (
              <>
                <Slider label="Cells （セル数）" value={config.gpgpuMorphFractureCells} min={2} max={64} step={1} onChange={(v) => updateConfig('gpgpuMorphFractureCells', Math.round(v))} />
                <Slider label="Seed （分割シード）" value={config.gpgpuMorphFractureSeed} min={0} max={9999} step={1} onChange={(v) => updateConfig('gpgpuMorphFractureSeed', Math.round(v))} />
                <Slider label="Gap （分離量）" value={config.gpgpuMorphFractureGap} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphFractureGap', v)} />
                <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                  ベイクした点群をシード付きボロノイセルで割り、破片ごとに引き離します。サイトは点群自身から抽選されるので形に沿って割れます。同じシードでは常に同じ分割になります。全モーフ目標（Text／Image／SVG／OBJ／地形ほか）に効きます。
                </div>
                <FragmentCollectionBlock config={config} updateConfig={updateConfig} />
              </>
            )}
          </>
          <>
            <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Surface Fibers （モーフ面ファイバー）</div>
            <Toggle label="Morph Fibers （面ファイバー）" value={config.gpgpuMorphFiberEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphFiberEnabled', v)} />
            {config.gpgpuMorphFiberEnabled && (
              <>
                <Slider label="Fiber Count （本数）" value={config.gpgpuMorphFiberCount} min={50} max={4000} step={10} onChange={(v) => updateConfig('gpgpuMorphFiberCount', Math.round(v))} />
                <Slider label="Fiber Length （長さ）" value={config.gpgpuMorphFiberLength} min={0.05} max={1.5} step={0.05} onChange={(v) => updateConfig('gpgpuMorphFiberLength', v)} />
                <Slider label="Fiber Curl （カール）" value={config.gpgpuMorphFiberCurl} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphFiberCurl', v)} />
                <Toggle label="Root Source （発生面）" value={config.gpgpuMorphFiberRootSource} options={[{ label: 'Morph 面', val: 'morph' }, { label: 'Emit 初期雲', val: 'emit' }, { label: 'Terrain 地形', val: 'terrain' }]} onChange={(v) => updateConfig('gpgpuMorphFiberRootSource', v)} />
                <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Grooming （グルーミング・Phase AL）</div>
                <Slider label="Groom Direction X" value={config.gpgpuMorphFiberGroomX} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphFiberGroomX', v)} />
                <Slider label="Groom Direction Y" value={config.gpgpuMorphFiberGroomY} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphFiberGroomY', v)} />
                <Slider label="Groom Direction Z" value={config.gpgpuMorphFiberGroomZ} min={-1} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphFiberGroomZ', v)} />
                <Slider label="Groom Align （整列）" value={config.gpgpuMorphFiberGroomAlign} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphFiberGroomAlign', v)} />
                <Toggle label="Groom Field （方向場）" value={config.gpgpuMorphFiberGroomField} options={[{ label: 'Uniform 一様', val: 'uniform' }, { label: 'Noise', val: 'noise' }, { label: 'Radial 放射', val: 'radial' }, { label: 'Swirl 渦', val: 'swirl' }]} onChange={(v) => updateConfig('gpgpuMorphFiberGroomField', v)} />
                {config.gpgpuMorphFiberGroomField === 'noise' && (
                  <Slider label="Groom Field Scale （方向場の細かさ）" value={config.gpgpuMorphFiberGroomFieldScale} min={0.1} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuMorphFiberGroomFieldScale', v)} />
                )}
                <Slider label="Length Variation （長さ分布）" value={config.gpgpuMorphFiberLengthVar} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphFiberLengthVar', v)} />
                <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                  発生面の表面点から法線方向（OBJ は実法線、その他は放射方向）へ繊維を生やします。発生面は Morph 面のほか、初期雲（Emit）と地形（Terrain）も選べます（後2者は Morph 無効でも生えます）。描画のみの重ね表示で、シミュレーションには影響しません。根元の抽選は決定的です。グルーミングは成長方向を方向場へ寄せる編集文法で、方向場が一様で方向が零ベクトルか、整列 0 の間は従来の繊維と一致します。方向場（Noise／放射／渦）は根元の位置だけで決まり、抽選には影響しません。
                </div>
              </>
            )}
          </>
          <Slider label="Strength" value={config.gpgpuMorphStrength} min={0} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuMorphStrength', v)} />
          <Slider label="Scale" value={config.gpgpuMorphScale} min={0.1} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuMorphScale', v)} />
          <Slider label="Jitter" value={config.gpgpuMorphJitter} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphJitter', v)} />
          <Slider label="Orbit Speed" value={config.gpgpuMorphOrbitSpeed} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuMorphOrbitSpeed', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            各粒子に割り当てた形状点群へバネ引力で集めます（Kinetix モーフの GPGPU 再実装）。Text はレイヤー2のテキスト設定、Image はレイヤー2に読み込んだ画像マップ、SVG は取り込んだ SVG の輪郭、OBJ は取り込んだ OBJ メッシュの表面、Terrain はシード付きフラクタル高度場の表面を使います。
          </div>
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Replicas （複製文法）</div>
          <Slider label="Replica Count" value={config.gpgpuMorphReplicaCount} min={1} max={8} step={1} onChange={(v) => updateConfig('gpgpuMorphReplicaCount', Math.round(v))} />
          {config.gpgpuMorphReplicaCount > 1 && (
            <>
              <Slider label="Spacing （間隔）" value={config.gpgpuMorphReplicaSpacing} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuMorphReplicaSpacing', v)} />
              <Toggle label="Axis （並べる軸）" value={config.gpgpuMorphReplicaAxis} options={[{ label: 'X', val: 'x' as const }, { label: 'Y', val: 'y' as const }, { label: 'Z', val: 'z' as const }]} onChange={(v) => updateConfig('gpgpuMorphReplicaAxis', v)} />
              <Slider label="Rotation Step （回転増分°）" value={config.gpgpuMorphReplicaRotation} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuMorphReplicaRotation', v)} />
              <Slider label="Scale Step （等比）" value={config.gpgpuMorphReplicaScaleStep} min={0.5} max={1.6} step={0.02} onChange={(v) => updateConfig('gpgpuMorphReplicaScaleStep', v)} />
              <Slider label="Phase Step （位相ずらし°）" value={config.gpgpuMorphReplicaPhaseStep} min={0} max={360} step={5} onChange={(v) => updateConfig('gpgpuMorphReplicaPhaseStep', v)} />
              <Slider label="Age Step （年齢位相・周期比）" value={config.gpgpuMorphReplicaAgeStep} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphReplicaAgeStep', v)} />
              <Toggle label="Independent Sim （独立シム）" value={config.gpgpuMorphReplicaIndependent} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMorphReplicaIndependent', v)} />
              {config.gpgpuMorphReplicaIndependent && (
                <Slider label="Divergence （分岐度）" value={config.gpgpuMorphReplicaDivergence} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMorphReplicaDivergence', v)} />
              )}
            </>
          )}
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            形状点群を複製して、間隔・回転・拡縮を累積させた連鎖にします。総点数は増えず、複製へ割り当てます。Phase Step は複製ごとの公転位相をずらす時間オフセット（Echospace 的な「遅れて追う連鎖」）です。Count 1 のときは従来と完全に同一です。Independent Sim を On にすると、各複製が独立したシミュレーション状態を持ち、力の場も複製ごとに分岐します（WebGL 経路のみ）。
          </div>
        </>
      )}
    </div>

    {/* Terrain Mesh (Phase P, Mir-style polygon terrain) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Terrain Mesh （地形メッシュ）" value={config.gpgpuTerrainMeshEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuTerrainMeshEnabled', v)} />
      {config.gpgpuTerrainMeshEnabled && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Display （表示形態）</div>
          <Toggle label="Display" value={config.gpgpuTerrainMeshDisplay} options={[{ label: 'Shaded', val: 'shaded' as const }, { label: 'Wireframe', val: 'wireframe' as const }, { label: 'Points', val: 'points' as const }]} onChange={(v) => updateConfig('gpgpuTerrainMeshDisplay', v)} />
          <Toggle label="Tunnel （トンネル）" value={config.gpgpuTerrainMeshTunnel} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuTerrainMeshTunnel', v)} />
          {config.gpgpuTerrainMeshTunnel && (
            <Slider label="Tunnel Speed （前進速度）" value={config.gpgpuTunnelSpeed} min={0} max={60} step={1} onChange={(v) => updateConfig('gpgpuTunnelSpeed', v)} />
          )}
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Texture （表面テクスチャ）</div>
          <select
            value={config.gpgpuTerrainMeshTexture}
            onChange={(e) => updateConfig('gpgpuTerrainMeshTexture', e.target.value as typeof config.gpgpuTerrainMeshTexture)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="none">None (単色陰影)</option>
            <option value="gradient">Gradient (モノクロ+等高線)</option>
            <option value="grid">Grid (測量グリッド)</option>
            <option value="image">Image (地形専用画像／背景画像)</option>
          </select>
          {config.gpgpuTerrainMeshTexture === 'image' && (
            <TerrainTextureImageBlock config={config} updateConfig={updateConfig} />
          )}
          {config.gpgpuTerrainMeshTexture !== 'none' && (
            <>
              <Slider label="Texture Repeat （繰り返し）" value={config.gpgpuTerrainTextureRepeat} min={0.25} max={8} step={0.25} onChange={(v) => updateConfig('gpgpuTerrainTextureRepeat', v)} />
              <Slider label="Texture Offset X" value={config.gpgpuTerrainTextureOffsetX} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTerrainTextureOffsetX', v)} />
              <Slider label="Texture Offset Y" value={config.gpgpuTerrainTextureOffsetY} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTerrainTextureOffsetY', v)} />
            </>
          )}
          <Slider label="Scale （大きさ）" value={config.gpgpuTerrainMeshScale} min={0.25} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuTerrainMeshScale', v)} />
          <Slider label="Opacity （不透明度）" value={config.gpgpuTerrainMeshOpacity} min={0.05} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuTerrainMeshOpacity', v)} />
          <Slider label="Brightness （明るさ）" value={config.gpgpuTerrainMeshBrightness} min={0.1} max={2.5} step={0.05} onChange={(v) => updateConfig('gpgpuTerrainMeshBrightness', v)} />
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Terrain Field （高度場・モーフ地形と共有）</div>
          <Slider label="Amplitude （標高の振幅）" value={config.gpgpuMorphTerrainAmplitude} min={0} max={1.5} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainAmplitude', v)} />
          <Slider label="Frequency （周波数）" value={config.gpgpuMorphTerrainFrequency} min={0.4} max={4} step={0.1} onChange={(v) => updateConfig('gpgpuMorphTerrainFrequency', v)} />
          <Slider label="Octaves （オクターブ）" value={config.gpgpuMorphTerrainOctaves} min={1} max={6} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainOctaves', Math.round(v))} />
          <Slider label="Terrain Seed （地形シード）" value={config.gpgpuMorphTerrainSeed} min={0} max={999} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainSeed', Math.round(v))} />
          <Toggle label="Recipe （生成レシピ）" value={config.gpgpuMorphTerrainKind} options={[{ label: 'fBm', val: 'fbm' as const }, { label: 'Ridge （尾根）', val: 'ridge' as const }, { label: 'Terrace （段々）', val: 'terrace' as const }, { label: 'Cellular （細胞状）', val: 'cellular' as const }]} onChange={(v) => updateConfig('gpgpuMorphTerrainKind', v)} />
          {config.gpgpuMorphTerrainKind === 'terrace' && (
            <Slider label="Terrace Steps （段数）" value={config.gpgpuMorphTerrainTerraceSteps} min={2} max={32} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainTerraceSteps', Math.round(v))} />
          )}
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Terrain Erosion （地形侵食・モーフ地形と共有）</div>
          <Slider label="Water （水力侵食）" value={config.gpgpuMorphTerrainErosionWater} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionWater', v)} />
          <Slider label="Droplets （水滴量）" value={config.gpgpuMorphTerrainErosionDroplets} min={0} max={2} step={0.1} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionDroplets', v)} />
          <Slider label="Deposit （堆積率）" value={config.gpgpuMorphTerrainErosionDeposit} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionDeposit', v)} />
          <Slider label="Thermal （熱侵食）" value={config.gpgpuMorphTerrainErosionThermal} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionThermal', v)} />
          <Slider label="Talus （タラス角）" value={config.gpgpuMorphTerrainErosionTalus} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionTalus', v)} />
          <Slider label="Thermal Passes （緩和パス）" value={config.gpgpuMorphTerrainErosionThermalPasses} min={1} max={80} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionThermalPasses', Math.round(v))} />
          <Slider label="Erosion Seed （侵食シード）" value={config.gpgpuMorphTerrainErosionSeed} min={0} max={999} step={1} onChange={(v) => updateConfig('gpgpuMorphTerrainErosionSeed', Math.round(v))} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            高度場で変位させたポリゴンメッシュに頂点法線の陰影を付けます（Trapcode Mir 型）。高度場はモーフ地形（terrain目標）と共有するため、点地形とメッシュ地形は同じ地形になります。トンネルは円筒内面に巻いた形状で、高度場は継ぎ目なく周期化されます。テクスチャの Image は地形専用画像が優先され、未設定時は Horizon 背景画像を流用します。Repeat / Offset は全テクスチャ種に効く UV 変換です。Tunnel Speed は地形の位相スクロールによる前進表現で、カメラ自体は動きません。速度 0 では従来の静止トンネルと完全に同一です。侵食（Phase AP）はベイク時に高度場を彫り直すシミュレーションで、Water／Thermal とも 0 では従来と完全に同一です。トンネル表示では侵食は無効です。
          </div>
          <TerrainDerivedMapsBlock config={config} updateConfig={updateConfig} />
        </>
      )}
    </div>

    {/* OBJ Mesh (Phase V, Mir-style mesh side of the OBJ import) */}
    <ObjMeshBlock config={config} updateConfig={updateConfig} />

    {/* Verlet Integration */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Verlet Integration" value={config.gpgpuVerletEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVerletEnabled', v)} />
    </div>

    {/* Vellum constraint solver (Phase AR) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Vellum Solver （拘束ソルバ）" value={config.gpgpuVellumEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVellumEnabled', v)} />
      {config.gpgpuVellumEnabled && (
        <>
          <Toggle
            label="Mode （初期形状）"
            value={config.gpgpuVellumMode}
            options={[{ label: 'Sheet （平面）', val: 'sheet' as const }, { label: 'Shell （球殻）', val: 'shell' as const }]}
            onChange={(v) => updateConfig('gpgpuVellumMode', v)}
          />
          <Toggle
            label="Pin （ピン留め）"
            value={config.gpgpuVellumPin}
            options={[{ label: 'None', val: 'none' as const }, { label: 'Top （上辺）', val: 'top' as const }, { label: 'Corners （四隅）', val: 'corners' as const }, { label: 'Top+Corners', val: 'topCorners' as const }]}
            onChange={(v) => updateConfig('gpgpuVellumPin', v)}
          />
          <Slider label="Stiffness （剛性・補正率）" value={config.gpgpuVellumStiffness} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuVellumStiffness', v)} />
          <Slider label="Bend （曲げ）" value={config.gpgpuVellumBend} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuVellumBend', v)} />
          <Slider label="Substeps （反復）" value={config.gpgpuVellumSubsteps} min={1} max={4} step={1} onChange={(v) => updateConfig('gpgpuVellumSubsteps', Math.round(v))} />
          <Slider label="Pressure （圧力）" value={config.gpgpuVellumPressure} min={-5} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuVellumPressure', v)} />
          <Slider label="Tear （破れ閾値）" value={config.gpgpuVellumTear} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuVellumTear', v)} />
          <Slider label="Damping （減衰）" value={config.gpgpuVellumDamping} min={0} max={0.5} step={0.01} onChange={(v) => updateConfig('gpgpuVellumDamping', v)} />
          <Slider label="Stitch （縫合・速度結合）" value={config.gpgpuVellumStitch} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuVellumStitch', v)} />
          <Slider label="Glue （接着・ベイク位置へ）" value={config.gpgpuVellumGlue} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuVellumGlue', v)} />
          <Slider label="Glue Break （接着の破断・変位）" value={config.gpgpuVellumGlueBreak} min={0} max={500} step={1} onChange={(v) => updateConfig('gpgpuVellumGlueBreak', v)} />
          <Slider label="Tear Gap （破れの分離・亀裂表示）" value={config.gpgpuVellumTearGap} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuVellumTearGap', v)} />
          <Toggle
            label="Solver Mode （解法）"
            value={config.gpgpuVellumSolverMode}
            options={[{ label: 'Legacy （従来PBD）', val: 'legacy' as const }, { label: 'XPBD （完成形）', val: 'xpbd' as const }]}
            onChange={(v) => updateConfig('gpgpuVellumSolverMode', v)}
          />
          {config.gpgpuVellumSolverMode === 'xpbd' && (
            <>
              <Slider label="Compliance （XPBD・構造α）" value={config.gpgpuVellumCompliance} min={0} max={0.1} step={0.0005} onChange={(v) => updateConfig('gpgpuVellumCompliance', v)} />
              <Slider label="Bend Compliance （XPBD・曲げα）" value={config.gpgpuVellumBendCompliance} min={0} max={0.1} step={0.0005} onChange={(v) => updateConfig('gpgpuVellumBendCompliance', v)} />
              <Toggle label="Volume （体積保存・Shell専用）" value={config.gpgpuVellumVolumeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVellumVolumeEnabled', v)} />
              {config.gpgpuVellumVolumeEnabled && (
                <>
                  <Slider label="Volume Ratio （目標体積比）" value={config.gpgpuVellumVolumeRatio} min={0.5} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuVellumVolumeRatio', v)} />
                  <Slider label="Volume Compliance （体積α）" value={config.gpgpuVellumVolumeCompliance} min={0} max={0.1} step={0.0005} onChange={(v) => updateConfig('gpgpuVellumVolumeCompliance', v)} />
                </>
              )}
            </>
          )}
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            {config.gpgpuVellumSolverMode === 'xpbd'
              ? 'XPBD 完成形です（Δλ蓄積＋物理単位のコンプライアンス。Substeps はサブステップ数として解釈され、剛性は dt に依りません）。Compliance が 0 の間は Stiffness／Bend からの写像で初期化されます。有効にするとプール全体が格子状に再配置され（リセット＝再ベイク）、年齢リスポーン／キル条件／スポーンゲート／モーフ／レプリカ独立 sim／ポインタペイントは格子を守るため無効化されます。自己衝突は解きません。体積保存は Shell 専用で、有効時は Pressure（法線方向の力）は打ち消されます。'
              : 'PBD 系の距離拘束ソルバです（XPBD の厳密実装ではなく、剛性は補正率×反復の実効値）。有効にするとプール全体が格子状に再配置され（リセット＝再ベイク）、年齢リスポーン／キル条件／スポーンゲート／モーフ／レプリカ独立 sim／ポインタペイントは格子を守るため無効化されます。自己衝突は解きません。圧力は体積保存ではなく面法線方向の力です。'}
          </div>
        </>
      )}
    </div>

    {/* Rigid body solver (Phase AU) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Rigid Body Solver （剛体ソルバ）" value={config.gpgpuRigidEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuRigidEnabled', v)} />
      {config.gpgpuRigidEnabled && (
        <>
          <Slider label="Restitution （反発）" value={config.gpgpuRigidRestitution} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuRigidRestitution', v)} />
          <Slider label="Friction （摩擦）" value={config.gpgpuRigidFriction} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuRigidFriction', v)} />
          <Toggle label="Glue （接着）" value={config.gpgpuRigidGlueEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuRigidGlueEnabled', v)} />
          <Slider label="Glue Strength （破断閾値）" value={config.gpgpuRigidGlueStrength} min={0} max={200} step={1} onChange={(v) => updateConfig('gpgpuRigidGlueStrength', Math.round(v))} />
          <Toggle label="Start Sleeping （全スリープ開始）" value={config.gpgpuRigidStartSleeping} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuRigidStartSleeping', v)} />
          <Toggle label="Floor Terrain （地形床）" value={config.gpgpuRigidFloorTerrain} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuRigidFloorTerrain', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            破砕ベイクのセル（最大64体）を永続剛体として CPU で解くソルバです（質量・球近似の慣性・逐次インパルス接触・接着と破断・スリープ／活性化）。モーフ点群が前提で、破砕の Cells / Seed がそのまま体の分割になります。有効中は年齢リスポーン／キル条件／スポーンゲート／モーフ引力／レプリカ独立 sim は体を守るため無効化され、Vellum より優先されます。衝突形状はセルのバウンディング球近似のみ（開始時の重なりは初期距離を下限として許容）、凸包・メッシュ衝突・拘束ジョイントは解きません。床とバウンス球には衝突します。地形床 ON のときは、侵食ベイクの高度場がある場面でのみ床がその地形になります（無い場面では平面の床のまま。地形との衝突は体の中心直下の高さで解くため、大きな体は急斜面の脇で地形にめり込むことがあります）。
          </div>
        </>
      )}
    </div>

    {/* SDF Collider */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="SDF Collider" value={config.gpgpuSdfEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSdfEnabled', v)} />
      {config.gpgpuSdfEnabled && (
        <>
          <Toggle
            label="Shape"
            value={config.gpgpuSdfShape}
            options={[{ label: 'Sphere', val: 'sphere' }, { label: 'Box', val: 'box' }, { label: 'Torus', val: 'torus' }, { label: 'Capsule', val: 'capsule' }, { label: 'Gyroid', val: 'gyroid' }]}
            onChange={(v) => updateConfig('gpgpuSdfShape', v)}
          />
          {config.gpgpuSdfShape === 'gyroid' && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              Gyroid: ジャイロイド曲面（TPMS）の内側が固体になる迷路状コライダです（Kinetix の gyro）。Size が周期の大きさを決めます。
            </div>
          )}
          <Slider label="Size" value={config.gpgpuSdfSize} min={5} max={300} step={5} onChange={(v) => updateConfig('gpgpuSdfSize', v)} />
          <Slider label="Bounce" value={config.gpgpuSdfBounce} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuSdfBounce', v)} />
          <Slider label="Center X" value={config.gpgpuSdfX} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuSdfX', v)} />
          <Slider label="Center Y" value={config.gpgpuSdfY} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuSdfY', v)} />
          <Slider label="Center Z" value={config.gpgpuSdfZ} min={-300} max={300} step={5} onChange={(v) => updateConfig('gpgpuSdfZ', v)} />
        </>
      )}
    </div>

    {/* Floor Bounce (B3) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Floor Bounce (床)" value={config.gpgpuFloorEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuFloorEnabled', v)} />
      {config.gpgpuFloorEnabled && (
        <>
          <Slider label="Floor Y" value={config.gpgpuFloorY} min={-400} max={100} step={5} onChange={(v) => updateConfig('gpgpuFloorY', v)} />
          <Slider label="Restitution (反発)" value={config.gpgpuFloorBounce} min={0} max={1} step={0.02} onChange={(v) => updateConfig('gpgpuFloorBounce', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            GPGPU 粒子が水平な床で跳ね返ります（Kinetix floorBounce）。球境界だけだった GPGPU に床が増えます。
          </div>
        </>
      )}
    </div>

    {/* Terrain Collider (Phase AI) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Terrain Collider （地形コライダ）" value={config.gpgpuTerrainColliderEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuTerrainColliderEnabled', v)} />
      {config.gpgpuTerrainColliderEnabled && (
        <>
          <Slider label="Bounce （反発）" value={config.gpgpuTerrainColliderBounce} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuTerrainColliderBounce', v)} />
          <Slider label="Friction （摩擦）" value={config.gpgpuTerrainColliderFriction} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuTerrainColliderFriction', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            粒子が高度場の表面で跳ね、摩擦で斜面に静止します（Phase AI）。地形メッシュが有効で平面モード（トンネルでない）のときだけ効きます。反発 0・摩擦 1 で表面に貼り付くように止まります。地形生成レシピの形そのものと衝突します。
          </div>
        </>
      )}
    </div>

    {/* Mesh SDF Collider (Phase BY) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Mesh SDF Collider （メッシュSDFコライダ）" value={config.gpgpuMeshSdfEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMeshSdfEnabled', v)} />
      {config.gpgpuMeshSdfEnabled && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Bake Resolution （焼き解像度）</div>
          <select
            value={config.gpgpuMeshSdfResolution}
            onChange={(e) => updateConfig('gpgpuMeshSdfResolution', Number(e.target.value))}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value={32}>32³ （最速・粗い）</option>
            <option value={48}>48³</option>
            <option value={64}>64³ （標準）</option>
            <option value={96}>96³</option>
            <option value={128}>128³ （精密・焼き時間長）</option>
          </select>
          <Slider label="Bounce （反発）" value={config.gpgpuMeshSdfBounce} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMeshSdfBounce', v)} />
          <Slider label="Friction （摩擦）" value={config.gpgpuMeshSdfFriction} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuMeshSdfFriction', v)} />
          <MeshSdfBakeStatusLine config={config} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            取り込み済み OBJ を符号付き距離場に焼き、任意の閉メッシュを障害物にします（Phase BY）。配置はモーフ配置（原点・モーフスケール）に従い、ObjMesh 表示の位置オフセットには追随しません。解析 SDF と同時使用でき、解析側が先に効きます。
          </div>
        </>
      )}
    </div>
  </>
);
