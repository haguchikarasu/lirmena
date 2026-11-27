/*
 * keyscroll.ts
 * 責務: 本文ページで、キーボードのスクロールのキー（矢印・PageUp/PageDown・Space・Home/End）を受けて本文（#main-container）を動かす。
 *       本文ページは文書ではなく #main-container がスクロールするので、ブラウザ任せだとフォーカスがその中にあるときしか
 *       キーが効かない（開いた直後はどのキーでも動かない）。どの場面でも効くように、サイトがキーを受ける（要件 06-6・08）。
 * export: init(): void ／ resolveKey(input: KeyInput): KeyAction | null（キーの解釈だけの純関数。テストからも使う）
 * 依存: axis.ts（進行軸の向きとスクロール）／ immersive.ts（鑑賞モード中か・メニューやシートが開いているかの判定）。
 * 結線: main.ts が起動時に init() を 1 度だけ呼ぶ（immersive.init() の隣）。
 *
 * キーの割り当て（要件 06-6「キーボードのスクロール」）:
 *   進む＝↓・PageDown・Space／戻る＝↑・PageUp・Shift+Space（両書字方向）。縦書きは ← でも進み、→ でも戻る
 *   （← → は画面の向き、↓ ↑ は「先へ・前へ」の意味）。横書きの ← → は受けない。Home＝本文の頭、End＝本文の末尾。
 *   量は、矢印＝本文 1 行ぶん、PageUp/PageDown・Space＝進行軸の表示長の PAGE_RATIO 倍。
 *   滑らかに動いている途中で次のキーが来たら、前のキーの行き先から足す（2 回押せば 2 回ぶん進む）。
 *
 * 受けない場面（ブラウザと各部品の動きに譲る）:
 *   - Ctrl・Alt・Meta と一緒（ブラウザのショートカット）。Shift は Space のときだけ受ける（Shift+矢印は文字の選択）
 *   - 入力欄（input・textarea・select・contenteditable）にフォーカスがある
 *   - Space で、ボタンなど Space で押せる部品にフォーカスがある（リンクは Space では押されないので、本文を動かす）
 *   - 鑑賞モード中（本文を伏せていてスクロールも止めてある）／メニュー・シート・確認・初回の案内が開いている
 *   - ほかの処理が preventDefault したキー
 */

import * as axis from './axis';
import * as immersive from './immersive';

// PageUp/PageDown・Space で動く量（進行軸の表示長に対する比）。ブラウザの既定（1 画面の 87.5%）に合わせ、前の画面の端を少し残す。
const PAGE_RATIO = 0.875;
// 本文の行の高さが読めないとき（line-height: normal など）の 1 行ぶん（px）。ブラウザの矢印キーの既定に合わせる。
const LINE_FALLBACK_PX = 40;

// 滑らかなスクロールの行き先を覚えておく長さ（ms）。着かなかったスクロール（ほかの処理に止められた）のための上限。
// 滑らかなスクロールはこれより短い。
const PENDING_MS = 1000;

// 滑らかに動いている途中の行き先（forward px）と、頼んだ時刻。動いていなければ null。
let _pending: { target: number; at: number } | null = null;

// キーで本文を動かさない入力欄。
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
// Space で押せる部品（Space はこちらに譲る）。リンクは入れない：リンクを押すのは Enter で、Space では押されない。
const SPACE_ACTIVATES_SELECTOR = 'button, summary, [role="button"], [role="tab"]';

export interface KeyInput {
    key: string;
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
    mode: axis.WritingMode;
}

// by＝いまの位置から動かす（dir: 1＝読み進める・-1＝戻る）／to＝端へ移る（start＝本文の頭・end＝末尾）。
export type KeyAction =
    | { kind: 'by'; unit: 'line' | 'page'; dir: 1 | -1 }
    | { kind: 'to'; edge: 'start' | 'end' };

// キーの組み合わせと書字方向から、本文の動かし方を決める。受けないキーは null。
// resolveKey(input: KeyInput): KeyAction | null
export function resolveKey(input: KeyInput): KeyAction | null {
    if (input.ctrl || input.alt || input.meta) return null;
    if (input.key === ' ') return { kind: 'by', unit: 'page', dir: input.shift ? -1 : 1 };
    if (input.shift) return null;
    switch (input.key) {
        case 'ArrowDown': return { kind: 'by', unit: 'line', dir: 1 };
        case 'ArrowUp': return { kind: 'by', unit: 'line', dir: -1 };
        case 'ArrowLeft': return input.mode === 'vertical' ? { kind: 'by', unit: 'line', dir: 1 } : null;
        case 'ArrowRight': return input.mode === 'vertical' ? { kind: 'by', unit: 'line', dir: -1 } : null;
        case 'PageDown': return { kind: 'by', unit: 'page', dir: 1 };
        case 'PageUp': return { kind: 'by', unit: 'page', dir: -1 };
        case 'Home': return { kind: 'to', edge: 'start' };
        case 'End': return { kind: 'to', edge: 'end' };
        default: return null;
    }
}

// キーの購読を始める。main.ts が起動時に 1 度だけ呼ぶ。
// init(): void
export function init(): void {
    document.addEventListener('keydown', _onKeyDown);
    // 行き先に着いたら覚えを消す。**scrollend では消さない**：途中で押し直したとき、取り消された前のスクロールの
    // scrollend が後から届くと、新しい行き先の覚えを消してしまう（3 回目が動きかけの位置から測られる）。
    // 器は keydown のたびに引き直す（init の時点で無くてもよい）ので、document で capture して受ける（scroll は泡立たない）。
    document.addEventListener('scroll', _onScroll, { capture: true, passive: true });
    // ほかの手段（ホイール・ドラッグ・タッチ）が動かし始めたら、キーの行き先はもう行き先ではない。覚えたままにすると、
    // 次のキーが古い行き先から測られて、読者のいる位置から飛ぶ。
    for (const type of ['wheel', 'pointerdown', 'touchstart'] as const) {
        document.addEventListener(type, _forgetPending, { capture: true, passive: true });
    }
}

// キーを受けて本文を動かす。受けたキーは preventDefault する（フォーカスが本文の中にあるとき、ブラウザ自身の
// スクロールと二重に動かないように）。
// _onKeyDown(e: KeyboardEvent): void
function _onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    const action = resolveKey({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, mode: axis.getMode() });
    if (!action) {
        // スクロール以外のキー（Tab など）は、フォーカスの移動で本文を動かすことがある。キーの行き先はもう当てにならない。
        _pending = null;
        return;
    }
    if (immersive.isImmersive() || immersive.isOverlayOpen()) return;
    if (e.target instanceof Element) {
        if (e.target.closest(EDITABLE_SELECTOR)) return;
        if (e.key === ' ' && e.target.closest(SPACE_ACTIVATES_SELECTOR)) return;
    }
    const container = document.getElementById('main-container');
    if (!container) return;

    e.preventDefault();
    // 押しっぱなしのくり返しは滑らかにしない：滑らかなスクロールは「いまの位置」から測り直すので、
    // くり返しのたびにやり直しになって進みが遅くなる。動きを減らす設定のときも、その場で移る（着く位置は同じ）。
    const smooth = !e.repeat && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const range = axis.getProgressRange(container);
    let target: number;
    if (action.kind === 'to') {
        target = action.edge === 'start' ? 0 : range;
    } else {
        const amount = action.unit === 'page' ? axis.getClientSize(container) * PAGE_RATIO : _lineSize();
        target = Math.min(range, Math.max(0, _base(container) + action.dir * amount));
    }
    _pending = smooth ? { target, at: performance.now() } : null;
    axis.scrollProgressTo(container, target, smooth);
}

// 動かす量の起点（forward px）。滑らかに動いている途中なら、その行き先。そうでなければ今の位置。
// 今の位置から測ると、途中で押した 2 回目が「動きかけの位置」から測られて、2 回押しても 2 回ぶん進まない。
// _base(container: HTMLElement): number
function _base(container: HTMLElement): number {
    if (_pending && performance.now() - _pending.at < PENDING_MS) return _pending.target;
    return axis.getProgress(container);
}

// 行き先の覚えを消す（ほかの手段が本文を動かし始めた）。
// _forgetPending(): void
function _forgetPending(): void {
    _pending = null;
}

// 本文が行き先に着いたら、行き先の覚えを消す。
// _onScroll(e: Event): void
function _onScroll(e: Event): void {
    if (!_pending || !(e.target instanceof HTMLElement) || e.target.id !== 'main-container') return;
    if (Math.abs(axis.getProgress(e.target) - _pending.target) < 1) _pending = null;
}

// 本文 1 行ぶんの長さ（px）。本文の段落の行の高さ（縦書きでは行の幅）を読む。読めなければ LINE_FALLBACK_PX。
// 読むのは段落（#scene-content p）：行の高さは段落に付いていて、#scene-content 自身は normal のまま（_layout.css）。
// _lineSize(): number
function _lineSize(): number {
    const para = document.querySelector('#scene-content p');
    const px = para ? parseFloat(getComputedStyle(para).lineHeight) : NaN;
    return Number.isFinite(px) && px > 0 ? px : LINE_FALLBACK_PX;
}
