/*
 * immersive.ts
 * 責務: 「背景鑑賞モード」。本文ページで読書エリアを軽くタップ/クリック、または Esc で <html>.is-immersive を
 *       トグルする。鑑賞モード中は本文・UIクロム（進捗バー・FAB・読書点マーカー）を伏せ、暗幕（#bg-stack::after）
 *       を外して背景本来の色を見せる。見た目（伏せる／暗幕除去）とスクロール・パン・ホイールの無効化
 *       （#main-container の pointer-events:none + overflow:hidden）は CSS（html.is-immersive …）が担い、
 *       本モジュールは状態クラスのトグルと入力判定のみを持つ。
 * export: init(): void ／ isImmersive(): boolean ／ shouldToggleFromTap(input): boolean（テスト用の純関数）
 * 依存: なし（#main-container 等の DOM と <html> のクラス（is-immersive / is-selecting / at-opening）・ポップアップの
 *       開閉状態のみを読む。他モジュールを import しない。pan.ts は is-immersive を読んで自身のパン開始を抑止する）。
 *
 * 結線: main.ts が起動時に init() を1度だけ呼ぶ（pan.init() の近傍）。
 *
 * トグルの入力（要件 06-3）:
 *   - タップ/クリック: pointerdown→pointerup の移動量がしきい値未満（TAP_PX）かつ時間がしきい値未満（TAP_MS）の
 *     「その場の軽い操作」だけをトグルとみなす。移動量の大きいスワイプ/ドラッグは無視＝ネイティブ横スクロール／
 *     pan.ts に委ね、スワイプを邪魔しない。ボタン・FAB・読書点ノブ・ポップアップ等の上は対象外（各自の挙動を温存）。
 *   - Esc: capture フェーズで menu.ts より先に判定する。鑑賞モード中は抜ける。モード外でポップアップ/メニューが
 *     開いていれば何もしない（menu.ts の「閉じる」を優先）。何も開いていなければ入る。
 *
 * enter のガード（入れない条件）:
 *   - 開幕中（<html>.at-opening＝本文先頭の黒い余白）は背景がわざと黒で鑑賞対象がないため入らない。
 *   - 選択モード中（<html>.is-selecting＝Shift 押下）は発動しない（要件）。
 *   - ポップアップ/メニューが開いている間は入らない（タップは対象セレクタで弾き、Esc は開閉状態で弾く）。
 */

const IMMERSIVE_CLASS = 'is-immersive';

// タップ判定のしきい値。移動 TAP_PX(px) 以内かつ TAP_MS(ms) 以内の押下→離しだけをトグルとみなす。
// これより大きい/長い操作はスワイプ・ドラッグ・長押しとして無視する（スクロール／選択／pan に委ねる）。
const TAP_PX = 10;
const TAP_MS = 400;

// この要素（の子孫）上で始まったタップはトグルしない＝各自のクリック/ドラッグ挙動を温存する。
// ボタン・リンク・読書点ノブ・FAB一式・各ポップアップ（role=dialog）・キャラ紹介オーバーレイ。
const IGNORE_TAP_SELECTOR = 'button, a, .reading-anchor-cap, #menu-container, [role="dialog"], #characters-overlay';

// 「ポップアップ/メニューが開いている」とみなす要素（hidden でないもの）。開いている間は鑑賞モードへ入らない。
const OVERLAY_OPEN_SELECTOR = '#menu-panel:not([hidden]), [role="dialog"]:not([hidden]), #characters-overlay:not([hidden])';

// タップ判定の作業状態（pointerdown で記録し、move で打ち切り、up で確定する）。
let _candidate = false;
let _downX = 0;
let _downY = 0;
let _downT = 0;

// Esc とタップ/クリックの入力を購読する。main.ts が起動時に1度だけ呼ぶ。
// init(): void
export function init(): void {
  // Esc は capture フェーズで先に拾い、ポップアップが開いていれば menu.ts の「閉じる」へ譲る（入らない）。
  document.addEventListener('keydown', _onKeyDown, true);

  // 鑑賞モード中は #main-container が pointer-events:none になり対象が body へ落ちるため、確実に拾えるよう
  // window の capture で購読する（pan.ts の container 購読とは独立。preventDefault/stopPropagation はしない）。
  window.addEventListener('pointerdown', _onPointerDown, true);
  window.addEventListener('pointermove', _onPointerMove, true);
  window.addEventListener('pointerup', _onPointerUp, true);
  window.addEventListener('pointercancel', _onPointerCancel, true);
}

// <html>.is-immersive が付いているか（鑑賞モード中か）を返す。
// isImmersive(): boolean
export function isImmersive(): boolean {
  return document.documentElement.classList.contains(IMMERSIVE_CLASS);
}

// Esc キーで鑑賞モードをトグルする（capture フェーズ）。
// _onKeyDown(e: KeyboardEvent): void
function _onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (isImmersive()) _exit();
  else _enter(); // _enter 自身が開幕・選択モード・ポップアップ開を弾く（capture なので menu.ts の閉じる前に判定）
}

// 押下時の状態を記録し、タップ候補かどうかを決める。
// _onPointerDown(e: PointerEvent): void
function _onPointerDown(e: PointerEvent): void {
  _candidate = false;
  if (e.button !== 0) return;                                          // 主ボタン/タッチ/ペン接触のみ（右・中クリック除外）
  if (e.shiftKey) return;                                              // Shift（選択モード起動中）は発動しない（要件）
  if (document.documentElement.classList.contains('is-selecting')) return;
  if (e.target instanceof Element && e.target.closest(IGNORE_TAP_SELECTOR)) return; // ボタン・FAB・ノブ・ポップアップ上は対象外
  _candidate = true;
  _downX = e.clientX;
  _downY = e.clientY;
  _downT = e.timeStamp;
}

// 押下後に TAP_PX を超えて動いたら、それはスワイプ/ドラッグなのでタップ候補を取り消す。
// _onPointerMove(e: PointerEvent): void
function _onPointerMove(e: PointerEvent): void {
  if (!_candidate) return;
  if (Math.hypot(e.clientX - _downX, e.clientY - _downY) > TAP_PX) _candidate = false;
}

// 離した時、移動量・時間がタップしきい値内なら鑑賞モードをトグルする。
// _onPointerUp(e: PointerEvent): void
function _onPointerUp(e: PointerEvent): void {
  if (!_candidate) return;
  _candidate = false;
  if (!shouldToggleFromTap({ dx: e.clientX - _downX, dy: e.clientY - _downY, dt: e.timeStamp - _downT })) return;
  // 離した先がボタン等に乗っていたら（押下は余白・離しはボタン上など）トグルしない。
  if (e.target instanceof Element && e.target.closest(IGNORE_TAP_SELECTOR)) return;
  _toggle();
}

// タッチのスクロール委譲などで pointercancel が来たら、タップ候補を取り消す（スワイプを邪魔しない）。
// _onPointerCancel(): void
function _onPointerCancel(): void {
  _candidate = false;
}

// 鑑賞モードのトグル。
// _toggle(): void
function _toggle(): void {
  if (isImmersive()) _exit();
  else _enter();
}

// 鑑賞モードへ入る。開幕・選択モード・ポップアップ開のときは入らない。
// _enter(): void
function _enter(): void {
  const html = document.documentElement;
  if (html.classList.contains('at-opening')) return;   // 先頭の黒い余白＝鑑賞対象なし
  if (html.classList.contains('is-selecting')) return; // Shift 選択モード中
  if (document.querySelector(OVERLAY_OPEN_SELECTOR)) return; // ポップアップ/メニューが開いている
  html.classList.add(IMMERSIVE_CLASS);
}

// 鑑賞モードを抜ける。
// _exit(): void
function _exit(): void {
  document.documentElement.classList.remove(IMMERSIVE_CLASS);
}

// ── 純関数（DOM 非依存・テスト対象）────────────────────────────────

// 押下→離しの移動量(dx,dy)と経過時間(dt)から、タップ（＝トグル発火）とみなすかを返す。
// 移動が TAP_PX 以内かつ時間が TAP_MS 以内のときだけ true（その場の軽い操作）。スワイプ・ドラッグ・長押しは false。
// shouldToggleFromTap(input: { dx: number; dy: number; dt: number }): boolean
export function shouldToggleFromTap(input: { dx: number; dy: number; dt: number }): boolean {
  if (input.dt > TAP_MS) return false;
  return Math.hypot(input.dx, input.dy) <= TAP_PX;
}
