MonoSphere / Kalokagathia 再精査と追加実行レポート

結論

今回の再精査では、前回の「型を通す」段階から一歩進めて、ゴールから逆算したときに不足していた描画導線の実装を優先して追加しました。



今回の追加実行で閉じた要点は次の3つです。



新規描写モードを AppScene で正式に描画ルーティング

Control Panel の Motion Selector から新規モードを選択可能化

Render Registry に新規描写系を反映

ゴールから逆算した見立て

このプロジェクトのゴールは、単に typecheck/build を通すことではなく、



描写ファミリーを増やせること

その描写を UI から選べること

実際の Scene でその描写が出ること

将来の保存/要約/ロードマップにも反映できること



です。



前回時点では、型は閉じても次の不足が残っていました。



新規 mode が Scene に接続されていない

新規 mode が Motion Selector に露出していない

Render Registry が 旧世界のまま

procedural mode でも従来の粒子描画が常に重なり、最終見た目がゴールとズレる



そのため、今回は「何を描くモードなのか」を AppScene 側で明示的に切り替える方針を優先しました。

今回実際に修正した箇所

1. components/AppScene.tsx

追加内容:



以下の scene system を import / route



SurfaceShellSystem

SurfacePatchSystem

BrushSurfaceSystem

FiberFieldSystem

GrowthFieldSystem

DepositionFieldSystem

CrystalAggregateSystem

ErosionTrailSystem

VoxelLatticeSystem

CrystalDepositionSystem

ReactionDiffusionSystem

VolumeFogSystem

GlyphOutlineSystem



PROCEDURAL_LAYER_MODES を追加



procedural mode のときは ParticleSystem を重ねないように制御



text source + glyph outline enabled のときに GlyphOutlineSystem を描画



意味:



追加した mode が、やっと **「存在するだけのファイル」から「実際に描画される機能」**になりました。

特に procedural mode で粒子描画を止めたことで、見た目がゴールに近づきました。

2. components/controlPanelPartsMotion.tsx

追加内容:



Motion Selector に以下を追加

surface_shell

surface_patch

brush_surface

fiber_field

growth_field

deposition_field

crystal_aggregate

erosion_trail

voxel_lattice

crystal_deposition

reaction_diffusion

volume_fog



意味:



UI 上から新規 mode を直接選べるようになりました。

これで「型にはあるが UI から触れない」状態を解消しました。

3. components/motionCatalog.ts

追加内容:



新規 procedural / structural mode を Structure グループに追加



意味:



Motion Selector の検索性と分類整合が改善しました。

新モードが既存モーション群の外に落ちる問題を防ぎました。

4. lib/renderModeRegistry.ts

追加内容:



既存 registry の activeWhen を一部調整

以下の registry 項目を追加

layer-surface-shell

layer-surface-patch

layer-brush-surface

layer-fiber-field

layer-growth-field

layer-deposition-field

layer-reaction-diffusion

layer-volume-fog

layer-crystal-aggregate

layer-voxel-lattice

layer-crystal-deposition

layer-erosion-trails

layer-glyph-outline



意味:



実装済み描写と registry の乖離を縮めました。

今後 manifest / summary / roadmap 更新へつなぎやすくなりました。

実行確認

以下を実行し、通過を確認しました。



npm install

npm run typecheck

npm run build



確認結果:



typecheck: 通過

build: 通過

今回の修正で改善したこと

以前

mode は増えている

型は通る

だが AppScene では使われない

UI から選べない

registry に載らない

今回後

mode は増えている

型が通る

AppScene で描画される

UI から選べる

registry に載る

まだ残っている重要課題

今回でかなり前進しましたが、まだ次が残っています。

A. Layer 2 / 3 専用パラメータ UI の不足

現状、Motion Selector では mode を選べますが、各 mode の専用パラメータ UI は sheet ほど十分ではありません。



優先度が高い専用 UI:



surface_shell

surface_patch

brush_surface

fiber_field

growth_field

deposition_field

crystal_aggregate

erosion_trail

voxel_lattice

crystal_deposition

reaction_diffusion

volume_fog

B. Project I/O の実アプリ接続

存在しているが、まだアプリ導線へ入っていないもの:



useProjectTransfer

controlPanelProjectIO.tsx



これは「editable and serializable」というゴールから見ると重要です。

C. 文書の実態同期

まだ古い記述が残る可能性があります。 特に同期すべき文書:



RENDERING_ROADMAP_MASTER.md

SYSTEM_DESIGN_BLUEPRINT.md

REVIEW.md

README.md

D. 命名統一

kalokagathia

MonoSphere Particle Generator



この二重構造は今後の引き継ぎで不利です。

次に着手すべき順番

各新規 mode の専用 UI セクション追加

Project I/O を Control Panel / App に接続

registry 数・実装数・文書数値の同期

命名統一

plugin contract 化

今回の評価

今回の追加修正後の見立てです。



コンセプト設計: 8.5 / 10

表現拡張の方向性: 9.0 / 10

実装整合性: 6.2 / 10

UI 到達性: 6.5 / 10

build 安定性: 7.0 / 10

配布品質: 5.5 / 10

総合: 6.7 / 10



前回までより改善したのは、**「増やした表現が本当に到達可能か」**の部分です。

修正対象ファイル

components/AppScene.tsx

components/controlPanelPartsMotion.tsx

components/motionCatalog.ts

lib/renderModeRegistry.ts
