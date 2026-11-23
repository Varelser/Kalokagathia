import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  FIRST_RUN_TUTORIAL_STEPS,
  FIRST_RUN_TUTORIAL_STEP_COUNT,
  firstRunTutorialReducer,
  getFirstRunTutorialStorage,
  initialFirstRunTutorialState,
  isLastFirstRunTutorialStep,
  markFirstRunTutorialSeen,
  shouldShowFirstRunTutorial,
  type FirstRunTutorialAction,
  type FirstRunTutorialState,
} from './firstRunTutorialMachine';

/**
 * First-run tutorial (KCB4): a small four-step card for first-time
 * visitors only — welcome / controls / custom code / gallery & export.
 *
 * Standing UI rule for this app: overlays must not cover the canvas.
 * The card is therefore small, anchored to the bottom-left corner (the
 * GPU-tier warnings own the right side), and closable at any time via
 * the × button, the スキップ button, or Escape. Finishing, skipping or
 * closing writes the localStorage seen flag; from then on — and on
 * every later visit — this component renders null and the UI is
 * identical to before it existed. It never reads or writes app config.
 *
 * Mounted once in App.tsx, in the standard (non-kiosk/stream/embed)
 * render branch only, so exhibition and stream surfaces never see it.
 */

const STEP_BODIES: Record<string, string> = {
  welcome:
    'Kalokagathia はブラウザで動くモノクロ基調の3D粒子シミュレーターです。プリセットを選ぶだけで再生が始まります。まずは下の「次へ」で基本の流れをどうぞ。',
  controls:
    'Play タブでプリセットを選んで再生／停止します。プリセットを並べたシーケンス再生やランダム生成もここから。各タブのスライダーでパラメータを変えると、粒子の動きにその場で反映されます。',
  'custom-code':
    'カスタムGLSLでは、フォース／ポスト処理／粒子の頂点・フラグメント／ボリュームフォグの5箇所にGLSLスニペットを差し込めます。AIタブでは、文章で調整を頼んでプリセットを生成することもできます。',
  'gallery-export':
    'カタログでは生成プリセットをサムネイルで探せます。気に入った形は共有リンクで渡したり、静止画PNG／決定論レンダー（連番ZIP）／動画（WebM・MP4）／点群（PLY・OBJ）として書き出したりできます。',
};

export const FirstRunTutorial: React.FC = () => {
  const [state, setState] = useState<FirstRunTutorialState | null>(() => (
    shouldShowFirstRunTutorial(getFirstRunTutorialStorage())
      ? initialFirstRunTutorialState
      : null
  ));

  const dispatch = useCallback((action: FirstRunTutorialAction) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = firstRunTutorialReducer(prev, action);
      if (next.status === 'done') {
        // Persist before unmounting so a reload mid-close still counts
        // as seen, then render null (identity with the pre-KCB4 UI).
        markFirstRunTutorialSeen(getFirstRunTutorialStorage());
        return null;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!state) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dispatch({ type: 'close' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, dispatch]);

  if (!state) return null;

  const step = FIRST_RUN_TUTORIAL_STEPS[state.stepIndex];
  const isLast = isLastFirstRunTutorialStep(state);

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[60] w-[min(92vw,20rem)]">
      <div
        className="pointer-events-auto rounded border border-white/15 bg-black/85 px-3.5 py-3 text-[11px] leading-relaxed text-white/85 shadow-lg"
        role="dialog"
        aria-modal="false"
        aria-label="はじめてのガイド"
      >
        <div className="flex items-start gap-2">
          <p className="flex-1 text-[12px] font-semibold text-white">
            {step.title}
            <span className="ml-2 font-normal text-white/50">
              {state.stepIndex + 1} / {FIRST_RUN_TUTORIAL_STEP_COUNT}
            </span>
          </p>
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => dispatch({ type: 'close' })}
            className="shrink-0 rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white/85"
          >
            <X size={12} />
          </button>
        </div>
        <p className="mt-1.5">{STEP_BODIES[step.id]}</p>
        <div className="mt-2.5 flex items-center gap-1.5" aria-hidden="true">
          {FIRST_RUN_TUTORIAL_STEPS.map((entry, index) => (
            <span
              key={entry.id}
              className={`h-1 flex-1 rounded-full ${index <= state.stepIndex ? 'bg-white/80' : 'bg-white/20'}`}
            />
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => dispatch({ type: 'skip' })}
            className="rounded-full px-2 py-1 text-[10px] text-white/50 transition hover:bg-white/10 hover:text-white/80"
          >
            スキップ
          </button>
          <div className="flex gap-1.5">
            {state.stepIndex > 0 && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'back' })}
                className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/10"
              >
                戻る
              </button>
            )}
            <button
              type="button"
              onClick={() => dispatch(isLast ? { type: 'finish' } : { type: 'next' })}
              className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-[10px] font-semibold text-white transition hover:bg-white/25"
            >
              {isLast ? 'はじめる' : '次へ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
