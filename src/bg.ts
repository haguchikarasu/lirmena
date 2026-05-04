/*
 * bg.ts
 * 責務: 背景画像の切り替え（background-size: cover・読込失敗時は黒背景）
 * export: set()
 * 依存: なし
 *
 * 実装メモ:
 *   set() は画像ロード完了（または失敗）で resolve する Promise を返す。
 *   transition.ts は await set() してから _fadeIn() を呼ぶことで、
 *   暗転中に画像をロードし、明転前に差し替えが完了することを保証する。
 *   null を渡すと黒背景になる（タイトルカード表示時など）。
 *   読込失敗時も黒背景にフォールバック（Promise は reject しない）。
 *   bgPositionX が指定されかつ縦長画面（innerWidth < innerHeight）のとき
 *   background-position: {bgPositionX} center を適用し、それ以外は center center にする。
 */

// ep 番号・ファイル名・横位置指定を受け取り背景画像を差し替える。null なら黒背景にする。
// 画像ロード完了（または失敗）で resolve する Promise を返す。
// bgPositionX が指定されかつ縦長画面のとき background-position: {bgPositionX} center を適用する。
// set(ep: number, filename: string | null, bgPositionX?: string): Promise<void>
export function set(ep: number, filename: string | null, bgPositionX?: string): Promise<void> {
  const el = document.getElementById('bg-layer');
  if (!el) return Promise.resolve();

  if (filename === null) {
    el.style.backgroundImage = '';
    el.style.backgroundPosition = '';
    return Promise.resolve();
  }

  const portrait = window.innerWidth < window.innerHeight;
  el.style.backgroundPosition = (bgPositionX && portrait) ? `${bgPositionX} center` : 'center center';

  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      el.style.backgroundImage = `url(${img.src})`;
      resolve();
    };
    img.onerror = () => {
      el.style.backgroundImage = '';
      resolve();
    };
    img.src = `${import.meta.env.BASE_URL}ep${String(ep).padStart(2, '0')}/img/${filename}`;
  });
}
