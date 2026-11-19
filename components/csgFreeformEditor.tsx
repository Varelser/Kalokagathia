/**
 * Phase CI (CSG second release, U2): the point editor for
 * the CSG free-form cross-section. A small SVG canvas over
 * the world range [-2.5, 2.5]²: click to add a point to the
 * active polygon, drag a point to move it. Every edit is
 * written back into the config text as a point list (the
 * single source of truth — an SVG input is converted to a
 * point list by the first edit, which the hint states).
 */
import React from 'react';
import { parseFreeformText, parsePointListLenient, serializePolygonsToPointList } from '../lib/csgFreeform';

type Pt = [number, number];
const RANGE = 2.5;

export const CsgFreeformEditor: React.FC<{
  text: string;
  onChange: (text: string) => void;
}> = ({ text, onChange }) => {
  const parsed = React.useMemo(() => parseFreeformText(text), [text]);
  const basePolygons: Pt[][] = React.useMemo(() => {
    if (parsed.ok) return parsed.polygons.map((p) => p.map(([x, y]) => [x, y] as Pt));
    // A shape being drawn passes through states the
    // strict parser refuses (1-2 points so far). Fall
    // back to the lenient point-list parse so clicks
    // accumulate instead of restarting from empty. An
    // SVG text that fails strict parsing still starts
    // from empty (its first edit converts it).
    const t = (text || '').trim();
    const isSvgText = /<(svg|path|polygon|polyline|rect|circle|ellipse)\b/.test(t)
      || /^[Mm]\s*[-+0-9.]/.test(t) || /^d\s*=\s*"/.test(t);
    if (isSvgText) return [];
    return parsePointListLenient(text).map((p) => p.map(([x, y]) => [x, y] as Pt));
  }, [parsed, text]);
  const [draft, setDraft] = React.useState<Pt[][] | null>(null);
  const [startNew, setStartNew] = React.useState(false);
  const dragRef = React.useRef<{ poly: number; point: number } | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const polygons = draft ?? basePolygons;

  const commit = (next: Pt[][]) => {
    setDraft(null);
    onChange(serializePolygonsToPointList(next));
  };

  const toWorld = (e: React.PointerEvent): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return [0, 0];
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const x = -RANGE + fx * RANGE * 2;
    const y = RANGE - fy * RANGE * 2;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return [r(Math.max(-RANGE, Math.min(RANGE, x))), r(Math.max(-RANGE, Math.min(RANGE, y)))];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const [wx, wy] = toWorld(e);
    // Hit an existing point? Start dragging it.
    for (let pi = 0; pi < polygons.length; pi++) {
      for (let qi = 0; qi < polygons[pi].length; qi++) {
        const [px, py] = polygons[pi][qi];
        if (Math.hypot(px - wx, py - wy) < 0.16) {
          dragRef.current = { poly: pi, point: qi };
          setDraft(polygons.map((p) => p.map((q) => [...q] as Pt)));
          (e.target as Element).setPointerCapture?.(e.pointerId);
          return;
        }
      }
    }
    // Otherwise append to the active polygon (or start one).
    const next = polygons.map((p) => p.map((q) => [...q] as Pt));
    if (startNew || next.length === 0) {
      next.push([[wx, wy]]);
      setStartNew(false);
    } else {
      next[next.length - 1].push([wx, wy]);
    }
    commit(next);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !draft) return;
    const [wx, wy] = toWorld(e);
    const next = draft.map((p) => p.map((q) => [...q] as Pt));
    if (next[drag.poly] && next[drag.poly][drag.point]) {
      next[drag.poly][drag.point] = [wx, wy];
      setDraft(next);
    }
  };

  const onPointerUp = () => {
    if (dragRef.current && draft) commit(draft);
    dragRef.current = null;
  };

  const undoPoint = () => {
    const next = polygons.map((p) => p.map((q) => [...q] as Pt));
    for (let pi = next.length - 1; pi >= 0; pi--) {
      if (next[pi].length > 0) {
        next[pi].pop();
        if (next[pi].length === 0) next.splice(pi, 1);
        break;
      }
    }
    commit(next);
  };

  const gridLines: number[] = [];
  for (let v = -RANGE; v <= RANGE + 1e-9; v += 0.5) gridLines.push(Math.round(v * 10) / 10);

  const btnClass =
    'rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10';

  return (
    <div className="mt-2">
      <svg
        ref={svgRef}
        viewBox={`${-RANGE} ${-RANGE} ${RANGE * 2} ${RANGE * 2}`}
        className="w-full rounded border border-white/15 bg-black/40"
        style={{ aspectRatio: '1', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {gridLines.map((v) => (
          <line key={`v${v}`} x1={v} y1={-RANGE} x2={v} y2={RANGE} stroke="rgba(255,255,255,0.08)" strokeWidth={0.012} />
        ))}
        {gridLines.map((v) => (
          <line key={`h${v}`} x1={-RANGE} y1={v} x2={RANGE} y2={v} stroke="rgba(255,255,255,0.08)" strokeWidth={0.012} />
        ))}
        <line x1={-RANGE} y1={0} x2={RANGE} y2={0} stroke="rgba(255,255,255,0.25)" strokeWidth={0.015} />
        <line x1={0} y1={-RANGE} x2={0} y2={RANGE} stroke="rgba(255,255,255,0.25)" strokeWidth={0.015} />
        <g transform="scale(1,-1)">
          {polygons.map((poly, pi) => (
            <g key={pi}>
              {poly.length >= 3 && (
                <polygon
                  points={poly.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="rgba(255,255,255,0.10)"
                  stroke="none"
                />
              )}
              {poly.length >= 2 && (
                <polyline
                  points={poly.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke={pi === polygons.length - 1 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)'}
                  strokeWidth={0.025}
                />
              )}
              {poly.map(([x, y], qi) => (
                <circle key={qi} cx={x} cy={y} r={0.07} fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth={0.015} style={{ cursor: 'grab' }} />
              ))}
            </g>
          ))}
        </g>
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={btnClass} onClick={undoPoint}>点を1つ戻す</button>
        <button type="button" className={btnClass} onClick={() => setStartNew(true)}>図形を閉じて次へ</button>
        <button type="button" className={btnClass} onClick={() => { setStartNew(false); onChange(''); }}>全消去</button>
        {startNew && <span className="text-[10px] text-white/50">次のクリックで新しい図形を始めます</span>}
      </div>
      <p className="mt-1 text-[9px] leading-relaxed text-white/40">
        クリックで点を追加、点はドラッグで移動できます（範囲 ±2.5、座標はそのまま世界単位）。
        SVG 形式のテキストを編集すると点リストに変換されます。図形同士の重なり・入れ子は実行時に弾かれます。
      </p>
    </div>
  );
};
