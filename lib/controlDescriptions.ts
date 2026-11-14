// Descriptions for the non-numeric controls (Renewal Phase 4, 2026-11-14).
// The numeric catalog rows get their text from lib/parameterDescriptions.ts;
// everything else in the deck — Toggle segmented controls, selects, and the
// main action buttons — is keyed here by its rendered label text, the same
// identifier the tooltip pass can see in the DOM. Layer 3 mirrors Layer 2
// (same resolver trick as parameterDescriptions): a "Layer 3 …" label falls
// back to the "Layer 2 …" entry, with the layer name swapped in the text.
//
// Inventory (source-level, 2026-11-14): 122 <Toggle> usages / 108 unique
// labels, 39 <select> usages. Controls whose label cannot be resolved to a
// unique meaning keep no tooltip (documented in the Phase 4 report).

export const CONTROL_DESCRIPTIONS: Record<string, string> = {
  // ---- layer tabs (shared Layer 2/3 structure) ----
  'Layer 2 Enabled': 'このレイヤー全体のオン/オフ。オフの間は下の設定も表示されない',
  'Layer 2 Engine': 'このレイヤーの描画エンジン（方式）の切替',
  'Draw Lines': '近い粒子同士を線で結ぶ表示のオン/オフ',
  'Line Style': '接続線のスタイル（実線/破線など）の切替',
  'Collision Mode': '粒子同士の衝突の扱い方の切替',
  'Floor Boundary': '床境界（下端での跳ね返り）のオン/オフ',
  'Burst Direction': 'バースト（弾け）の向きの切替',
  'Burst Wave': 'バーストの波形（かかり方）の切替',
  'Sprite Shape': '粒子のスプライト形状の切替',
  'Geometry Mode': '粒子の3D形状モードの切替',
  'Emit from Parents': '親粒子から子粒子を放出する機能のオン/オフ',
  'Emit Spark Bursts': '火花バースト放出のオン/オフ',
  'Ghost Trail': 'ゴーストトレイル（残像コピー）のオン/オフ',
  'SDF Shape Mode': 'SDF形状モードの切替',
  'Layer Repulsion': 'レイヤー間の反発のオン/オフ',
  'Emit Shape': '放出形状（エミッタの形）の切替',
  'Velocity Align': '速度方向へ粒子の向きを揃える機能のオン/オフ',
  'Core Visibility': '中心核（レイヤー1の核）の表示オン/オフ',
  'Particle Color': '粒子の色（白/黒）の切替',
  // ---- procedural mode specific controls ----
  'Profile': '時間変化プロファイル（成長・崩壊・結晶化など、時間の経過の型）の切替',
  'Model': '反応モデル（Gray-Scott／FitzHugh-Nagumo／Lenia）の切替',
  'Lenia Kernel（カーネル）': 'Leniaの畳み込みカーネル形状（ring／double／blob）の切替',
  'Display': 'このモードの表示方式の切替（例：Physarumは平面シート／球面）',
  'Seed Shape': '種（初期形状）の切替',
  'Shape': '形状の切替',
  'Shape（形状）': '形状の切替',
  'Preset': 'このモード用プリセット（設定一式）の切替',
  'Wireframe': 'ワイヤーフレーム表示のオン/オフ',
  'Outline': '輪郭表示のオン/オフ',
  'Material Style': '素材感（classic／glass／hologram／chrome／halftone）の切替',
  // ---- global display: basics ----
  'Background': '背景色（黒/白）の切替',
  'Particles': '粒子の色（白/黒）の切替',
  'Camera Control': 'カメラ操作モード（Auto／Hybrid／Manual）の切替',
  'View Mode': '表示モードの切替',
  'Viewport Quality': 'ビューポート品質の切替。重い場合は下げると軽くなる',
  'Quality Profile': '描画品質プロファイルの切替',
  'Stack Profile': 'ポスト処理スタックのプロファイル切替',
  'Compute Backend': '計算バックエンドの切替',
  'Execution Diagnostics': '実行診断オーバーレイの表示オン/オフ',
  'Verbose Diagnostics': '詳細診断ログのオン/オフ',
  // ---- post FX / screen FX toggles ----
  'Bloom': 'ブルーム（明部のにじみ発光）のオン/オフ',
  'Chromatic Aberration': '色収差（縁の色ずれ）のオン/オフ',
  'Depth of Field': '被写界深度（ボケ）のオン/オフ',
  'Kaleidoscope / Mirror': '万華鏡（対称分割）のオン/オフ',
  'Feedback (GPU)': 'GPUフィードバック残像（前フレームを残して重ねる）のオン/オフ',
  'Slit Scan (temporal bands)': 'スリットスキャン（帯ごとに時間をずらす）のオン/オフ',
  'Vignette': 'ビネット（画面周辺を落とす）のオン/オフ',
  'Noise': 'フィルムグレイン（画面ノイズ）のオン/オフ',
  'Depth Fog': '奥行きフォグ（遠くを霞ませる）のオン/オフ',
  'Brightness / Contrast': '画面の明るさ・コントラスト調整のオン/オフ',
  'Impact FX': '衝撃時の画面フラッシュなどのオン/オフ',
  // ---- GPGPU master / forces ----
  'GPGPU Enabled': 'GPGPUレイヤー全体のオン/オフ',
  'N-Body Gravity': 'N体相互作用（全粒子が引き合う重力計算）のオン/オフ。重い処理',
  'Velocity Color': '粒子の速度を色相に変換して表示する機能のオン/オフ',
  'Life System': 'GPGPU粒子の寿命（エイジ）管理のオン/オフ',
  'Curl Noise': 'カールノイズ（渦状の流れ場）の力のオン/オフ',
  'Boids Flocking': '群れ（ボイド：整列・結束・分離）の振る舞いのオン/オフ',
  'Strange Attractor': 'GPGPUアトラクタ（カオス軌道への引力）のオン/オフ',
  'Type': 'アトラクタの種類（Lorenz／Rössler／Thomas など12種）の切替',
  'Lévy Flight': 'Lévyフライト（時々大きく跳ぶランダムな跳躍）のオン/オフ',
  'Kuramoto Sync': '蔵本モデル（位相の同期）のオン/オフ',
  'Particle Life': 'Particle Life（種同士の引力・斥力で生態系のような振る舞い）のオン/オフ',
  'Vortex Field': '渦場（回転する流れ）のオン/オフ',
  'Wind Force': '風（一定方向の流れと突風）のオン/オフ',
  'Gravity Well': '重力井戸（中心への引力点）のオン/オフ',
  'Elastic Spring': '弾性バネ（粒子同士をバネでつなぐ力）のオン/オフ',
  'Magnetic Field': '磁場（ローレンツ力的に軌道を曲げる）のオン/オフ',
  'SPH Fluid': 'SPH流体（圧力・粘性による流体計算）のオン/オフ。重い処理',
  'Vector Field': 'ベクトル場（7種の流れパターン）のオン/オフ',
  'Field Type': 'ベクトル場の種類（螺旋／双極子／源泉／鞍点など）の切替',
  'Spring (to Spawn)': '発生位置へ引き戻すバネのオン/オフ',
  'Verlet Integration': 'Verlet積分（位置ベースの積分方式）への切替',
  'SDF Collider': 'SDF形状との衝突（コライダ）のオン/オフ',
  'Collider Mode': 'コライダの形状モードの切替',
  'Color over Lifetime': '寿命の進行で色を変える表示のオン/オフ',
  'Size over Lifetime': '寿命の進行で粒子の大きさを変える表示のオン/オフ',
  'Mouse Force': 'マウスへの引力・斥力のオン/オフ',
  'Mode': 'マウス力のモード（引き寄せ／反発／渦）の切替',
  'Depth Sort (Alpha)': '奥行き順ソート（透明描画の正確さ向上）のオン/オフ。重い処理',
  'Fluid Advection': '流体アドベクション（流れ場で粒子を運ぶ）のオン/オフ',
  'Ext. Force (Vortex)': '流体への外力（渦）のオン/オフ',
  'Custom Force (GLSL)': 'GLSLで書くカスタム力（上級者向け）のオン/オフ',
  // ---- GPGPU render styles ----
  'Motion Trail': '軌跡（トレイル）描画のオン/オフ',
  'Ribbon Trail': '帯状リボン描画のオン/オフ',
  'Tube Trail (Circular)': 'チューブ（立体的な帯）描画のオン/オフ。最も重い描画様式',
  'Smooth Tube Trail': '滑らかチューブ描画のオン/オフ',
  'Streak Rendering': '速度方向へ引き伸ばすストリーク描画のオン/オフ',
  'Metaballs (MC Surface)': 'マーチングキューブによるメタボール面表示のオン/オフ',
  'Volumetric (Ray March)': 'ボリューメトリック（レイマーチ）表示のオン/オフ',
  // ---- hybrid expression families ----
  'Hybrid Fiber Field': 'ハイブリッド表現（繊維フィールド）のオン/オフ',
  'Hybrid Granular Field': 'ハイブリッド表現（粒状フィールド）のオン/オフ',
  'Hybrid Membrane Surface': 'ハイブリッド表現（膜面）のオン/オフ',
  'Hybrid Patch Surface': 'ハイブリッド表現（パッチ面）のオン/オフ',
  'Hybrid SDF Surface': 'ハイブリッド表現（SDF面）のオン/オフ',
  // ---- product-pack detail editors (data-driven controls) ----
  'GPGPU Layer': 'GPGPUレイヤーのオン/オフ',
  'GPU Sorting': 'GPUソート（奥行き順の並び替え）のオン/オフ',
  'GPU Sort': 'GPUソート（奥行き順の並び替え）のオン/オフ',
  'Fluid Solver': '流体ソルバ（SPH）のオン/オフ',
  'Frame Carry Simulation': 'フレーム持ち越しシミュレーション（Verlet積分）のオン/オフ',
  'WebGPU Backend': 'WebGPUバックエンドのオン/オフ',
  'WebGPU': 'WebGPUバックエンドのオン/オフ',
  'Mouse Mode': 'マウス力のモード（反発／引き寄せ／周回）の切替',
  'Auto LOD': '自動LOD（負荷に応じた詳細度の自動調整）のオン/オフ',
  'Contact FX': 'レイヤー接触時の画面効果のオン/オフ',
  'Elastic Constraint': '弾性拘束のオン/オフ',
  'GPU Volume': 'GPUボリューム表示のオン/オフ',
  'Post Noise': 'ポストノイズ（画面ノイズ）のオン/オフ',
  'Voxel Wireframe': 'ボクセルのワイヤーフレーム表示のオン/オフ',
  // ---- audio tab ----
  'Audio Source': '音声入力ソースの切替（マイク／共有タブ／内蔵シンセ）',
  'Audio Link': '音声連動のオン/オフ',
  'Audio Reactive': '音声反応のオン/オフ',
  'Ambient Dust': 'アンビエント（漂う微粒子）レイヤーのオン/オフ',
  'Synth Scale': '内蔵シンセの音階の切替',
  'Synth Wave': '内蔵シンセの波形の切替',
  // ---- media sources ----
  'Invert Text Mask': 'テキストマスクの反転（文字の内側/外側を入れ替える）',
  'Invert Brightness': '画像の明るさの反転',
  // ---- play tab editors / misc ----
  'Recording Mode': '録画モードの切替（現在の見た目を通しで録る／シーケンスを通しで録る）',
  'Import Mode': 'プリセット読み込み時の扱い（追加／置き換え）の切替',
  'Drive Mode': 'シーケンス切り替えのドライブ方式の切替',
  'Drive Strength': 'シーケンスのドライブ（切り替えの強さのかかり方）の切替',
  'Sequence Drive': 'シーケンス再生に画面効果を連動させる機能のオン/オフ',
  'Delta-only Controls': '差分のある項目だけを対象にする切替',
  'X axis': 'XYパッドの横軸に割り当てるパラメータ',
  'Y axis': 'XYパッドの縦軸に割り当てるパラメータ',
  'Parent A': '交配の親Aに使うプリセット',
  'Parent B': '交配の親Bに使うプリセット',
  // ---- action buttons (exact rendered text) ----
  '現在のシーンを取り込む': 'いまの画面（設定）をタイムラインのテイクとして取り込む',
  '自動フェード': 'Deck A/B間を時間で自動フェードさせる',
  '出力ウィンドウを開く': '鑑賞・配信用の出力ウィンドウ（別窓）を開く',
  '再検出': 'GPUティアを再検出する',
  '診断する': 'GPU診断を実行する（ティアと推奨設定を確認）',
  '適用する': '選択した内容を現在の設定へ適用する',
  'Breed · 交配する': '親A・親Bを交配＋突然変異させて子プリセットを生成する',
  '● 録画開始': 'キャンバスの録画を開始する',
  'PNG連番を書き出す（ZIP）': '決定的レンダリングでPNG連番をZIP書き出しする',
  '古い履歴を消す': '古いテイク/履歴を削除する',
  'おすすめセットを追加': 'おすすめのルート（信号→パラメータ配線）一式を追加する',
  '＋ ルートを追加（信号 → パラメータ）': '音声などの信号をパラメータへ配線するルートを追加する',
  'MIDI機器に接続': 'MIDI機器に接続してパラメータ操作に使う',
  'ブリッジに接続': '外部ブリッジに接続する',
  'Spread を 0 にする（絶対配置）': '発生位置の広がりを0にして絶対配置にする',
  'PLY書き出し（GPGPU粒子）': 'GPGPU粒子の位置をPLY形式で書き出す',
  'SVG書き出し': '現在の見た目をSVG形式で書き出す',
};

// Note backlinks for label-keyed controls (UUIDs from the same mechanical
// extraction as lib/noteBacklinks.ts; only where a heading genuinely covers
// the control — everything else intentionally has no link).
export const CONTROL_NOTE_LINKS: Record<string, string> = {
  'Layer 2 Enabled': '00b63368-dc5d-4a1a-880e-d457a53f51f6', // 3レイヤー構成
  'Profile': '86dc9d64-a0dd-417c-b78f-42d26fc962dc', // 時間変化プロファイル
  'Model': '6aa1b6f0-874f-4401-ae1a-7eab93c208c9', // 反応モデル
  'Lenia Kernel（カーネル）': '722b09e1-cdf2-4feb-a739-8fb317f68916', // Lenia
  'Display': '23b69da7-aa8e-4da4-bd09-e68f0e406d36', // Physarum（粘菌）
  'Material Style': 'c60e5ec7-9c84-43c4-b5f4-6eea118ea3fd', // マテリアル（素材感）
  'Bloom': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4', // ポストエフェクトと画面効果
  'Chromatic Aberration': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Depth of Field': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Kaleidoscope / Mirror': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Feedback (GPU)': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Slit Scan (temporal bands)': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Vignette': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Noise': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Depth Fog': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Brightness / Contrast': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'Impact FX': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4',
  'GPGPU Enabled': 'a609f9d3-3443-4d4e-8a09-f84014f01f30', // GPGPU
  'N-Body Gravity': '834426fb-9b34-47d1-a93f-68d5848a635a', // GPGPUの力と振る舞い
  'Velocity Color': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Life System': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Curl Noise': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Boids Flocking': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Strange Attractor': 'e7b13888-c1cd-4705-bb74-c5ad493d72f7', // GPGPUアトラクタ12種
  'Type': 'e7b13888-c1cd-4705-bb74-c5ad493d72f7',
  'Lévy Flight': '86183fd8-6860-409b-b9f4-da6595da3972', // Lévyフライト
  'Kuramoto Sync': '9259dedc-532a-4d22-bf07-58ce1f7dc4fb', // 蔵本モデル
  'Particle Life': '23dc72f4-916c-47bc-8b7c-ecbb5ea89ff0', // Particle Life
  'Vortex Field': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Wind Force': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Gravity Well': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Elastic Spring': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Magnetic Field': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'SPH Fluid': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Vector Field': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Field Type': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Spring (to Spawn)': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Verlet Integration': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'SDF Collider': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Collider Mode': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Color over Lifetime': 'cc1b3b56-b10c-410c-a906-a2c392ab7c46', // 描画様式
  'Size over Lifetime': 'cc1b3b56-b10c-410c-a906-a2c392ab7c46',
  'Mouse Force': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Mode': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Depth Sort (Alpha)': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Fluid Advection': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Ext. Force (Vortex)': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Custom Force (GLSL)': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Motion Trail': 'cc1b3b56-b10c-410c-a906-a2c392ab7c46',
  'Ribbon Trail': 'cc1b3b56-b10c-410c-a906-a2c392ab7c46',
  'Tube Trail (Circular)': 'cc1b3b56-b10c-410c-a906-a2c392ab7c46',
  'Smooth Tube Trail': 'f91047a7-0ba0-4eb7-a6cf-f8c4cbd57393',
  'Streak Rendering': 'cc1b3b56-b10c-410c-a906-a2c392ab7c46',
  'Metaballs (MC Surface)': '51ca8320-c9cc-49e3-a916-e1ac7b40816c',
  'Volumetric (Ray March)': '653f4358-ed81-494b-bc56-17a06ff44cfd', // レイマーチングSDF
  'Audio Source': '7e950cee-5012-4218-b573-b3f2f3e64acb', // FFT・音声反応
  'Audio Link': '7e950cee-5012-4218-b573-b3f2f3e64acb',
  'Audio Reactive': '7e950cee-5012-4218-b573-b3f2f3e64acb',
  'Synth Scale': '7e950cee-5012-4218-b573-b3f2f3e64acb',
  'Synth Wave': '7e950cee-5012-4218-b573-b3f2f3e64acb',
  'Ambient Dust': '00b63368-dc5d-4a1a-880e-d457a53f51f6', // 3レイヤー構成
  'GPGPU Layer': 'a609f9d3-3443-4d4e-8a09-f84014f01f30', // GPGPU
  'GPU Sorting': '834426fb-9b34-47d1-a93f-68d5848a635a', // GPGPUの力と振る舞い
  'GPU Sort': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Fluid Solver': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Frame Carry Simulation': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Mouse Mode': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'Elastic Constraint': '834426fb-9b34-47d1-a93f-68d5848a635a',
  'GPU Volume': '653f4358-ed81-494b-bc56-17a06ff44cfd',
  'WebGPU Backend': '38898a50-45fb-42aa-beb5-49297632780c', // WebGPUを見送った理由
  'WebGPU': '38898a50-45fb-42aa-beb5-49297632780c',
  'Post Noise': 'd01275cb-1ff1-4ca2-a434-6dafe2a734d4', // ポストエフェクトと画面効果
  'Contact FX': '00b63368-dc5d-4a1a-880e-d457a53f51f6', // 3レイヤー構成（レイヤー間相互作用）
  'Recording Mode': 'ba7a5dd0-ef91-405e-afb4-6acebbfeb3f3', // 画像と動画の書き出し
  'Drive Mode': 'acbf5eb0-d4dd-48c6-afe5-c31e2a9a7105', // プリセットシーケンス
  'Drive Strength': 'acbf5eb0-d4dd-48c6-afe5-c31e2a9a7105',
  'Sequence Drive': 'acbf5eb0-d4dd-48c6-afe5-c31e2a9a7105',
  'Hybrid Fiber Field': '15ca2a5c-74ac-4bb8-b546-21ec74841c7c', // 繊維場（Fiber Field）
  'Hybrid Membrane Surface': '609106b7-c2f6-4766-afa3-b4a02293e547', // 膜（Membrane）
  'Hybrid Patch Surface': 'e679a2c6-d091-4487-899f-98ef119199b0', // 表面パッチ（Surface Patch）
  'Voxel Wireframe': '70d7456e-8367-4ae2-88e4-3661ab738830', // ボクセル格子（Voxel Lattice）
  'Breed · 交配する': '42805bf9-a1da-4f2d-aeb3-5b44e9b3b4ec', // 進化ラボ
  'Parent A': '42805bf9-a1da-4f2d-aeb3-5b44e9b3b4ec',
  'Parent B': '42805bf9-a1da-4f2d-aeb3-5b44e9b3b4ec',
};

// Descriptions + note links for config-key selects (generic enum editors
// expose the config key as aria-label).
export const CONTROL_KEY_DESCRIPTIONS: Record<string, string> = {
  layer2Source: 'レイヤー2の発生形状（ソース）',
  layer2Type: 'レイヤー2のモーション（動きの種類）',
  layer2SpriteMode: 'レイヤー2の粒子スプライト形状',
  layer2ConnectionStyle: 'レイヤー2の接続線スタイル',
  layer3Source: 'レイヤー3の発生形状（ソース）',
  layer3Type: 'レイヤー3のモーション（動きの種類）',
  layer3SpriteMode: 'レイヤー3の粒子スプライト形状',
  layer3ConnectionStyle: 'レイヤー3の接続線スタイル',
  gpgpuEmitShape: 'GPGPUの発生形状（エミッタの形）',
};

export const CONTROL_KEY_NOTE_LINKS: Record<string, string> = {
  layer2Source: '8a8b5795-fc25-4629-bf6f-08a4bff3e676', // 発生形状（ソース）
  layer2Type: 'bce302a7-ba7b-42f9-b20f-792378b3a1b8', // 描画システム（レイヤー2／3で選べる種類）
  layer2SpriteMode: 'c60e5ec7-9c84-43c4-b5f4-6eea118ea3fd', // マテリアル（素材感）
  layer2ConnectionStyle: '8d4a80fa-7a14-41aa-96c3-28eed78eae84', // 物理と流れ
  layer3Source: '8a8b5795-fc25-4629-bf6f-08a4bff3e676',
  layer3Type: 'bce302a7-ba7b-42f9-b20f-792378b3a1b8',
  layer3SpriteMode: 'c60e5ec7-9c84-43c4-b5f4-6eea118ea3fd',
  layer3ConnectionStyle: '8d4a80fa-7a14-41aa-96c3-28eed78eae84',
  gpgpuEmitShape: '834426fb-9b34-47d1-a93f-68d5848a635a', // GPGPUの力と振る舞い
};

const mirrorLabel = (label: string): string => label.replace(/^Layer 3/, 'Layer 2');

export function getControlDescription(label: string): string | undefined {
  const key = label.trim();
  return CONTROL_DESCRIPTIONS[key] ?? CONTROL_DESCRIPTIONS[mirrorLabel(key)];
}

export function getControlNoteLink(label: string): string | undefined {
  const key = label.trim();
  return CONTROL_NOTE_LINKS[key] ?? CONTROL_NOTE_LINKS[mirrorLabel(key)];
}
