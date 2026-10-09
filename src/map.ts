/*
 * map.ts
 * 責務: エシュカ地図ポップアップ（#map-overlay）の中身の生成・開閉。本文ページ（menu.ts）と
 *       目次ページ（index.ts の付録カード）で共用する。
 * export: init(): void
 *         open(opener?: HTMLElement | null): void
 *         close(): void
 *         isOpen(): boolean
 * 依存: なし（DOM と import.meta.env.BASE_URL だけを読むリーフ。.dependency-cruiser.cjs の LEAF に入れてある）
 *
 * 器と中身（characters.ts と同じ方式・要件 06-14）：
 *   - 各ページは空の器 <section id="map-overlay" hidden role="dialog"> だけを置き、init() が中身
 *     （#map-popup ＞ #map-popup-close ＋ #map-popup-link ＞ <img> ＋ #map-popup-open）を生成する
 *     ＝同期を見る機械検査の無い markup の複製を両シェルに持たない。ID は _map.css / toc.css が参照する
 *   - 器に role="dialog" を付けておくと immersive.ts の IGNORE_TAP_SELECTOR / OVERLAY_OPEN_SELECTOR が
 *     セレクタで拾う＝背景鑑賞モードのガードが自動で効く（器の ID を名指しする必要はない）
 *   - 閉じる方法：背景クリックと閉じるボタンはここで登録する。**Escape は拾わない**——ほかのポップアップとの
 *     優先順位がページごとに違うので、各ページのキー処理が isOpen() / close() を呼ぶ（characters.ts と同じ）
 *
 * 画像：
 *   - src は open() の初回だけ入れる＝**ポップアップを開くまで 231KB を落とさない**。地図は 1 枚固定なので
 *     2 回目以降は作り直さない（characters.ts が open() ごとにカードを作り直すのは中身が Stage で変わるため）
 *   - 画像と「原寸で開く ↗」はどちらも同じ URL を別タブで開く。**縦向きスマホではポップアップ内の地図が
 *     原寸の約 0.2 倍（358px ÷ 1775px）まで縮んで地名が読めない**＝別タブ導線は装飾ではなく機能の中核
 *   - 読み込みに失敗したら（配置漏れ・改名）パネルの中身を文言に差し替えてリンクを外す＝「壊れた画像
 *     アイコンと押しても 404 のリンク」を読者に見せない（index.ts の initAppendix が取得失敗でボタンを
 *     隠すのと同じ思想）
 *
 * フォーカス：open() で閉じるボタンへ移し、close() で開いた側（付録チップ／#menu-toggle）へ戻す。
 *   **戻す先は呼び出し側が渡す**——本文ではメニューを閉じてから開くので、押されたメニュー項目はもう
 *   hidden の中にいる（document.activeElement を当てにできない）。器は文書の末尾にあるので、移さないと
 *   キーボード操作で閉じるボタンへ届くまでに文書の大半を Tab で通過することになる。
 *   aria-modal は付けない（フォーカストラップを実装していないため。各シェルの HTML コメント参照）。
 *   なお characters.ts はフォーカスを移さない＝**意図的な非対称**（既存の穴を今回は触らない。design/modules/map.md）。
 *
 * 読み込む側は `import * as mapPopup from './map'` とする（menu.ts の charaPopup と同じ流儀）。
 */

// 地図画像の置き場所（BASE_URL からの相対）。vol に帰属しないサイト共通画像なので public/img/ 直下。
// ファイル名を ASCII にしてあるのは、fetch する URL に日本語名が入ったときのエンコーディング事故を避けるため
// （public/chara/*.avif は日本語名で運用できているので規約ではなく今回の選択。design/modules/map.md）。
const IMAGE_PATH = 'img/eshka-map.avif';

let _overlay: HTMLElement | null = null;
let _popup: HTMLElement | null = null;
let _img: HTMLImageElement | null = null;
let _closeBtn: HTMLButtonElement | null = null;
let _opener: HTMLElement | null = null;   // 閉じたときにフォーカスを戻す先（open() の引数）
let _srcSet = false;                      // 画像の src を入れたか（初回だけ入れる）

// 空の器 #map-overlay にパネル（閉じるボタン＋画像リンク＋「原寸で開く」）を生成し、背景クリックと
// 閉じるボタンを登録する。各ページの起動時に一度だけ呼ぶ。器が無いページでは何もしない。
// init(): void
export function init(): void {
    _overlay = document.querySelector<HTMLElement>('#map-overlay');
    if (!_overlay) return;

    const href = `${import.meta.env.BASE_URL}${IMAGE_PATH}`;

    _popup = document.createElement('article');
    _popup.id = 'map-popup';

    _closeBtn = document.createElement('button');
    _closeBtn.type = 'button';
    _closeBtn.id = 'map-popup-close';
    _closeBtn.textContent = '閉じる';
    _closeBtn.addEventListener('click', () => close());

    // 画像そのものをリンクにする＝タップ／クリックで別タブへ。accessible name は alt ではなく
    // aria-label で「原寸を新しいタブで開く」まで含める（alt だけだと「エシュカの地図」で止まる）。
    const link = document.createElement('a');
    link.id = 'map-popup-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'エシュカの地図の原寸を新しいタブで開く');

    _img = document.createElement('img');
    _img.alt = 'エシュカの地図';
    // width/height 属性は「読み込み前の箱」を確保するために置く。src が未設定でも UA はこの 2 つを
    // intrinsic dimensions として扱うので、CSS 側が width/height とも auto（＝max-* だけで収める形）の
    // まま比率ぶんの領域が取れる＝画像の到着でポップアップが跳ねない。**CSS の width/height に負ける
    // presentational hint ではない**ので _map.css 側に aspect-ratio を重ねて書く必要はない。
    _img.width = 1775;
    _img.height = 1920;
    _img.addEventListener('error', () => _showError());
    link.appendChild(_img);

    // 画像が押せることに気づかない読者のための明示的な導線（↗ は _map.css の ::after が出す）。
    const openLink = document.createElement('a');
    openLink.id = 'map-popup-open';
    openLink.href = href;
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    openLink.textContent = '原寸で開く';

    _popup.append(_closeBtn, link, openLink);
    _overlay.appendChild(_popup);

    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) close();
    });
}

// 画像の読み込みに失敗したとき、リンクごと取り除いて文言に差し替える（閉じるボタンは残す）。
// _showError(): void
function _showError(): void {
    if (!_popup || _popup.querySelector('#map-popup-error')) return;
    _popup.querySelector('#map-popup-link')?.remove();
    _popup.querySelector('#map-popup-open')?.remove();
    _img = null;

    const msg = document.createElement('p');
    msg.id = 'map-popup-error';
    msg.textContent = '地図を読み込めませんでした。';
    _popup.appendChild(msg);
}

// ポップアップを開く。初回だけ画像の src を入れる（開くまで落とさない）。
// opener には閉じたときにフォーカスを戻す要素を渡す（目次＝付録チップ／本文＝#menu-toggle）。
// open(opener?: HTMLElement | null): void
export function open(opener?: HTMLElement | null): void {
    if (!_overlay) return;

    if (_img && !_srcSet) {
        _img.src = `${import.meta.env.BASE_URL}${IMAGE_PATH}`;
        _srcSet = true;
    }

    _opener = opener ?? null;
    _overlay.hidden = false;
    // 開いたまま回転して内部スクロールが生じ得るので、開くたびに先頭へ戻す
    if (_popup) _popup.scrollTop = 0;
    _closeBtn?.focus();
}

// ポップアップを閉じ、開いた側へフォーカスを戻す。
// close(): void
export function close(): void {
    if (!_overlay) return;
    _overlay.hidden = true;
    _opener?.focus();
    _opener = null;
}

// ポップアップが開いているか（各ページの Escape 処理が優先順位を決めるのに使う）。
// isOpen(): boolean
export function isOpen(): boolean {
    return _overlay !== null && !_overlay.hidden;
}
