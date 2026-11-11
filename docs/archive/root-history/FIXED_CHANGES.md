MonoSphere Particle Generator 修正内容

実施内容

1. 型公開の修正

types.ts に types/project.ts の再 export を追加

ProjectData

ProjectManifest

ProjectManifestStats

ProjectLayerSnapshot

ProjectUiState

2. Scene mode union の修正

types/scene.ts の Layer2Type に以下を追加

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

3. Motion map の修正

components/sceneMotionMap.ts に新規 mode のマッピングを追加

4. ParticleConfig の拡張

types/configLayer2.ts

types/configLayer3.ts

types/configGpgpu.ts



追加した主な設定群:



material style

brush surface

fiber field

growth field

deposition field

crystal aggregate

crystal deposition

erosion trail

voxel lattice

surface patch

surface shell / hull

reaction diffusion

volume fog

glyph outline

gpgpu metaball style

5. デフォルト設定の追加

lib/appStateConfig.ts に不足していた新規設定の default 値を追加

確認結果

npm run typecheck : 通過

npm run build : 通過

注意

今回の修正は、まず「型エラーとビルド停止」を解消するための統合修正です。 新規 mode を ControlPanel から全面操作する UI 接続までは拡張していません。 つまり、壊れていた基盤を閉じて、次の実装へ進める状態にした段階です。
