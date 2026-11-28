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
 *                          加えて pageshow(event.persisted) を購読し、bfcache 復元（戻る/進む）でも .fading を外す
 *                          （復元時は DOMContentLoaded・init() が再実行されず黒幕が残るため。後述の設計メモ参照）。
 *   leave(url: string): void  nav.ts / title.ts / menu.ts が呼ぶ。フェードアウト後に location.href で遷移する。
 *   setLinkUrl(a: HTMLAnchorElement, url: string | null): void
 *                          遷移のリンク（本文末の「次へ」「第◯巻あとがき」、タイトルの「本文を読む」「前の話へ」）に
 *                          行き先を入れる。null なら外す（行き先の無いリンク＝押せない・Tab で止まらない）。
 *   isPlainClick(e: MouseEvent): boolean
 *                          そのクリックを「このタブで移る」として自分で扱ってよいか。false のとき（Ctrl・Shift などを
 *                          押している、左以外のボタン）は何もせずブラウザに任せる＝新しいタブ・新しいウィンドウで開く。
 *   【リンクの約束】行き先は <a href> が持ち、ふつうのクリックと Enter だけを preventDefault して leave() に回す
 *     （フェードと、移る前に書くもの＝pendingScrollEnd のため）。新しいタブで開いたときは何も書かない＝そのページを
 *     ふつうに開いたときと同じ。雛形の <a> には href を書かない：行き先は公開状態で決まり、決めるのは state.ts だけ。
 * 【依存】なし（DOM の #transition-overlay と CSS 変数 --fade-out-duration-bg を読むのみ）
 *
 * 【設計メモ】要件 06-1 は当初 --fade-scene-* / --fade-section-* の2系統を想定していたが、実装は単一
 *   オーバーレイ（.fading＋--fade-out/in-duration-bg）へ集約した。遷移の種類で出し分けはしない（正典更新済み）。
 *   「次 ep なし→目次」のフェードなし遷移は呼び出し元（nav.ts）が location.href を直接使う。
 *
 * 【設計メモ：bfcache 対応】leave() は .fading（不透明黒）を付けてから location.href するため、離脱元ページは
 *   「真っ黒な DOM 状態」で去る。シェル→シェル後に戻る/進むでそのページが bfcache から復元されると、
 *   DOMContentLoaded・init() が再実行されず .fading が外れたまま固定＝真っ暗になる。これを防ぐため init() で
 *   pageshow(event.persisted) を購読し、bfcache 復元時にも .fading を外す（目次への遷移は .fading を使わない
 *   ため対象外）。
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

    // bfcache（戻る/進む）復元では DOMContentLoaded・init() が再実行されず、leave() が付けた
    // .fading（不透明黒）のまま画面が固定されて真っ暗になる。pageshow(persisted) で明ける。
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) _overlay?.classList.remove('fading');
    });
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

// 遷移のリンクに行き先を入れる。null なら外す。
// tabindex="0" は、Safari が既定ではリンクに Tab で止まらないため（ボタンだったときと同じく Tab で届くようにする）。
// 行き先が無いあいだは付けない＝押せないものに Tab で止めない。
// setLinkUrl(a: HTMLAnchorElement, url: string | null): void
export function setLinkUrl(a: HTMLAnchorElement, url: string | null): void {
    if (url === null) {
        a.removeAttribute('href');
        a.removeAttribute('tabindex');
        return;
    }
    a.setAttribute('href', url);
    a.tabIndex = 0;
}

// そのクリックを「このタブで移る」として自分で扱ってよいか。
// 修飾キーつき（新しいタブ・ウィンドウ・保存）と左以外のボタンは、ブラウザの動きを奪わない。
// キーボードの Enter は button 0・修飾なしの click として来る。
// isPlainClick(e: MouseEvent): boolean
export function isPlainClick(e: MouseEvent): boolean {
    return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
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
