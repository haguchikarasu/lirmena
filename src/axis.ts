/*
 * axis.ts
 * 責務: 書字方向（vertical-rl ⇔ horizontal-tb）による「進行軸」の差を吸収する座標系ユーティリティ。
 *       公開する量はすべて forward 進行 px（＝読み進め方向・0 起点・正値）に正規化し、
 *       呼び出し側から scrollLeft/scrollTop の生参照と符号分岐を排除する。
 *       縦書き vertical-rl では forward は scrollLeft が負方向へ伸び、横書き horizontal-tb では scrollTop が正方向へ伸びる——
 *       この差を本ファイルだけが知る（他モジュールは forward px しか扱わない）。
 *
 * export:
 *   getMode(): WritingMode                            … <html data-writing-mode> を真実源に現在の書字方向
 *   isReverse(): boolean                              … vertical-rl=true（forward が生 scroll 座標で負方向）
 *   sign(): 1 | -1                                    … forward 1px が生 scroll 座標へ進む符号
 *   getProgress(el: HTMLElement): number              … forward 現在位置（px・0 起点・正値）
 *   setProgress(el: HTMLElement, v: number): void     … forward 位置 v(px・>=0) を生 scroll 座標へ書く
 *   getProgressRange(el: HTMLElement): number         … forward 可動域（0〜range）
 *   getClientSize(el: HTMLElement): number            … 進行軸方向のビューポート長
 *   getProgressFromEvent(ev: WheelEvent): number      … wheel → forward 増分 px（係数適用前・smooth 化は呼び出し側）
 *   getAnchorPx(rect: DOMRect, ratio: number): number … --reading-anchor 比率(0〜1)を進行軸上の絶対 px へ
 *
 * 依存: なし（DOM 読取と <html data-writing-mode> 属性のみ。他モジュール非依存のリーフ）。
 * 結線: settings.ts が <html data-writing-mode> を切替え、本ファイルが唯一の読み手として参照する。
 *       各モジュール（main/nav/opening/bg/pan/tutorial/bookmark/reader）からの配線は後続コミットで行う
 *       （本コミットは未配線の純関数のみ＝既存挙動に影響しない）。
 */

export type WritingMode = 'vertical' | 'horizontal';

// <html data-writing-mode="vertical"> のときだけ縦書き。属性が無い/不正値は既定の横書きへ倒す（既定＝横書き）。
// getMode(): WritingMode
export function getMode(): WritingMode {
    return document.documentElement.getAttribute('data-writing-mode') === 'vertical'
        ? 'vertical'
        : 'horizontal';
}

// vertical-rl では forward（読み進め）方向に scrollLeft が負へ伸びる。横書きは正方向なので false。
// isReverse(): boolean
export function isReverse(): boolean {
    return getMode() === 'vertical';
}

// forward 1px を生 scroll 座標へ写すときの符号。内部でも使うが、配線側の符号計算のためにも公開する。
// sign(): 1 | -1
export function sign(): 1 | -1 {
    return isReverse() ? -1 : 1;
}

// forward 現在位置（px・0 起点・正値）。vertical=|scrollLeft|, horizontal=scrollTop。
// getProgress(el: HTMLElement): number
export function getProgress(el: HTMLElement): number {
    return isReverse() ? Math.abs(el.scrollLeft) : el.scrollTop;
}

// forward 位置 v（px・>=0）を生 scroll 座標へ書く。vertical では負方向へ、horizontal では正方向へ。
// setProgress(el: HTMLElement, v: number): void
export function setProgress(el: HTMLElement, v: number): void {
    if (isReverse()) el.scrollLeft = -v;
    else el.scrollTop = v;
}

// forward 可動域（0〜この値）。vertical=scrollWidth-clientWidth, horizontal=scrollHeight-clientHeight。
// getProgressRange(el: HTMLElement): number
export function getProgressRange(el: HTMLElement): number {
    return isReverse()
        ? el.scrollWidth - el.clientWidth
        : el.scrollHeight - el.clientHeight;
}

// 進行軸方向のビューポート長。vertical=clientWidth, horizontal=clientHeight。
// getClientSize(el: HTMLElement): number
export function getClientSize(el: HTMLElement): number {
    return isReverse() ? el.clientWidth : el.clientHeight;
}

// wheel イベントを forward 増分 px へ写す（正＝読み進め方向）。
// 縦ホイール deltaY は両モードとも forward 増分に一致する（vertical-rl は scrollLeft を負へ動かすと前進するため）。
// 写像点を本ファイルに集約しておくことで、将来「横書きで横ホイールを使う」等の入力軸変更を1箇所で吸収できる。
// 係数（WHEEL_SCROLL_MULTIPLIER）と smooth 化は UI 調整として呼び出し側（main.ts）の責務に残す。
// getProgressFromEvent(ev: WheelEvent): number
export function getProgressFromEvent(ev: WheelEvent): number {
    return ev.deltaY;
}

// --reading-anchor の比率 ratio（0〜1）を、要素 rect 上の進行軸の絶対 px 位置へ写す。
// reading-anchor は両書字方向とも「読み始め端を基準にした読書上の位置」で一貫させる：ratio が大きいほど読み始め端へ、
// 小さいほど読み終わり端へ寄る（縦書き読み始め=右／横書き読み始め=上）。これにより既定 45% は両方向とも中央よりやや読み終わり側に置かれ、
// 方向を切り替えても読書点が体験上の同じ位置（読み進み方向にやや遅れた点）を指す。
// vertical-rl: rect.left + ratio*width（ratio=1 で右＝読み始め）。horizontal-tb: rect.top + (1-ratio)*height（ratio=1 で上＝読み始め）。
// getAnchorPx(rect: DOMRect, ratio: number): number
export function getAnchorPx(rect: DOMRect, ratio: number): number {
    return isReverse()
        ? rect.left + ratio * rect.width
        : rect.top + (1 - ratio) * rect.height;
}
