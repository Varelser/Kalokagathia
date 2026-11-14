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
  'Layer 2 Enabled': '36276ed9-b39e-45f1-9b31-67feb34c88b8', // 3レイヤー構成
  'Profile': '6ef2ffa7-cf50-44c6-8e4a-69ed6eeace59', // 時間変化プロファイル
  'Model': '9e3699af-874a-49aa-ba5d-ddaa72da3f6e', // 反応モデル
  'Lenia Kernel（カーネル）': '2ed3be4a-5b72-46c5-afc6-6b52d6edf2e1', // Lenia
  'Display': 'c9528d8c-98ae-4e19-817c-5c835afd976f', // Physarum（粘菌）
  'Material Style': 'f2d86567-0ba6-48c8-bdd2-a06bba9c6e6f', // マテリアル（素材感）
  'Bloom': 'fdbb8479-47c9-4c66-b787-9c9900d8361c', // ポストエフェクトと画面効果
  'Chromatic Aberration': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Depth of Field': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Kaleidoscope / Mirror': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Feedback (GPU)': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Slit Scan (temporal bands)': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Vignette': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Noise': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Depth Fog': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Brightness / Contrast': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'Impact FX': 'fdbb8479-47c9-4c66-b787-9c9900d8361c',
  'GPGPU Enabled': '96b08f5b-e16f-4e82-b0bc-162724f71934', // GPGPU
  'N-Body Gravity': 'ac3e6867-193e-4995-a5ee-34284ae40be2', // GPGPUの力と振る舞い
  'Velocity Color': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Life System': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Curl Noise': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Boids Flocking': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Strange Attractor': '396cdbcb-dc96-48a5-adde-9eed9f24875b', // GPGPUアトラクタ12種
  'Type': '396cdbcb-dc96-48a5-adde-9eed9f24875b',
  'Lévy Flight': 'ecb18ae2-f080-47a8-881e-b6cbd907480e', // Lévyフライト
  'Kuramoto Sync': '611cf558-8f4b-4245-82ef-ec453118a05b', // 蔵本モデル
  'Particle Life': '1a71acb1-8ccc-45df-92d4-0f6f09c07f78', // Particle Life
  'Vortex Field': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Wind Force': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Gravity Well': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Elastic Spring': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Magnetic Field': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'SPH Fluid': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Vector Field': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Field Type': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Spring (to Spawn)': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Verlet Integration': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'SDF Collider': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Collider Mode': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Color over Lifetime': '799538ae-203b-4e28-84b6-96a172b96486', // 描画様式
  'Size over Lifetime': '799538ae-203b-4e28-84b6-96a172b96486',
  'Mouse Force': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Mode': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Depth Sort (Alpha)': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Fluid Advection': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Ext. Force (Vortex)': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Custom Force (GLSL)': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Motion Trail': '799538ae-203b-4e28-84b6-96a172b96486',
  'Ribbon Trail': '799538ae-203b-4e28-84b6-96a172b96486',
  'Tube Trail (Circular)': '799538ae-203b-4e28-84b6-96a172b96486',
  'Smooth Tube Trail': '799538ae-203b-4e28-84b6-96a172b96486',
  'Streak Rendering': '799538ae-203b-4e28-84b6-96a172b96486',
  'Metaballs (MC Surface)': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Volumetric (Ray March)': '5b8a1912-5cec-4ef3-ac06-6e7f4fdd76d8', // レイマーチングSDF
  'Audio Source': 'b9e47ff6-33b0-413b-a823-0b49bb0135f3', // FFT・音声反応
  'Audio Link': 'b9e47ff6-33b0-413b-a823-0b49bb0135f3',
  'Audio Reactive': 'b9e47ff6-33b0-413b-a823-0b49bb0135f3',
  'Synth Scale': 'b9e47ff6-33b0-413b-a823-0b49bb0135f3',
  'Synth Wave': 'b9e47ff6-33b0-413b-a823-0b49bb0135f3',
  'Ambient Dust': '36276ed9-b39e-45f1-9b31-67feb34c88b8', // 3レイヤー構成
  'GPGPU Layer': '96b08f5b-e16f-4e82-b0bc-162724f71934', // GPGPU
  'GPU Sorting': 'ac3e6867-193e-4995-a5ee-34284ae40be2', // GPGPUの力と振る舞い
  'GPU Sort': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Fluid Solver': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Frame Carry Simulation': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Mouse Mode': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'Elastic Constraint': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'GPU Volume': 'ac3e6867-193e-4995-a5ee-34284ae40be2',
  'WebGPU Backend': 'e3ffe096-c96e-4dad-a5e0-29a94d61f1a5', // WebGPUを見送った理由
  'WebGPU': 'e3ffe096-c96e-4dad-a5e0-29a94d61f1a5',
  'Post Noise': 'fdbb8479-47c9-4c66-b787-9c9900d8361c', // ポストエフェクトと画面効果
  'Contact FX': '36276ed9-b39e-45f1-9b31-67feb34c88b8', // 3レイヤー構成（レイヤー間相互作用）
  'Recording Mode': '74ebd5ed-3b64-4d5f-88c9-119fa6c19d2b', // 画像と動画の書き出し
  'Drive Mode': '7a91dd60-8406-4fbb-8423-a1fd947e487c', // プリセットシーケンス
  'Drive Strength': '7a91dd60-8406-4fbb-8423-a1fd947e487c',
  'Sequence Drive': '7a91dd60-8406-4fbb-8423-a1fd947e487c',
  'Breed · 交配する': 'cefb7674-abda-4169-a8e9-b80e8dd7d841', // 進化ラボ
  'Parent A': 'cefb7674-abda-4169-a8e9-b80e8dd7d841',
  'Parent B': 'cefb7674-abda-4169-a8e9-b80e8dd7d841',
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
  layer2Source: '28a21e94-8695-44d1-a979-b6c6cdf57750', // 発生形状（ソース）
  layer2Type: 'b3ccf14f-09bf-437d-a552-a14634aa03d0', // モーション（動きの仕組み）
  layer2SpriteMode: 'f2d86567-0ba6-48c8-bdd2-a06bba9c6e6f', // マテリアル（素材感）
  layer2ConnectionStyle: '7b9bf845-5cef-4095-876d-4f5592f5b594', // 物理と流れ
  layer3Source: '28a21e94-8695-44d1-a979-b6c6cdf57750',
  layer3Type: 'b3ccf14f-09bf-437d-a552-a14634aa03d0',
  layer3SpriteMode: 'f2d86567-0ba6-48c8-bdd2-a06bba9c6e6f',
  layer3ConnectionStyle: '7b9bf845-5cef-4095-876d-4f5592f5b594',
  gpgpuEmitShape: 'ac3e6867-193e-4995-a5ee-34284ae40be2', // GPGPUの力と振る舞い
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
