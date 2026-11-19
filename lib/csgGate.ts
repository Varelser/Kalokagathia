// Phase CC: watertight gate (a) — the structural pre-check for
// CSG mesh operands, designed in the foundations round-8 gate
// measurements (#10 NEW, 116 trials) and fixed in the final CSG
// brief (#5, csg-final §フェーズ3).
//
// The check is purely structural and has no manifold-3d or three
// dependency, so it runs identically on the main thread (before
// transfer), inside the CSG worker (as the output re-check (c)),
// and in the plain-node test suites:
//
//   1. every vertex coordinate is finite (a NaN vertex would
//      otherwise weld onto itself through the string key below
//      and slip past the edge test),
//   2. vertices are welded on a 1e-6 grid,
//   3. every undirected edge is shared by exactly two faces,
//   4. Euler characteristic: 2 x components - (V - E + F) is a
//      non-negative even number — equivalently V - E + F equals
//      2C - 2G where G is the total genus (handles) summed over
//      components. A hollow two-component input (genus 0) has
//      Euler 4 and passes; a torus or a torus knot (genus 1)
//      has Euler 0 and passes. (Phase CF generalisation, the
//      user's decision 2026-11-19: the Phase CC rule fixed
//      G = 0, which refused valid genus >= 1 manifolds and any
//      boolean result with a handle. Edge sharing above and
//      the worker-side construction (b) remain the arbiters
//      of manifoldness — this rule only rejects Euler values
//      no closed orientable manifold can have.)
//   5. components are counted on the welded face graph.
//
// Above CSG_GATE_FACE_LIMIT faces the check reports `skipped`
// instead of a verdict — the worker-side construction catch (b)
// and the output status check remain the last line of defence,
// per the brief. The gate never repairs: no hole filling, no
// merge() (merge welds, which would silently "fix" unwelded
// input that (b) is supposed to reject).

export interface CsgGateReport {
  /** True only when the mesh passed every structural test. */
  ok: boolean;
  /** True when the face count exceeded the inspection limit. */
  skipped: boolean;
  /** User-facing reason when ok is false (Japanese, panel-ready). */
  reason: string;
  vertices: number;
  edges: number;
  faces: number;
  components: number;
  euler: number;
  /** Total genus (handles) summed over components, derived
   *  from the Euler characteristic when it is consistent with
   *  a closed orientable manifold; 0 otherwise. */
  genus: number;
  badEdges: number;
  nonFinite: number;
}

// Cost measured in the round-8 spike: ~20 ms at 12,808 triangles
// (sphere-union mesh), linear in face count. 100k faces keeps the
// main-thread check near ~150 ms worst case; CSG operands in the
// first release are primitives (<= ~2k faces), so the limit only
// guards pathological pasted meshes.
export const CSG_GATE_FACE_LIMIT = 100_000;

const WELD_SCALE = 1e6;

function weldKey(x: number, y: number, z: number): string {
  return (
    Math.round(x * WELD_SCALE) + ',' +
    Math.round(y * WELD_SCALE) + ',' +
    Math.round(z * WELD_SCALE)
  );
}

export function checkWatertightGate(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
): CsgGateReport {
  const faceCount = indices
    ? Math.floor(indices.length / 3)
    : Math.floor(positions.length / 9);
  const base: CsgGateReport = {
    ok: false,
    skipped: false,
    reason: '',
    vertices: 0,
    edges: 0,
    faces: faceCount,
    components: 0,
    euler: 0,
    genus: 0,
    badEdges: 0,
    nonFinite: 0,
  };

  // (1) finite check, same pass as the vertex scan.
  let nonFinite = 0;
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) nonFinite++;
  }
  base.nonFinite = nonFinite;
  if (nonFinite > 0) {
    base.reason =
      '頂点座標に有限でない値（NaN / Infinity）が含まれているため、閉じたメッシュとして扱えません。';
    return base;
  }
  if (faceCount === 0) {
    base.reason = '面が1つも無いため、閉じたメッシュとして扱えません。';
    return base;
  }
  if (faceCount > CSG_GATE_FACE_LIMIT) {
    base.skipped = true;
    base.reason =
      `面数が事前検査の上限（${CSG_GATE_FACE_LIMIT.toLocaleString()} 面）を超えたため、` +
      '構造の事前検査を省略しました。構築時の検査が最後の砦になります。';
    return base;
  }

  // (2) weld referenced vertices.
  const weld = new Map<string, number>();
  const weldedOf = (vi: number): number => {
    const key = weldKey(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
    let id = weld.get(key);
    if (id === undefined) {
      id = weld.size;
      weld.set(key, id);
    }
    return id;
  };
  const vertexOf = (corner: number): number => {
    const raw = indices ? indices[corner] : corner;
    return weldedOf(raw);
  };

  // Union-find over welded vertices for the component count.
  const parent: number[] = [];
  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    let cur = a;
    while (parent[cur] !== root) {
      const next = parent[cur];
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const ensure = (id: number) => {
    while (parent.length <= id) parent.push(parent.length);
  };

  // (3) undirected edge census.
  const edgeCount = new Map<string, number>();
  let badEdges = 0;
  const addEdge = (a: number, b: number) => {
    if (a === b) {
      badEdges++;
      return;
    }
    const key = a < b ? a + '_' + b : b + '_' + a;
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
  };

  for (let f = 0; f < faceCount; f++) {
    const a = vertexOf(f * 3);
    const b = vertexOf(f * 3 + 1);
    const c = vertexOf(f * 3 + 2);
    ensure(Math.max(a, b, c));
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
    const rc = find(c);
    const rab = find(a);
    if (rc !== rab) parent[rc] = rab;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  for (const count of edgeCount.values()) {
    if (count !== 2) badEdges++;
  }

  const roots = new Set<number>();
  for (let id = 0; id < weld.size; id++) roots.add(find(id));

  base.vertices = weld.size;
  base.edges = edgeCount.size;
  base.components = roots.size;
  base.euler = base.vertices - base.edges + faceCount;
  base.badEdges = badEdges;
  // Total genus from the Euler characteristic: for a closed
  // orientable manifold, euler = 2C - 2G, so the deficit
  // 2C - euler must be a non-negative even number and G is
  // half of it. Anything else (negative, odd) is an Euler
  // value no such manifold can have.
  const deficit = 2 * base.components - base.euler;
  base.genus = deficit >= 0 && deficit % 2 === 0 ? deficit / 2 : 0;

  // (4) verdict.
  if (badEdges > 0) {
    base.reason =
      `辺の共有が崩れています（${badEdges} 本の辺がちょうど2面に共有されていません）。` +
      '開いたメッシュや位相の壊れたメッシュは CSG の被演算子にできません。';
    return base;
  }
  if (deficit < 0 || deficit % 2 !== 0) {
    base.reason =
      `オイラー標数が閉じた多様体の条件と合いません（V − E + F = ${base.euler}、` +
      `成分数 ${base.components} では 2×成分数 − (V − E + F) が 0 以上の偶数になりません）。` +
      '位相の壊れたメッシュは CSG の被演算子にできません。';
    return base;
  }
  base.ok = true;
  return base;
}
