/*
 * bg.ts
 * 責務: 背景画像の切り替え（background-size: cover・読込失敗時は黒背景）
 * export: set()
 * 依存: なし
 *
 * 実装メモ:
 *   フェードは transition.ts の暗転に乗せる方式のため、set() は即時差し替え。
 *   null を渡すと黒背景になる（タイトルカード表示時など）。
 *   読込失敗時も黒背景にフォールバック。
 *   bgPositionX が指定されかつ縦長画面（innerWidth < innerHeight）のとき
 *   background-position: {bgPositionX} center を適用し、それ以外は center center にする。
 */

// ep 番号・ファイル名・横位置指定を受け取り背景画像を即時差し替える。null なら黒背景にする。
// bgPositionX が指定されかつ縦長画面のとき background-position: {bgPositionX} center を適用する。
// set(ep: number, filename: string | null, bgPositionX?: string): void
export function set(ep: number, filename: string | null, bgPositionX?: string): void {
  const el = document.getElementById('bg-layer');
  if (!el) return;

  if (filename === null) {
    el.style.backgroundImage = '';
    el.style.backgroundPosition = '';
    return;
  }

  const portrait = window.innerWidth < window.innerHeight;
  el.style.backgroundPosition = (bgPositionX && portrait) ? `${bgPositionX} center` : 'center center';

  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url(${img.src})`;
  };
  img.onerror = () => {
    el.style.backgroundImage = '';
  };
  img.src = `${import.meta.env.BASE_URL}ep${String(ep).padStart(2, '0')}/img/${filename}`;
}
