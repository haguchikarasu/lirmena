/*
 * opening.ts
 * 責務: 開幕（本文先頭の黒い恒久余白＝スクロール先頭）でのみ表示する「開始アフォーダンス」の制御。
 *       現在地ラベル（"01-02"）・「もどる」・「読み進める」（縦横とも日本語のみ・並びはこの順）を中央に提示する。
 *       戻る導線は端の戻るボタンを廃止しこのアフォーダンスに一本化した。スクロールが先頭からはずれると（＝開幕の黒い余白を離れると）
 *       アフォーダンスをフェードアウトし、読書点マーカー（#reading-anchor）を見せる（表示実体は CSS）。
 * export: init(): void / update(forward: number): void
 * 依存: axis.ts（「読み進める」スクロールの進行軸解決）／ state.ts（現在地ラベルの ep/sec 取得）／ nav.ts（「もどる」の戻る遷移 goPrev() を共有）。
 *       読書点比率は CSS 変数 --reading-anchor を読むのみ（bg.ts と同じ源）
 *
 * 結線: main.ts が opening.init() を呼び、reader.ts が handleScroll で update(forward) を fan-out する（forward 進行 px）。
 *   静的シェルは <html class="at-opening"> を初期値に持つ（初回ペイントから開幕状態＝素の戻るボタンの
 *   ちらつきを防ぐ）。update が forward に応じて .at-opening を付け外しする（進行軸の先頭＝forward≈0 のときだけ開幕）。
 *   現在地ラベル（#opening-label）は静的シェルでは空で、init() が state.getCurrent() の ep/sec を "01-02" 形式で埋める
 *   （本文シェルは全 sec 共通の1テンプレを保つため、値はハードコードせず JS で反映する）。
 *
 * 「読み進める」の挙動（要件 06-6）:
 *   文章の先頭辺が読書点マーカー位置（--reading-anchor 比率 × #main-container 幅）に来る量まで
 *   自前 rAF アニメで滑らかにスクロールしつつ、同時に .at-opening を外してアフォーダンスをフェードアウトする。
 *   スクロール時間をアフォーダンスの CSS フェード時間に合わせるため、スクロール完了とフェード完了がほぼ同時になる。
 *   進行方向は axis が解決する：forward 量（0 起点・正値）で計算し axis.setProgress で書く（縦書き=scrollLeft 負方向／横書き=scrollTop 正方向）。
 *
 * 「もどる」の挙動（要件 06-6）:
 *   戻る遷移は nav.goPrev() に委譲する（端の戻るボタンは廃止し戻る導線はここに一本化）。前 sec 本文へ戻るときは
 *   その sec の本文末（読み終わり側）へ着地し、当 ep 先頭 sec からは当 ep タイトルへ戻る（離脱フェード付き）。
 */

import * as axis from './axis';
import * as state from './state';
import * as nav from './nav';

// --reading-anchor が読めないときのフォールバック比率（0〜1）。bg.ts の ANCHOR と揃える。
const ANCHOR_FALLBACK = 0.45;
// アフォーダンスフェード時間が取れないときのフォールバック（ms）。CSS #opening-affordance の transition と揃える。
const FADE_FALLBACK_MS = 450;
// 右端からこの px 以内を「開幕（右端）」とみなす。これを超えてスクロールしたら開幕を解除しマーカーを出す。
const AT_OPENING_PX = 4;

// 「読み進める」スクロール中は update() が .at-opening を再付与しないようにするガード。
let _transitioning = false;

// 現在地ラベル・「読み進める」「もどる」ボタンを初期化する。main.ts が起動時に1度だけ呼ぶ。
// 本文モードは "EP-SEC" 形式（"01-02"）、あとがきモードは「第◯巻あとがき」形式でラベルを埋める。
// init(): void
export function init(): void {
    // 現在地ラベル：黒地に「読み進める」だけだと何の画面か分からないため位置を示す。
    const label = document.getElementById('opening-label');
    if (label) {
        if (state.getMode() === 'afterword') {
            const vol = state.getCurrentAfterwordVol();
            label.textContent = vol === null ? '' : `第${vol}巻あとがき`;
        } else {
            const { ep, sec } = state.getCurrent();
            label.textContent = `${_pad(ep)}-${_pad(sec)}`;
        }
    }

    const start = document.querySelector<HTMLButtonElement>('#opening-start');
    const back = document.querySelector<HTMLButtonElement>('#opening-back');

    // 「読み進める」：文章先頭辺を読書点マーカー位置へ合わせる量まで滑らかにスクロールし、同時にフェードアウトする。
    start?.addEventListener('click', _readOn);

    // 「もどる」：戻る遷移 nav.goPrev() に委譲する（本文モードは前 sec 本文末／あとがきモードは自 vol 巻末 sec 本文末）。
    // モード分岐は nav.goPrev 内で行うため opening 側では常に同じ呼び方でよい。
    back?.addEventListener('click', () => nav.goPrev());
}

// 数値を2桁ゼロ埋めする（現在地ラベル "01-02" 用）。
// _pad(n: number): string
function _pad(n: number): string {
    return String(n).padStart(2, '0');
}

// スクロールが進行軸の先頭（forward≈0）にあるときだけ開幕状態にする。reader.ts がスクロール通知ごとに forward 進行 px を渡す。
// 「読み進める」スクロール中（_transitioning）は無視し、フェードアウトを click 起点に一本化する。
// forward は 0 起点の正値（axis.getProgress 由来）のため絶対値化は不要。
// update(forward: number): void
export function update(forward: number): void {
    if (_transitioning) return;
    document.documentElement.classList.toggle('at-opening', forward <= AT_OPENING_PX);
}

// 「読み進める」：開幕を解除（アフォーダンスをフェードアウト・マーカー/戻るボタンをフェードイン）しつつ、
// 文章先頭辺が読書点マーカー位置に来る量まで、フェードと同じ時間で滑らかにスクロールする。
function _readOn(): void {
    const container = document.getElementById('main-container');
    if (!container) return;

    // フェード開始：開幕を解除する。スクロール中は update() に再付与させない。
    _transitioning = true;
    document.documentElement.classList.remove('at-opening');

    // 文章先頭辺（先頭シーンの読み始め辺）がマーカー位置に重なる forward 進行量 = 比率 × 進行軸ビューポート長。
    // 先頭の黒い恒久余白（btn-container-start）は長さ＝進行軸ビューポート長なので、この距離だけ進めると先頭辺がマーカーに乗る。
    const targetForward = _readAnchorRatio() * axis.getClientSize(container);
    const target = Math.min(axis.getProgressRange(container), Math.max(0, targetForward)); // forward 可動域にクランプ

    _animateScrollTo(container, target, _affordanceFadeMs());
}

// --reading-anchor（"45%" など）を 0〜1 の比率に解析する。読めなければ ANCHOR_FALLBACK。bg.ts と同じ源を読む。
// _readAnchorRatio(): number
function _readAnchorRatio(): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--reading-anchor');
    const pct = parseFloat(raw);
    if (!Number.isFinite(pct)) return ANCHOR_FALLBACK;
    return Math.min(1, Math.max(0, pct / 100));
}

// #opening-affordance の transition-duration（"0.45s" / "0.45s, 0.45s"）を ms で返す。
// スクロール時間をこれに合わせ、スクロール完了とフェード完了をほぼ同時にする（マジックナンバーの二重管理を避ける）。
// _affordanceFadeMs(): number
function _affordanceFadeMs(): number {
    const aff = document.getElementById('opening-affordance');
    if (!aff) return FADE_FALLBACK_MS;
    const sec = parseFloat(getComputedStyle(aff).transitionDuration);
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : FADE_FALLBACK_MS;
}

// 進行軸（forward px・0 起点・正値）を現在値から targetForward まで duration(ms) で ease-out スクロールする
// （軸と符号は axis.setProgress が解決する）。完了で _transitioning を倒す。prefers-reduced-motion 時は即時移動する。
// _animateScrollTo(container: HTMLElement, targetForward: number, duration: number): void
function _animateScrollTo(container: HTMLElement, targetForward: number, duration: number): void {
    const startForward = axis.getProgress(container);
    const delta = targetForward - startForward;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || delta === 0 || duration <= 0) {
        axis.setProgress(container, targetForward);
        _transitioning = false;
        return;
    }

    const t0 = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3); // ease-out cubic
    const step = (now: number) => {
        const t = Math.min(1, (now - t0) / duration);
        axis.setProgress(container, startForward + delta * easeOut(t));
        if (t < 1) requestAnimationFrame(step);
        else _transitioning = false;
    };
    requestAnimationFrame(step);
}
