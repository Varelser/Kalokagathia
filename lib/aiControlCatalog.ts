// AI control catalog (AI integration Phase 1): the curated subset of
// ParticleConfig keys an LLM is allowed to touch, with Japanese glosses and
// validation metadata. Numeric ranges come from PARAMETER_CATALOG (the same
// source the panel sliders use) unless overridden below for keys the panel
// exposes as non-slider inputs. Everything the model returns is validated
// against this catalog before it reaches the live config — unknown keys,
// wrong types, out-of-range numbers and illegal enum values are dropped.
import type { ParticleConfig } from '../types';
import { PARAMETER_CATALOG } from './parameterCatalog';

export type AiParamKind = 'number' | 'boolean' | 'enum';

export interface AiParamSpec {
  key: keyof ParticleConfig;
  kind: AiParamKind;
  gloss: string;
  min?: number;
  max?: number;
  step?: number;
  values?: readonly string[];
}

type NumDef = [keyof ParticleConfig, string];
type BoolDef = [keyof ParticleConfig, string];

const NUMS: NumDef[] = [
  // Global / Layer 1 (emitter)
  ['layer1Count', 'レイヤー1の粒の数'],
  ['baseSize', 'レイヤー1の粒の大きさ'],
  ['opacity', 'レイヤー1の不透明度'],
  ['contrast', '全体のコントラスト（色の強さ）'],
  ['rotationSpeedX', '自動回転の速さ（横）'],
  ['rotationSpeedY', '自動回転の速さ（縦）'],
  ['pulseSpeed', '全体のパルス（脈動）の速さ'],
  ['cameraImpulseStrength', 'カメラの揺れ・ドリフトの強さ'],
  // Post FX
  ['postBrightness', '画面の明るさ'],
  ['postBloomIntensity', '光のにじみ（ブルーム）の強さ'],
  ['postBloomRadius', '光のにじみの広がり'],
  ['postChromaticAberrationOffset', '色ずれ（色収差）の量'],
  ['postKaleidoscopeSegments', '万華鏡の分割数'],
  ['postKaleidoscopeRotation', '万華鏡の回転'],
  ['postFeedbackDecay', '画面残像の残り方（大きいほど長く残る）'],
  ['postFeedbackZoom', '画面残像のズーム'],
  // Layer 2
  ['layer2Count', 'レイヤー2の粒の数'],
  ['layer2BaseSize', 'レイヤー2の粒の大きさ'],
  ['layer2TemporalSpeed', 'レイヤー2の動きの速さ'],
  ['layer2FlowSpeed', 'レイヤー2の流れの速さ'],
  ['layer2FlowAmplitude', 'レイヤー2の流れの振れ幅'],
  ['layer2Gravity', 'レイヤー2の重力（下向きの引力）'],
  ['layer2Repulsion', 'レイヤー2の反発（粒同士の離れ具合）'],
  ['layer2NoiseScale', 'レイヤー2のノイズの細かさ'],
  ['layer2Life', 'レイヤー2の粒の寿命'],
  ['layer2FlickerAmount', 'レイヤー2のちらつき'],
  ['layer2SourceSpread', 'レイヤー2の発生範囲の広がり'],
  ['layer2GhostTrailCount', 'レイヤー2の残像の数'],
  ['layer2GhostTrailFade', 'レイヤー2の残像の薄れ方'],
  ['layer2ReactionFhnGain', 'レイヤー2のFHN波形の表示の明るさ（1が標準）'],
  ['layer2ReactionLeniaMu', 'レイヤー2のLenia成長中心μ'],
  ['layer2ReactionLeniaSigma', 'レイヤー2のLenia成長の幅σ'],
  ['layer2ReactionLeniaRadius', 'レイヤー2のLeniaカーネル半径'],
  ['layer2ReactionLeniaDt', 'レイヤー2のLenia時間ステップ'],
  ['layer2ReactionLeniaGain', 'レイヤー2のLenia表示の明るさ（1が標準）'],
  ['layer2WarpAmount', 'レイヤー2のドメインワープ（空間を歪める量）'],
  ['layer2WarpScale', 'レイヤー2のドメインワープの細かさ'],
  ['layer2ConnectionDistance', 'レイヤー2の線がつながる距離'],
  ['layer2ConnectionOpacity', 'レイヤー2の線の濃さ'],
  ['layer2ConnectionWidth', 'レイヤー2の線の太さ'],
  // Layer 3
  ['layer3Count', 'レイヤー3の粒の数'],
  ['layer3BaseSize', 'レイヤー3の粒の大きさ'],
  ['layer3TemporalSpeed', 'レイヤー3の動きの速さ'],
  ['layer3FlowSpeed', 'レイヤー3の流れの速さ'],
  ['layer3FlowAmplitude', 'レイヤー3の流れの振れ幅'],
  ['layer3Gravity', 'レイヤー3の重力'],
  ['layer3Repulsion', 'レイヤー3の反発'],
  ['layer3NoiseScale', 'レイヤー3のノイズの細かさ'],
  ['layer3Life', 'レイヤー3の粒の寿命'],
  ['layer3FlickerAmount', 'レイヤー3のちらつき'],
  ['layer3SourceSpread', 'レイヤー3の発生範囲の広がり'],
  ['layer3GhostTrailCount', 'レイヤー3の残像の数'],
  ['layer3GhostTrailFade', 'レイヤー3の残像の薄れ方'],
  ['layer3ReactionFhnGain', 'レイヤー3のFHN波形の表示の明るさ（1が標準）'],
  ['layer3ReactionLeniaMu', 'レイヤー3のLenia成長中心μ'],
  ['layer3ReactionLeniaSigma', 'レイヤー3のLenia成長の幅σ'],
  ['layer3ReactionLeniaRadius', 'レイヤー3のLeniaカーネル半径'],
  ['layer3ReactionLeniaDt', 'レイヤー3のLenia時間ステップ'],
  ['layer3ReactionLeniaGain', 'レイヤー3のLenia表示の明るさ（1が標準）'],
  ['layer3WarpAmount', 'レイヤー3のドメインワープ（空間を歪める量）'],
  ['layer3WarpScale', 'レイヤー3のドメインワープの細かさ'],
  ['layer3ConnectionDistance', 'レイヤー3の線がつながる距離'],
  ['layer3ConnectionOpacity', 'レイヤー3の線の濃さ'],
  ['layer3ConnectionWidth', 'レイヤー3の線の太さ'],
  // GPGPU
  ['gpgpuCount', 'GPGPU粒子の数'],
  ['gpgpuSize', 'GPGPU粒子の大きさ'],
  ['gpgpuOpacity', 'GPGPU粒子の不透明度'],
  ['gpgpuSpeed', 'GPGPUの動きの速さ'],
  ['gpgpuCurlStrength', 'GPGPUの渦（カール）の強さ'],
  ['gpgpuAttractorScale', 'GPGPUアトラクタの大きさ'],
  // Ambient
  ['ambientCount', '漂う微粒子の数'],
  ['ambientBaseSize', '微粒子の大きさ'],
  ['ambientSpeed', '微粒子の漂う速さ'],
  ['ambientSpread', '微粒子の広がり'],
  // --- Expansion 2026-11-11 (~300 keys): global / post FX / camera / screen ---
  ['particleSoftness', '粒子の輪郭の柔らかさ'],
  ['particleGlow', '粒子のハロー（発光のにじみ）の強さ'],
  ['perspective', '画角（パースペクティブ、3Dのみ）'],
  ['cameraImpulseSpeed', 'カメラの揺れが戻る速さ'],
  ['cameraImpulseDrift', 'カメラの揺れに混ざる漂いの量'],
  ['cameraBurstBoost', 'バースト時のカメラの後押し'],
  ['depthFogNear', '奥行きフォグがかかり始める距離'],
  ['depthFogFar', '奥行きフォグが完全にかかる距離'],
  ['postBloomThreshold', 'ブルームがかかり始める明るさの境目'],
  ['postContrastAmount', '画面全体のコントラスト調整（±）'],
  ['postDofFocusDistance', '被写界深度のピント位置'],
  ['postDofBokehScale', '被写界深度のボケの大きさ'],
  ['postNoiseOpacity', 'ノイズ粒子の不透明度'],
  ['postVignetteOffset', 'ビネットが落ち始める位置'],
  ['postVignetteDarkness', 'ビネットの暗さ'],
  ['postFeedbackRotation', '画面残像の回転ずれ'],
  ['postSlitScanBands', 'スリットスキャンの帯の数'],
  ['screenNoiseIntensity', 'フィルムグレイン（画面ノイズ）の強さ'],
  ['screenScanlineIntensity', '走査線（横縞）の濃さ'],
  ['screenVignetteIntensity', '画面周辺を落とすビネットの強さ'],
  ['screenPulseIntensity', '中心から広がる放射パルスの強さ'],
  ['screenPulseSpeed', '放射パルスの広がる速さ'],
  ['screenPersistenceIntensity', '画面残像の強さ'],
  ['screenSplitIntensity', '信号スプリット（画面分割・色ずれ）の強さ'],
  ['screenSweepIntensity', '画面を横切るスイープ光の強さ'],
  ['screenSweepSpeed', 'スイープ光の速さ'],
  ['screenBurstDrive', 'バーストを自動で駆動する量'],
  ['screenInterferenceIntensity', '干渉縞（信号ノイズ帯）の強さ'],
  // --- Expansion: Layer 1 core ---
  ['sphereRadius', '核球の基本半径'],
  ['jitter', '全体のランダムな震え（カオス）'],
  ['pulseAmplitude', '全体のパルス（脈動）の深さ'],
  ['layer1Volume', 'レイヤー1の体積密度'],
  ['layer1SourceCount', 'レイヤー1の発生源（球）の数'],
  ['layer1SourceSpread', 'レイヤー1の発生源の広がり'],
  // --- Expansion: Layer 2 motion / emitter / trail / spark ---
  ['layer2Complexity', 'レイヤー2のノイズの複雑さ'],
  ['layer2FlowFrequency', 'レイヤー2の流れの周波数（密度）'],
  ['layer2Evolution', 'レイヤー2のパターンが発展する速さ'],
  ['layer2Resistance', 'レイヤー2の空気抵抗（大きいほど鈍る）'],
  ['layer2Viscosity', 'レイヤー2の粘性（大きいほどねっとり）'],
  ['layer2Burst', 'レイヤー2のバースト（一斉の押し出し）の強さ'],
  ['layer2BurstConeWidth', 'レイヤー2のバーストの広がり（円錐の幅）'],
  ['layer2BurstSweepSpeed', 'レイヤー2のバースト掃引の速さ'],
  ['layer2CollisionRadius', 'レイヤー2のセルの半径（衝突判定）'],
  ['layer2FluidForce', 'レイヤー2の流体の力の効き'],
  ['layer2InteractionNeighbor', 'レイヤー2の隣接粒子との関係（反発⇔結束）'],
  ['layer2MoveWithWind', 'レイヤー2の風に乗って移動する割合'],
  ['layer2WindX', 'レイヤー2の風のX成分'],
  ['layer2WindY', 'レイヤー2の風のY成分'],
  ['layer2WindZ', 'レイヤー2の風のZ成分'],
  ['layer2SpinX', 'レイヤー2の回転X成分'],
  ['layer2SpinY', 'レイヤー2の回転Y成分'],
  ['layer2SpinZ', 'レイヤー2の回転Z成分'],
  ['layer2EmitterOrbitRadius', 'レイヤー2の発生源の公転半径'],
  ['layer2EmitterOrbitSpeed', 'レイヤー2の発生源の公転速度'],
  ['layer2EmitterPulseAmount', 'レイヤー2の発生源の脈動の量'],
  ['layer2SourceCount', 'レイヤー2の発生源の数'],
  ['layer2AuxCount', 'レイヤー2の補助粒子の放出数'],
  ['layer2AuxDiffusion', 'レイヤー2の補助粒子の拡散'],
  ['layer2AuxLife', 'レイヤー2の補助粒子の寿命'],
  ['layer2LifeSpread', 'レイヤー2の粒の寿命のばらつき'],
  ['layer2FlickerSpeed', 'レイヤー2のちらつきの速さ'],
  ['layer2Trail', 'レイヤー2の軌跡（トレイル）の強さ'],
  ['layer2TrailDrag', 'レイヤー2の軌跡の引きずり抵抗'],
  ['layer2TrailTurbulence', 'レイヤー2の軌跡の乱れ'],
  ['layer2VelocityAlpha', 'レイヤー2の速度で変わる不透明度'],
  ['layer2VelocityGlow', 'レイヤー2の速度で変わる発光'],
  ['layer2Streak', 'レイヤー2の速度方向への引き伸ばし'],
  ['layer2GeomScale3D', 'レイヤー2の形状の拡縮（3D）'],
  ['layer2ConnectionSoftness', 'レイヤー2の線の輪郭の柔らかさ'],
  ['layer2LineShimmer', 'レイヤー2の線のきらめき'],
  ['layer2SparkCount', 'レイヤー2の火花の数'],
  ['layer2OctaveMult', 'レイヤー2のノイズのオクターブ重ねの効き'],
  // --- Expansion: Layer 2 reaction-diffusion / physarum ---
  ['layer2ReactionOpacity', 'レイヤー2の反応拡散パターンの不透明度'],
  ['layer2ReactionFeed', 'レイヤー2の反応拡散の供給率（模様の育ち方）'],
  ['layer2ReactionKill', 'レイヤー2の反応拡散の除去率（模様の消え方）'],
  ['layer2ReactionScale', 'レイヤー2の反応拡散パターンの細かさ'],
  ['layer2ReactionWarp', 'レイヤー2の反応拡散の歪み'],
  ['layer2ReactionFhnEpsilon', 'レイヤー2のFHN波の時間分離（ε、小さいほど波が鋭い）'],
  ['layer2PhysarumOpacity', 'レイヤー2の粘菌ネットワークの不透明度'],
  ['layer2PhysarumSensorAngle', 'レイヤー2の粘菌のセンサー角度'],
  ['layer2PhysarumSensorDistance', 'レイヤー2の粘菌のセンサー距離'],
  ['layer2PhysarumTurnSpeed', 'レイヤー2の粘菌の旋回の速さ'],
  ['layer2PhysarumSpeed', 'レイヤー2の粘菌エージェントの移動の速さ'],
  ['layer2PhysarumDeposit', 'レイヤー2の粘菌の痕跡の沈着量'],
  ['layer2PhysarumDecay', 'レイヤー2の粘菌の痕跡の残り方（大きいほど長く残る）'],
  ['layer2DlaWalkers', 'レイヤー2のDLAウォーカー数'],
  ['layer2DlaSteps', 'レイヤー2のDLAの成長ステップ数'],
  ['layer2DlaStickiness', 'レイヤー2のDLAの付着確率（低いほど疎で稲妻状、高いほど密）'],
  ['layer2DlaThickness', 'レイヤー2のDLAの枝の太さ'],
  ['layer2DlaThicknessDecay', 'レイヤー2のDLAの外周ほど細くなる度合い'],
  ['layer2DlaOpacity', 'レイヤー2のDLA凝集体の不透明度'],
  ['layer2LsysDepth', 'レイヤー2のLシステムの再帰の深さ（書き換え回数）'],
  ['layer2LsysAngle', 'レイヤー2のLシステムの分岐角（度）'],
  ['layer2LsysLengthDecay', 'レイヤー2のLシステムの枝の短縮率'],
  ['layer2LsysSeed', 'レイヤー2のLシステムの乱数シード（稲妻の形が変わる）'],
  ['layer2LsysWind', 'レイヤー2のLシステムの風揺れの量'],
  ['layer2LsysCurvature', 'レイヤー2のLシステムの湾曲（度/ステップ）'],
  ['layer2LsysOpacity', 'レイヤー2のLシステム線画の不透明度'],
  ['layer2RaymarchScale', 'レイヤー2のレイマーチング描画スケール（重い処理です）'],
  ['layer2RaymarchSteps', 'レイヤー2のレイマーチング最大ステップ数（重い処理です）'],
  ['layer2RaymarchPower', 'レイヤー2のマンデルバルブの冪（重い処理です）'],
  ['layer2RaymarchRotation', 'レイヤー2のレイマーチングSDFの回転速度'],
  ['layer2RaymarchDistance', 'レイヤー2のレイマーチングSDFの距離倍率'],
  ['layer2RaymarchOpacity', 'レイヤー2のレイマーチングSDFの不透明度'],
  // --- Expansion: Layer 3 motion / emitter / trail / spark ---
  ['layer3Complexity', 'レイヤー3のノイズの複雑さ'],
  ['layer3FlowFrequency', 'レイヤー3の流れの周波数（密度）'],
  ['layer3Evolution', 'レイヤー3のパターンが発展する速さ'],
  ['layer3Resistance', 'レイヤー3の空気抵抗（大きいほど鈍る）'],
  ['layer3Viscosity', 'レイヤー3の粘性（大きいほどねっとり）'],
  ['layer3Burst', 'レイヤー3のバースト（一斉の押し出し）の強さ'],
  ['layer3BurstConeWidth', 'レイヤー3のバーストの広がり（円錐の幅）'],
  ['layer3BurstSweepSpeed', 'レイヤー3のバースト掃引の速さ'],
  ['layer3CollisionRadius', 'レイヤー3のセルの半径（衝突判定）'],
  ['layer3FluidForce', 'レイヤー3の流体の力の効き'],
  ['layer3InteractionNeighbor', 'レイヤー3の隣接粒子との関係（反発⇔結束）'],
  ['layer3MoveWithWind', 'レイヤー3の風に乗って移動する割合'],
  ['layer3WindX', 'レイヤー3の風のX成分'],
  ['layer3WindY', 'レイヤー3の風のY成分'],
  ['layer3WindZ', 'レイヤー3の風のZ成分'],
  ['layer3SpinX', 'レイヤー3の回転X成分'],
  ['layer3SpinY', 'レイヤー3の回転Y成分'],
  ['layer3SpinZ', 'レイヤー3の回転Z成分'],
  ['layer3EmitterOrbitRadius', 'レイヤー3の発生源の公転半径'],
  ['layer3EmitterOrbitSpeed', 'レイヤー3の発生源の公転速度'],
  ['layer3EmitterPulseAmount', 'レイヤー3の発生源の脈動の量'],
  ['layer3SourceCount', 'レイヤー3の発生源の数'],
  ['layer3AuxCount', 'レイヤー3の補助粒子の放出数'],
  ['layer3AuxDiffusion', 'レイヤー3の補助粒子の拡散'],
  ['layer3AuxLife', 'レイヤー3の補助粒子の寿命'],
  ['layer3LifeSpread', 'レイヤー3の粒の寿命のばらつき'],
  ['layer3FlickerSpeed', 'レイヤー3のちらつきの速さ'],
  ['layer3Trail', 'レイヤー3の軌跡（トレイル）の強さ'],
  ['layer3TrailDrag', 'レイヤー3の軌跡の引きずり抵抗'],
  ['layer3TrailTurbulence', 'レイヤー3の軌跡の乱れ'],
  ['layer3VelocityAlpha', 'レイヤー3の速度で変わる不透明度'],
  ['layer3VelocityGlow', 'レイヤー3の速度で変わる発光'],
  ['layer3Streak', 'レイヤー3の速度方向への引き伸ばし'],
  ['layer3GeomScale3D', 'レイヤー3の形状の拡縮（3D）'],
  ['layer3ConnectionSoftness', 'レイヤー3の線の輪郭の柔らかさ'],
  ['layer3LineShimmer', 'レイヤー3の線のきらめき'],
  ['layer3SparkCount', 'レイヤー3の火花の数'],
  ['layer3OctaveMult', 'レイヤー3のノイズのオクターブ重ねの効き'],
  // --- Expansion: Layer 3 reaction-diffusion / physarum ---
  ['layer3ReactionOpacity', 'レイヤー3の反応拡散パターンの不透明度'],
  ['layer3ReactionFeed', 'レイヤー3の反応拡散の供給率（模様の育ち方）'],
  ['layer3ReactionKill', 'レイヤー3の反応拡散の除去率（模様の消え方）'],
  ['layer3ReactionScale', 'レイヤー3の反応拡散パターンの細かさ'],
  ['layer3ReactionWarp', 'レイヤー3の反応拡散の歪み'],
  ['layer3ReactionFhnEpsilon', 'レイヤー3のFHN波の時間分離（ε、小さいほど波が鋭い）'],
  ['layer3PhysarumOpacity', 'レイヤー3の粘菌ネットワークの不透明度'],
  ['layer3PhysarumSensorAngle', 'レイヤー3の粘菌のセンサー角度'],
  ['layer3PhysarumSensorDistance', 'レイヤー3の粘菌のセンサー距離'],
  ['layer3PhysarumTurnSpeed', 'レイヤー3の粘菌の旋回の速さ'],
  ['layer3PhysarumSpeed', 'レイヤー3の粘菌エージェントの移動の速さ'],
  ['layer3PhysarumDeposit', 'レイヤー3の粘菌の痕跡の沈着量'],
  ['layer3PhysarumDecay', 'レイヤー3の粘菌の痕跡の残り方（大きいほど長く残る）'],
  ['layer3DlaWalkers', 'レイヤー3のDLAウォーカー数'],
  ['layer3DlaSteps', 'レイヤー3のDLAの成長ステップ数'],
  ['layer3DlaStickiness', 'レイヤー3のDLAの付着確率（低いほど疎で稲妻状、高いほど密）'],
  ['layer3DlaThickness', 'レイヤー3のDLAの枝の太さ'],
  ['layer3DlaThicknessDecay', 'レイヤー3のDLAの外周ほど細くなる度合い'],
  ['layer3DlaOpacity', 'レイヤー3のDLA凝集体の不透明度'],
  ['layer3LsysDepth', 'レイヤー3のLシステムの再帰の深さ（書き換え回数）'],
  ['layer3LsysAngle', 'レイヤー3のLシステムの分岐角（度）'],
  ['layer3LsysLengthDecay', 'レイヤー3のLシステムの枝の短縮率'],
  ['layer3LsysSeed', 'レイヤー3のLシステムの乱数シード（稲妻の形が変わる）'],
  ['layer3LsysWind', 'レイヤー3のLシステムの風揺れの量'],
  ['layer3LsysCurvature', 'レイヤー3のLシステムの湾曲（度/ステップ）'],
  ['layer3LsysOpacity', 'レイヤー3のLシステム線画の不透明度'],
  ['layer3RaymarchScale', 'レイヤー3のレイマーチング描画スケール（重い処理です）'],
  ['layer3RaymarchSteps', 'レイヤー3のレイマーチング最大ステップ数（重い処理です）'],
  ['layer3RaymarchPower', 'レイヤー3のマンデルバルブの冪（重い処理です）'],
  ['layer3RaymarchRotation', 'レイヤー3のレイマーチングSDFの回転速度'],
  ['layer3RaymarchDistance', 'レイヤー3のレイマーチングSDFの距離倍率'],
  ['layer3RaymarchOpacity', 'レイヤー3のレイマーチングSDFの不透明度'],
  // --- Expansion: GPGPU forces / behaviour / kuramoto / levy ---
  ['gpgpuAttractorStrength', 'GPGPUアトラクタの引き寄せの強さ'],
  ['gpgpuCurlScale', 'GPGPUの渦（カール）の細かさ'],
  ['gpgpuVFieldStrength', 'GPGPUベクトル場（流れ場）の強さ'],
  ['gpgpuGravity', 'GPGPU粒子の重力'],
  ['gpgpuTurbulence', 'GPGPUの乱流の強さ'],
  ['gpgpuBounce', 'GPGPU粒子が境界で跳ね返る係数'],
  ['gpgpuWindStrength', 'GPGPUの風の強さ'],
  ['gpgpuWindGust', 'GPGPUの風の息づき（強弱の揺らぎ）'],
  ['gpgpuVortexStrength', 'GPGPUの渦（ボルテックス）の回転力'],
  ['gpgpuBoidsAlignment', 'GPGPU群れの整列の強さ'],
  ['gpgpuBoidsCohesion', 'GPGPU群れの結束の強さ'],
  ['gpgpuBoidsSeparation', 'GPGPU群れの分離の強さ'],
  ['gpgpuSphPressure', 'GPGPU流体（SPH）の圧力'],
  ['gpgpuSphViscosity', 'GPGPU流体（SPH）の粘性'],
  ['gpgpuFluidStrength', 'GPGPU流体アドベクションの強さ'],
  ['gpgpuFluidInfluence', 'GPGPU流体が粒子へ与える影響'],
  ['gpgpuMagneticStrength', 'GPGPU磁場の強さ'],
  ['gpgpuWellStrength', 'GPGPU重力井戸の引き込みの強さ'],
  ['gpgpuWellOrbit', 'GPGPU重力井戸の周りを回る力'],
  ['gpgpuNBodyStrength', 'GPGPUのN体相互作用の強さ'],
  ['gpgpuSpringStrength', 'GPGPUバネ（初期位置へ戻る力）の強さ'],
  ['gpgpuElasticStrength', 'GPGPU弾性（形を保つ力）の強さ'],
  ['gpgpuMouseStrength', 'GPGPUのマウスへの引力・斥力の強さ'],
  ['gpgpuAudioBlast', 'GPGPUの音声で弾ける量'],
  ['gpgpuAgeMax', 'GPGPU粒子の寿命（秒）'],
  ['gpgpuTrailLength', 'GPGPU軌跡の長さ'],
  ['gpgpuTrailFade', 'GPGPU軌跡の消え方'],
  ['gpgpuGeomScale', 'GPGPU形状全体の拡縮'],
  ['gpgpuTubeRadius', 'GPGPUチューブ描画の太さ'],
  ['gpgpuTubeOpacity', 'GPGPUチューブ描画の不透明度'],
  ['gpgpuLevyStrength', 'GPGPUのLévyフライトの跳躍の大きさ'],
  ['gpgpuLevyRate', 'GPGPUのLévyフライトの跳躍の頻度'],
  ['gpgpuKuramotoCoupling', 'GPGPU蔵本モデルの結合の強さ（位相同期）'],
  ['gpgpuKuramotoSpread', 'GPGPU蔵本モデルの固有振動数のばらつき'],
  ['gpgpuKuramotoInfluence', 'GPGPU位相同期が大きさ・明るさへ与える影響'],
  ['gpgpuParticleLifeSpecies', 'GPGPU Particle Lifeの種の数'],
  ['gpgpuParticleLifeStrength', 'GPGPU Particle Lifeの相互作用の強さ'],
  ['gpgpuParticleLifeRadius', 'GPGPU Particle Lifeの相互作用半径'],
  ['gpgpuParticleLifeFriction', 'GPGPU Particle Lifeの摩擦（小さいほど凝縮）'],
  // --- Expansion: post/screen extras + GPGPU field/fluid/age details ---
  ['postDofFocalLength', '被写界深度の焦点距離（短いほどボケが強い）'],
  ['postSlitScanCycle', 'スリットスキャンの更新周期'],
  ['screenScanlineDensity', '走査線の細かさ（本数）'],
  ['screenImpactFlashIntensity', '衝撃時の画面フラッシュの強さ'],
  ['screenSplitOffset', '信号スプリットのずらし幅'],
  ['screenBurstNoiseBoost', 'バースト時に増えるノイズの量'],
  ['screenBurstFlashBoost', 'バースト時に増えるフラッシュの量'],
  ['gpgpuVFieldScale', 'GPGPUベクトル場の細かさ'],
  ['gpgpuBounceRadius', 'GPGPU粒子が跳ね返る境界球の半径'],
  ['gpgpuWindX', 'GPGPUの風の向きX成分'],
  ['gpgpuWindY', 'GPGPUの風の向きY成分'],
  ['gpgpuWindZ', 'GPGPUの風の向きZ成分'],
  ['gpgpuSphRadius', 'GPGPU流体（SPH）の相互作用半径'],
  ['gpgpuSphRestDensity', 'GPGPU流体（SPH）の基準密度'],
  ['gpgpuFluidDiffuse', 'GPGPU流体の拡散（にじみ）の量'],
  ['gpgpuFluidDecay', 'GPGPU流体フィールドの減衰'],
  ['gpgpuFluidScale', 'GPGPU流体フィールドの細かさ'],
  ['gpgpuAgeFadeIn', 'GPGPU粒子が生まれた直後のフェードイン'],
  ['gpgpuAgeFadeOut', 'GPGPU粒子が消える直前のフェードアウト'],
];

const BOOLS: BoolDef[] = [
  ['layer1Enabled', 'レイヤー1の表示'],
  ['layer2Enabled', 'レイヤー2の表示'],
  ['layer3Enabled', 'レイヤー3の表示'],
  ['layer2ConnectionEnabled', 'レイヤー2の線（接続線）の表示'],
  ['layer3ConnectionEnabled', 'レイヤー3の線（接続線）の表示'],
  ['layer2WarpEnabled', 'レイヤー2のドメインワープ'],
  ['layer3WarpEnabled', 'レイヤー3のドメインワープ'],
  ['gpgpuEnabled', 'GPGPU粒子の有効化'],
  ['gpgpuTubeEnabled', 'GPGPUチューブ描画（重い）'],
  ['postBloomEnabled', '光のにじみ（ブルーム）'],
  ['postKaleidoscopeEnabled', '万華鏡エフェクト'],
  ['postFeedbackEnabled', '画面残像エフェクト'],
  ['postNoiseEnabled', 'ノイズ（ grain）エフェクト'],
  ['postVignetteEnabled', '周辺減光（ビネット）'],
  // --- Expansion 2026-11-11: feature toggles ---
  ['ambientEnabled', '漂う微粒子（アンビエント）の表示'],
  ['depthFogEnabled', '奥行きフォグ'],
  ['postDofEnabled', '被写界深度（ボケ）'],
  ['postSlitScanEnabled', 'スリットスキャン'],
  ['gpgpuCurlEnabled', 'GPGPUの渦（カール）'],
  ['gpgpuBoidsEnabled', 'GPGPU群れ（ボイド）'],
  ['gpgpuAttractorEnabled', 'GPGPUアトラクタ'],
  ['gpgpuVortexEnabled', 'GPGPU渦（ボルテックス）'],
  ['gpgpuWindEnabled', 'GPGPUの風'],
  ['gpgpuMagneticEnabled', 'GPGPU磁場'],
  ['gpgpuWellEnabled', 'GPGPU重力井戸'],
  ['gpgpuNBodyEnabled', 'GPGPUのN体相互作用'],
  ['gpgpuSpringEnabled', 'GPGPUバネ'],
  ['gpgpuFluidEnabled', 'GPGPU流体アドベクション'],
  ['gpgpuKuramotoEnabled', 'GPGPU蔵本モデル（位相同期）'],
  ['gpgpuParticleLifeEnabled', 'GPGPU Particle Life（種間相互作用）'],
  ['gpgpuLevyEnabled', 'GPGPUのLévyフライト'],
  ['gpgpuTrailEnabled', 'GPGPU軌跡描画'],
  ['gpgpuRibbonEnabled', 'GPGPUリボン描画'],
  ['gpgpuStreakEnabled', 'GPGPUストリーク（速度線）描画'],
  ['gpgpuAgeEnabled', 'GPGPU粒子の寿命（エイジ）'],
];

// Curated expressive subset of the 198 motion types — the ones a person
// would plausibly ask for by mood or shape. Verified against Layer2Type.
const MOTION_VALUES = [
  'flow', 'vortex', 'spiral_motion', 'orbit', 'wave', 'gyro', 'echo_ring',
  'tidal_lock', 'tessellate', 'mandala', 'kaleidoscope', 'torus_knot',
  'moebius', 'rose_curve', 'epicycle', 'filament', 'braidshell', 'caustic',
  'fanout', 'halo_bloom', 'dust_plume', 'mist_ribbon', 'flock_drift',
  'vortex_sheet', 'interference_wave', 'ribbon_veil', 'shard_debris',
  'aura_shell', 'liquid_smear', 'mesh_weave', 'ink_bleed', 'plasma_thread',
  'ashfall', 'pulse_breathing', 'collapse_fracture', 'orbit_swarm',
  'braid_stream', 'surface_shell', 'growth_field', 'reaction_diffusion',
  'volume_fog', 'crystal_aggregate', 'voxel_lattice', 'contour_echo',
  'paint_daubs', 'skin_lattice', 'stipple_field', 'crawl_seep',
  'erosion_trail', 'fiber_field',
  // Expansion 2026-11-11: procedural-system types that pair with the newly
  // registered reaction-diffusion / physarum / fog keys, plus major basics.
  'physarum', 'dla', 'l-system', 'raymarch', 'biofilm_skin', 'cellular_front', 'corrosion_front',
  'crystal_deposition', 'vortex_transport', 'pressure_cells', 'condense_field',
  'sublimate_cloud', 'glyph_weave', 'labyrinth', 'cellular', 'smoke', 'liquid',
  'wind', 'gravity', 'helix', 'lattice', 'crystal', 'quasicrystal', 'hopf',
] as const;

const ENUMS: { key: keyof ParticleConfig; gloss: string; values: readonly string[] }[] = [
  { key: 'layer2Type', gloss: 'レイヤー2の動きの種類', values: MOTION_VALUES },
  { key: 'layer3Type', gloss: 'レイヤー3の動きの種類', values: MOTION_VALUES },
  {
    key: 'layer2Source', gloss: 'レイヤー2の発生形状',
    values: ['sphere', 'ring', 'grid', 'cube', 'cone', 'disc', 'spiral', 'plane', 'text', 'image', 'video'],
  },
  {
    key: 'layer3Source', gloss: 'レイヤー3の発生形状',
    values: ['sphere', 'ring', 'grid', 'cube', 'cylinder', 'torus', 'spiral', 'plane', 'text', 'image', 'video'],
  },
  { key: 'gpgpuAttractorType', gloss: 'GPGPUアトラクタの種類', values: ['lorenz', 'thomas', 'rossler', 'halvorsen', 'chen', 'lu', 'aizawa', 'sprott', 'rabinovich', 'dejong', 'ikeda', 'chua'] },
  { key: 'gpgpuParticleLifePreset', gloss: 'GPGPU Particle Lifeの行列プリセット', values: ['cells', 'snakes', 'community', 'random'] },
  { key: 'gpgpuVFieldType', gloss: 'GPGPUベクトル場の種類', values: ['spiral', 'dipole', 'source', 'saddle', 'abc', 'gyre', 'worley'] },
  // --- Expansion 2026-11-11: major enums (value sets copied from the config types) ---
  { key: 'layer2MaterialStyle', gloss: 'レイヤー2の素材感（マテリアル）', values: ['classic', 'glass', 'hologram', 'chrome', 'halftone'] },
  { key: 'layer3MaterialStyle', gloss: 'レイヤー3の素材感（マテリアル）', values: ['classic', 'glass', 'hologram', 'chrome', 'halftone'] },
  { key: 'layer2TemporalProfile', gloss: 'レイヤー2の時間変化の型', values: ['steady', 'growth', 'decay', 'crystallize', 'melt', 'rupture', 'oscillate', 'accrete', 'evaporate', 'shed', 'resonate', 'condense', 'ignite', 'unravel', 'accumulate', 'exfoliate', 'phase_shift', 'inhale', 'rewrite', 'saturate', 'delaminate', 'anneal', 'bifurcate', 'recur', 'percolate', 'slump', 'rebound', 'fissure', 'ossify', 'intermittent', 'hysteresis', 'fatigue', 'recover', 'erupt', 'latency', 'emerge', 'collapse', 'regrow', 'invert'] },
  { key: 'layer3TemporalProfile', gloss: 'レイヤー3の時間変化の型', values: ['steady', 'growth', 'decay', 'crystallize', 'melt', 'rupture', 'oscillate', 'accrete', 'evaporate', 'shed', 'resonate', 'condense', 'ignite', 'unravel', 'accumulate', 'exfoliate', 'phase_shift', 'inhale', 'rewrite', 'saturate', 'delaminate', 'anneal', 'bifurcate', 'recur', 'percolate', 'slump', 'rebound', 'fissure', 'ossify', 'intermittent', 'hysteresis', 'fatigue', 'recover', 'erupt', 'latency', 'emerge', 'collapse', 'regrow', 'invert'] },
  { key: 'layer2GeomMode3D', gloss: 'レイヤー2の3D形状', values: ['billboard', 'cube', 'tetra', 'icosa'] },
  { key: 'layer3GeomMode3D', gloss: 'レイヤー3の3D形状', values: ['billboard', 'cube', 'tetra', 'icosa'] },
  { key: 'layer2ReactionModel', gloss: 'レイヤー2の反応拡散モデル', values: ['gray-scott', 'fhn', 'lenia'] },
  { key: 'layer3ReactionModel', gloss: 'レイヤー3の反応拡散モデル', values: ['gray-scott', 'fhn', 'lenia'] },
  { key: 'layer2ReactionLeniaKernel', gloss: 'レイヤー2のLeniaカーネル形状', values: ['ring', 'double', 'blob'] },
  { key: 'layer3ReactionLeniaKernel', gloss: 'レイヤー3のLeniaカーネル形状', values: ['ring', 'double', 'blob'] },
  { key: 'layer2PhysarumDisplay', gloss: 'レイヤー2の粘菌の表示方法', values: ['sheet', 'sphere'] },
  { key: 'layer3PhysarumDisplay', gloss: 'レイヤー3の粘菌の表示方法', values: ['sheet', 'sphere'] },
  { key: 'layer2DlaSeedShape', gloss: 'レイヤー2のDLAの種の形', values: ['point', 'line', 'ring', 'multi'] },
  { key: 'layer3DlaSeedShape', gloss: 'レイヤー3のDLAの種の形', values: ['point', 'line', 'ring', 'multi'] },
  { key: 'layer2LsysPreset', gloss: 'レイヤー2のLシステムのルールセット', values: ['plant', 'fern', 'tree', 'coral', 'lightning'] },
  { key: 'layer3LsysPreset', gloss: 'レイヤー3のLシステムのルールセット', values: ['plant', 'fern', 'tree', 'coral', 'lightning'] },
  { key: 'layer2RaymarchShape', gloss: 'レイヤー2のレイマーチングSDFの形状（重い処理です）', values: ['mandelbulb', 'blobs', 'columns'] },
  { key: 'layer3RaymarchShape', gloss: 'レイヤー3のレイマーチングSDFの形状（重い処理です）', values: ['mandelbulb', 'blobs', 'columns'] },
];

// Ranges for numeric keys the panel does not expose as sliders.
const RANGE_OVERRIDES: Partial<Record<keyof ParticleConfig, { min: number; max: number; step: number }>> = {
  layer1Count: { min: 100, max: 500000, step: 100 },
  layer2Count: { min: 0, max: 500000, step: 100 },
  layer3Count: { min: 0, max: 500000, step: 100 },
  gpgpuCount: { min: 1024, max: 262144, step: 1024 },
  layer2TemporalSpeed: { min: 0, max: 3, step: 0.01 },
  layer3TemporalSpeed: { min: 0, max: 3, step: 0.01 },
  ambientSpread: { min: 10, max: 5000, step: 10 },
  layer2AuxCount: { min: 100, max: 200000, step: 100 },
  layer3AuxCount: { min: 100, max: 200000, step: 100 },
};

const catalogRange = new Map<string, { min: number; max: number; step: number }>();
for (const e of PARAMETER_CATALOG) catalogRange.set(e.key as string, { min: e.min, max: e.max, step: e.step });

export const AI_PARAM_SPECS: AiParamSpec[] = [
  ...NUMS.map(([key, gloss]): AiParamSpec => {
    const r = RANGE_OVERRIDES[key] ?? catalogRange.get(key as string) ?? { min: 0, max: 1, step: 0.01 };
    return { key, kind: 'number', gloss, min: r.min, max: r.max, step: r.step };
  }),
  ...BOOLS.map(([key, gloss]): AiParamSpec => ({ key, kind: 'boolean', gloss })),
  ...ENUMS.map((e): AiParamSpec => ({ key: e.key, kind: 'enum', gloss: e.gloss, values: e.values })),
];

export const AI_SPEC_BY_KEY = new Map<string, AiParamSpec>(
  AI_PARAM_SPECS.map((s) => [s.key as string, s]),
);

export const AI_MAX_PATCH_KEYS = 40;

function fmtVal(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v);
}

/** Compact catalog + current values for the system prompt. */
export function buildAiContext(config: ParticleConfig): string {
  const lines: string[] = [];
  for (const s of AI_PARAM_SPECS) {
    const cur = fmtVal((config as unknown as Record<string, unknown>)[s.key as string]);
    if (s.kind === 'number') lines.push(`${s.key} (${s.min}..${s.max})=${cur} ${s.gloss}`);
    else if (s.kind === 'boolean') lines.push(`${s.key} (T/F)=${cur} ${s.gloss}`);
    else lines.push(`${s.key} (${(s.values ?? []).join('|')})=${cur} ${s.gloss}`);
  }
  return lines.join('\n');
}

export function buildAiSystemPrompt(config: ParticleConfig): string {
  return [
    'あなたはモノクロ3Dパーティクル生成アプリ「Kalokagathia」の操作アシスタントです。',
    'ユーザーの日本語の指示を受けて、現在のパラメータへの変更パッチを作ります。',
    '',
    '出力は必ず次のJSONだけにしてください（説明文やコードフェンスは付けない）:',
    '{"patch": {"キー": 値, ...}, "summary": "何をどう変えたかの日本語要約（1〜2文）"}',
    '',
    'ルール:',
    '- patch のキーは下記カタログにあるものだけを使う。カタログ外のキーは絶対に出さない。',
    '- 数値は範囲内に収める。「もっと／少し」などの相対指示は現在値からの増減で計算する。',
    '- 変更は最大でも15キー程度に絞り、指示の意図に直結するものだけを変える。',
    '- 雰囲気の指示（静か、激しい、混沌、夢のような等）は、速さ・数・広がり・残像・にじみ等の組み合わせで表現する。',
    '- プリセットの新規作成を求められたら patch は空にし、summary で「新規作成は上の『プリセット生成』モードでできます」と案内する（このモードでは現在の見た目の調整だけを行う）。',
    '- 調整と無関係な話題には patch を空にし、summary で短く断る。',
    '',
    'カタログ（キー / 制約 / 現在値 / 意味）:',
    buildAiContext(config),
  ].join('\n');
}

export interface AiAppliedChange {
  key: keyof ParticleConfig;
  from: unknown;
  to: number | boolean | string;
}

export interface AiValidation {
  applied: AiAppliedChange[];
  rejected: string[];
}

/** Validate a model-produced patch against the catalog. Never throws. */
export function validateAiPatch(raw: unknown, config: ParticleConfig): AiValidation {
  const applied: AiAppliedChange[] = [];
  const rejected: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { applied, rejected: ['patch がオブジェクトではありません'] };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (applied.length >= AI_MAX_PATCH_KEYS) { rejected.push(`${key}: 上限超過`); continue; }
    const spec = AI_SPEC_BY_KEY.get(key);
    if (!spec) { rejected.push(`${key}: カタログ外`); continue; }
    const from = (config as unknown as Record<string, unknown>)[key];
    if (spec.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) { rejected.push(`${key}: 数値でない`); continue; }
      const clamped = Math.min(spec.max ?? value, Math.max(spec.min ?? value, value));
      const step = spec.step ?? 0;
      const snapped = step > 0 ? Math.round(clamped / step) * step : clamped;
      const to = Math.round(snapped * 10000) / 10000;
      if (to !== from) applied.push({ key: spec.key, from, to });
    } else if (spec.kind === 'boolean') {
      if (typeof value !== 'boolean') { rejected.push(`${key}: 真偽値でない`); continue; }
      if (value !== from) applied.push({ key: spec.key, from, to: value });
    } else {
      if (typeof value !== 'string' || !(spec.values ?? []).includes(value)) { rejected.push(`${key}: 選択肢にない値`); continue; }
      if (value !== from) applied.push({ key: spec.key, from, to: value });
    }
  }
  return { applied, rejected };
}

/** Parse the model's reply text into {patch, summary}; tolerant of fences. */
export function parseAiReply(text: string): { patch: Record<string, unknown>; summary: string } | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(t.slice(start, end + 1)) as { patch?: unknown; summary?: unknown };
    if (!j || typeof j !== 'object') return null;
    return {
      patch: (j.patch && typeof j.patch === 'object' && !Array.isArray(j.patch)) ? j.patch as Record<string, unknown> : {},
      summary: typeof j.summary === 'string' ? j.summary : '',
    };
  } catch {
    return null;
  }
}
