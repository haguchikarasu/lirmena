/*
 * transition.ts
 * 【責務】ページ離脱／到着フェードの共有ヘルパー（単一オーバーレイ方式）。
 *   全レイヤーより上の #transition-overlay の .fading をトグルするだけで、bg・本文・ボタン・menu を一律に覆う。
 *     - 到着（フェードイン）: シェルは <div id="transition-overlay" class="fading">（不透明黒）で初期描画し、
 *       init() が次フレームで .fading を外して --fade-in-duration-bg かけて明ける。
 *     - 離脱（フェードアウト）: leave(url) が .fading を付与し（--fade-out-duration-bg でほぼ即黒）、
 *       その duration 後に location.href = url で遷移する。
 *   遷移先ページは同じく class="fading" で読み込まれ、その init() が明けることで「黒を跨いだ」連続フェードになる。
 * 【IF】
 *   init(): void           main.ts / title.ts が _init の最初（await 前）に呼ぶ。到着フェードインを起動する。
 *   leave(url: string): void  nav.ts / title.ts / menu.ts が呼ぶ。フェードアウト後に location.href で遷移する。
 * 【依存】なし（DOM の #transition-overlay と CSS 変数 --fade-out-duration-bg を読むのみ）
 *
 * 【設計メモ】要件 06-1 は当初 --fade-scene-* / --fade-section-* の2系統を想定していたが、実装は単一
 *   オーバーレイ（.fading＋--fade-out/in-duration-bg）へ集約した。遷移の種類で出し分けはしない（正典更新済み）。
 *   「次 ep なし→目次」のフェードなし遷移は呼び出し元（nav.ts）が location.href を直接使う。
 */

let _overlay: HTMLElement | null = null;

// #transition-overlay を取得し、到着フェードインを起動する（次フレームで .fading を外す）。
// シェルは class="fading"（不透明黒）で初期描画されるため、ここで外すと --fade-in-duration-bg で明ける。
// init(): void
export function init(): void {
    _overlay = document.getElementById('transition-overlay');
    if (!_overlay) return;
    // 初回ペイント（不透明黒）を1フレーム見せてから明ける。確実に「黒→明け」のトランジションを発火させる。
    requestAnimationFrame(() => _overlay?.classList.remove('fading'));
}

// フェードアウト（.fading 付与）後に location.href で遷移する。
// prefers-reduced-motion 時・オーバーレイ非存在時は即時遷移する。
// leave(url: string): void
export function leave(url: string): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!_overlay || reduce) {
        location.href = url;
        return;
    }
    _overlay.classList.add('fading');
    window.setTimeout(() => { location.href = url; }, _fadeOutMs());
}

// --fade-out-duration-bg（"0.01s" 等）を ms に換算する。読めなければ 16ms。
// _fadeOutMs(): number
function _fadeOutMs(): number {
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--fade-out-duration-bg').trim();
    if (raw.endsWith('ms')) return parseFloat(raw) || 16;
    if (raw.endsWith('s')) return (parseFloat(raw) || 0.016) * 1000;
    return 16;
}
