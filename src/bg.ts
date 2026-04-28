/*
 * bg.ts
 * 責務: 背景画像の切り替え（object-fit: cover・読込失敗時は黒背景）
 * export: set()
 * 依存: なし
 *
 * 実装メモ:
 *   フェードは transition.ts の暗転に乗せる方式のため、set() は即時差し替え。
 *   null を渡すと黒背景になる（タイトルカード表示時など）。
 *   読込失敗時も黒背景にフォールバック。
 */

const IMG_BASE = '/img/';

// ファイル名を受け取り背景画像を即時差し替える。null なら黒背景にする。
// set(filename: string | null): void
export function set(filename: string | null): void {
  const el = document.getElementById('bg-layer');
  if (!el) return;

  if (filename === null) {
    el.style.backgroundImage = '';
    return;
  }

  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url(${img.src})`;
  };
  img.onerror = () => {
    el.style.backgroundImage = '';
  };
  img.src = IMG_BASE + filename;
}
