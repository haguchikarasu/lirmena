/*
 * tutorial.ts
 * 責務: 読書点（基準点）チュートリアル。常時アンカーマーカーの表示とドラッグ移動、初回ガイドのカルーセル。
 * export: init(), open(), reposition()
 * 依存: axis.ts（進行軸・書字方向の解決）／ settings.ts（読書点の所有者。ドロップ時に setReadingAnchor() で永続化）
 *
 * 読書点の値の所在（要件 06-12 / 06-4）:
 *   基準点の位置は CSS 変数 --reading-anchor（本文表示幅＝#main-container 幅基準の連続 %）を単一の源とする。
 *   settings.ts が所有・永続化し、bg.ts は CSS 変数を読むのみ。tutorial.ts はドラッグで setter を呼ぶ。
 *
 * 常時アンカー（#reading-anchor）:
 *   - #main-container の box を基準に px で配置する（bg.ts の読書点と同一基準を保つため CSS % 直指定はしない）。
 *     進行軸の位置（縦書き=left／横書き=top）に加え、直交軸の span（縦書き=top/height／横書き=left/width）も
 *     #main-container の rect に合わせる（マーカー＝本文表示エリアの進行直交端いっぱい）。配置軸の解決は axis が担う。
 *   - 見た目は「本文表示エリア両端の三角形（縦書き=上下▽/△／横書き=左右▷/◁、常時表示）＋それを結ぶ線（ドラッグ中のみ表示）」。
 *     線(.reading-anchor-line)は pointer-events: none（本文スクロールを妨げない）。形状・向きの切替は CSS（html[data-writing-mode]）。
 *   - ドラッグの掴み手は両端の三角形(.reading-anchor-cap、pointer-events を持つ <button>)。tutorial.ts が線・三角形を
 *     生成して #reading-anchor に追加する。どちらの三角形からでもドラッグ開始できる。
 *   - 進行軸方向（縦書き=左右／横書き=上下）にドラッグで自由移動。ドラッグ中は --reading-anchor をライブ更新し、#main-container に
 *     合成 scroll イベントを dispatch して bg.ts のクロスフェード中点を即追従させる（bg を import しない＝疎結合）。
 *   - ドロップ時に settings.setReadingAnchor() で連続値を永続化（スナップ・丸めなし）。
 *
 * 初回ガイド: KEY_TUTORIAL_SEEN 未設定時のみ自動表示し、表示後フラグを立てる。再表示は menu.ts の「チュートリアル」が open() を呼ぶ。
 * ガイドカルーセル: ステップ（バッジ・見出し・本文・CSS 図解・案内役立ち絵）は STEPS から tutorial.ts が生成する
 *   （#tutorial-popup は空の器で、本文シェルに中身は持たない）。カードの枠・戻る/次へ・ドット・立ち絵は _buildShell() で
 *   一度だけ作り、送り操作は _update() で中身だけ差し替える（カードを作り直さない＝出現アニメの再発なし）。
 *   デバイス×書字方向（図解の三角の向き等）は CSS の html[data-device][data-writing-mode] が解決する（device を
 *   import しない＝疎結合）。立ち絵の background-image は public 参照を import.meta.env.BASE_URL で JS 注入する。
 *   カード/見出し帯の高さは _measureMax() で全ステップ最大に固定（送ってもサイズ・絵の位置が動かない）。
 *   操作: カード地クリックで次へ／最後で閉じる、背景クリック・×・Escape で閉じる、戻る/次へボタンで前後。
 */

import * as axis from './axis';
import * as settings from './settings';

const KEY_TUTORIAL_SEEN = 'lirmena.tutorialSeen';

// 立ち絵（public/img/tutorial/）の参照ベース。menu.ts のキャラ画像と同じ import.meta.env.BASE_URL 流儀。
const IMG_BASE = `${import.meta.env.BASE_URL}img/tutorial/`;

// オーバーレイの上下 padding（_tutorial.css の #tutorial-popup padding と一致）。カード高の頭打ち算出に使う。
const OVERLAY_PAD = 24;

let _marker: HTMLElement | null = null;
let _container: HTMLElement | null = null;
let _dragging = false;
let _activeGrip: HTMLElement | null = null;

// ── 初回ガイド（カルーセル） ─────────────────────────────────────────
type FigureKind = 'anchor' | 'drag' | 'menu';
interface Step {
    badge: string;
    title: string;
    body: string;              // innerHTML（<em>/<ruby> を含む）
    figure: FigureKind | null; // CSS 図解の種類。null は図解なし（立ち絵のみ）
}

// ステップ定義。文言・図解の種類のみを持ち、向き（縦/横）や端末差は CSS が解決する。
const STEPS: Step[] = [
    {
        badge: 'ようこそ',
        title: 'この物語の読み方',
        body: 'このたびは<em><ruby>輝くもの<rt>リルメナ</rt></ruby></em>をお読みいただき、ありがとうございます。ここではこのサイトの使い方を簡単にご案内します。数ステップなので、まずは目を通してみてください。',
        figure: null,
    },
    {
        badge: '読書点',
        title: '「読書点」ってなに？',
        body: '本文の端にある2つの三角形を<em>読書点</em>と呼びます。背景の絵は、<em>この読書点を基準にして</em>移り変わります。読書点のあたりで本文を読むと、背景がちょうど良いところで切り替わります。',
        figure: 'anchor',
    },
    {
        badge: '読書点',
        title: '読書点は動かせる',
        body: '三角形を<em>つまんでドラッグ</em>すると、読書点を好きな位置に動かせます。ご自身が<em>普段文章を追いかけている場所</em>に置いてお使いください。',
        figure: 'drag',
    },
    {
        badge: 'メニュー',
        title: '右下のメニュー',
        body: '画面右下のボタンを開くと、<em>設定</em>や<em>栞</em>、<em>キャラクター紹介</em>などが見れます。設定では<em>文字の大きさ</em>、<em>縦書き / 横書き</em>の切り替え、段落間の<em>空行の有無</em>などが変更できます。',
        figure: 'menu',
    },
    {
        badge: 'それでは',
        title: 'さあ、読みはじめましょう',
        body: 'それでは、<em><ruby>輝くもの<rt>リルメナ</rt></ruby></em>をお楽しみください。この案内は、右下メニューの<em>チュートリアル</em>からいつでも見返せます。',
        figure: null,
    },
];

interface ShellRefs {
    card: HTMLElement;
    head: HTMLElement;
    badge: HTMLElement;
    title: HTMLElement;
    text: HTMLElement;
    figslot: HTMLElement;
    prev: HTMLElement;
    next: HTMLElement;
    dots: HTMLElement[];
}

let _popup: HTMLElement | null = null;
let _el: ShellRefs | null = null;
let _step = 0;
let _cardMinH = 0;   // 全ステップ最大のカード自然高（px）。0 の間は min-height を当てない＝自然高
let _headMinH = 0;   // 全ステップ最大の見出し帯の高さ（px）。head を固定してメディア帯（絵）の位置を揃える
let _resizeTimer = 0;

// 常時アンカーを表示してドラッグを結線し、ガイドの器を組み立て、初回ならガイドを出す。main.ts が起動時に呼ぶ。
// init(): void
export function init(): void {
    _container = document.getElementById('main-container');
    _marker = document.getElementById('reading-anchor');
    _buildShell();

    if (_marker && _container) {
        const line = document.createElement('span');
        line.className = 'reading-anchor-line';
        _marker.appendChild(line);

        for (const pos of ['top', 'bottom'] as const) {
            const cap = document.createElement('button');
            cap.type = 'button';
            cap.className = `reading-anchor-cap reading-anchor-cap--${pos}`;
            cap.tabIndex = -1; // ドラッグ専用。無操作のタブ停止を増やさない
            cap.setAttribute('aria-label', '読書点を移動');
            cap.addEventListener('pointerdown', _onPointerDown);
            _marker.appendChild(cap);
        }

        _marker.hidden = false;
        _positionMarker();
        window.addEventListener('resize', _positionMarker);
    }

    if (localStorage.getItem(KEY_TUTORIAL_SEEN) === null) {
        open();
        localStorage.setItem(KEY_TUTORIAL_SEEN, '1');
    }
}

// ガイドを開く（初回自動・再表示とも）。先頭ステップから表示し、表示後に全ステップ最大高を測って固定する。
// open(): void
export function open(): void {
    if (!_popup || !_el) return;
    _step = 0;
    _cardMinH = 0;
    _headMinH = 0;
    _update();
    _popup.hidden = false;
    _measureMax();   // 表示（レイアウト確定）後でないと offsetHeight が測れない
}

// マーカーを現在の #main-container 矩形・読書点に合わせて配置し直す。書字方向のライブ切替でレイアウトが
// 変わったとき main.ts が呼ぶ（resize と同じ再配置だが、属性切替では resize が発火しないため明示トリガーが要る）。
// reposition(): void
export function reposition(): void {
    _positionMarker();
}

// 現在の読書点（settings 所有の %）に合わせてマーカーを #main-container 基準の px で配置する。
// _positionMarker(): void
function _positionMarker(): void {
    if (!_marker || !_container) return;
    _layoutMarkerAt(_container.getBoundingClientRect(), settings.getReadingAnchor());
}

// 進行軸上の % からマーカーを #main-container 基準の px で配置する（settings を読まない＝ドラッグ中のライブ更新でも使う）。
// 進行軸の位置（縦書き=left／横書き=top）＝読書点、直交軸の span（縦書き=top/height／横書き=left/width）＝本文表示エリア端いっぱい。
// 形状（縦線/横線・三角の向き）は CSS（html[data-writing-mode]）が解決する。
// _layoutMarkerAt(rect: DOMRect, pct: number): void
function _layoutMarkerAt(rect: DOMRect, pct: number): void {
    if (!_marker) return;
    const anchor = axis.getAnchorPx(rect, pct / 100);
    if (axis.isReverse()) {
        _marker.style.left = `${anchor}px`;
        _marker.style.top = `${rect.top}px`;
        _marker.style.width = '';
        _marker.style.height = `${rect.height}px`;
    } else {
        _marker.style.top = `${anchor}px`;
        _marker.style.left = `${rect.left}px`;
        _marker.style.height = '';
        _marker.style.width = `${rect.width}px`;
    }
}

// ポインタの進行軸座標を #main-container 基準の読書点 %（読み始め端基準）へ変換する。axis.getAnchorPx と表裏：
// % が大きいほど読み始め端（縦書き=右／横書き=上）寄り。縦書きは左端から、横書きは下端からの割合で測る。
// 0〜100 にクランプ。進行軸ビューポート長が 0（縮退）なら null。
// _pointerToPct(e: PointerEvent, rect: DOMRect): number | null
function _pointerToPct(e: PointerEvent, rect: DOMRect): number | null {
    if (axis.isReverse()) {
        if (rect.width <= 0) return null;
        return Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    }
    if (rect.height <= 0) return null;
    return Math.min(100, Math.max(0, ((rect.bottom - e.clientY) / rect.height) * 100));
}

// ドラッグ開始。掴んだ三角形(e.currentTarget)にポインタをキャプチャして move/up を受け続ける。
// 縦線をドラッグ中のみ表示するため #reading-anchor に .dragging を付与する。
function _onPointerDown(e: PointerEvent): void {
    if (!_marker) return;
    const grip = e.currentTarget as HTMLElement;
    _activeGrip = grip;
    _dragging = true;
    _marker.classList.add('dragging');
    grip.setPointerCapture(e.pointerId);
    grip.addEventListener('pointermove', _onPointerMove);
    grip.addEventListener('pointerup', _onPointerUp);
    grip.addEventListener('pointercancel', _onPointerUp);
    e.preventDefault();
}

// ドラッグ中：ポインタの進行軸座標から #main-container 基準の % を算出し、CSS 変数・マーカー位置をライブ更新する。
// bg.ts を即追従させるため #main-container に合成 scroll を dispatch する。
function _onPointerMove(e: PointerEvent): void {
    if (!_dragging || !_container || !_marker) return;
    const rect = _container.getBoundingClientRect();
    const pct = _pointerToPct(e, rect);
    if (pct === null) return;
    document.documentElement.style.setProperty('--reading-anchor', `${pct}%`);
    _layoutMarkerAt(rect, pct);
    _container.dispatchEvent(new Event('scroll'));
}

// ドロップ：最終 % を settings に永続化する（CSS 変数反映も settings 側で行う）。
// .dragging を外して縦線を非表示に戻し、掴んでいた三角形のリスナ／キャプチャを解放する。
function _onPointerUp(e: PointerEvent): void {
    if (!_dragging || !_container || !_marker) return;
    _dragging = false;
    _marker.classList.remove('dragging');
    const rect = _container.getBoundingClientRect();
    const pct = _pointerToPct(e, rect) ?? settings.getReadingAnchor();
    settings.setReadingAnchor(pct);
    _positionMarker();
    const grip = _activeGrip;
    if (grip) {
        grip.removeEventListener('pointermove', _onPointerMove);
        grip.removeEventListener('pointerup', _onPointerUp);
        grip.removeEventListener('pointercancel', _onPointerUp);
        try { grip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    _activeGrip = null;
}

// #tutorial-popup にカードの枠・閉じる・戻る/次へ・ドット・立ち絵を一度だけ生成し、可変部分の参照を保持する。
// クリック／Escape のハンドラもここで一度だけ登録する（以後 innerHTML は作り直さない）。
// _buildShell(): void
function _buildShell(): void {
    _popup = document.getElementById('tutorial-popup');
    if (!_popup) return;

    let dots = '';
    for (let i = 0; i < STEPS.length; i++) dots += '<span class="dot"></span>';

    _popup.innerHTML =
        '<figure class="tutorial-step">' +
            '<div class="tutorial-card">' +
                '<button type="button" class="tutorial-close" aria-label="閉じる">×</button>' +
                '<div class="tutorial-head">' +
                    '<span class="tutorial-badge"></span>' +
                    '<h2 class="tutorial-title"></h2>' +
                    '<p class="tutorial-text"></p>' +
                '</div>' +
                '<div class="tutorial-media">' +
                    '<div class="tutorial-figslot"></div>' +
                    '<figure class="tutorial-guide tutorial-guide--foll" aria-hidden="true"></figure>' +
                    '<figure class="tutorial-guide tutorial-guide--rikka" aria-hidden="true"></figure>' +
                '</div>' +
                '<footer class="tutorial-foot">' +
                    '<div class="tutorial-nav">' +
                        '<button type="button" class="tutorial-prev">戻る</button>' +
                        '<div class="tutorial-dots">' + dots + '</div>' +
                        '<button type="button" class="tutorial-next">次へ</button>' +
                    '</div>' +
                '</footer>' +
            '</div>' +
        '</figure>';

    // 立ち絵の背景は public 参照を JS で注入する（CSS にビルド依存の絶対パスを埋め込まない）。
    const foll = _popup.querySelector<HTMLElement>('.tutorial-guide--foll');
    const rikka = _popup.querySelector<HTMLElement>('.tutorial-guide--rikka');
    if (foll) foll.style.backgroundImage = `url("${IMG_BASE}tutorial-guide-foll.avif")`;
    if (rikka) rikka.style.backgroundImage = `url("${IMG_BASE}tutorial-guide-rikka.avif")`;

    _el = {
        card: _popup.querySelector<HTMLElement>('.tutorial-card')!,
        head: _popup.querySelector<HTMLElement>('.tutorial-head')!,
        badge: _popup.querySelector<HTMLElement>('.tutorial-badge')!,
        title: _popup.querySelector<HTMLElement>('.tutorial-title')!,
        text: _popup.querySelector<HTMLElement>('.tutorial-text')!,
        figslot: _popup.querySelector<HTMLElement>('.tutorial-figslot')!,
        prev: _popup.querySelector<HTMLElement>('.tutorial-prev')!,
        next: _popup.querySelector<HTMLElement>('.tutorial-next')!,
        dots: Array.from(_popup.querySelectorAll<HTMLElement>('.tutorial-dots .dot')),
    };

    _popup.addEventListener('click', _onPopupClick);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _popup && !_popup.hidden) _close();
    });
    // ウィンドウ幅が変わると本文の折返し行数＝最大高が変わる。開いている間だけ測り直す（間引き）。
    window.addEventListener('resize', () => {
        window.clearTimeout(_resizeTimer);
        _resizeTimer = window.setTimeout(() => { if (_popup && !_popup.hidden) _measureMax(); }, 150);
    });
}

// CSS 図解の HTML を組み立てる。向き（縦/横）は CSS が html[data-writing-mode] で解決する。
// _figureHTML(kind: FigureKind): string
function _figureHTML(kind: FigureKind): string {
    if (kind === 'anchor' || kind === 'drag') {
        // fig-line=読書点の線（緑）、fig-arrow=動かす方向（中立色）で概念を色分けする
        return '' +
            '<div class="fig fig-anchor' + (kind === 'drag' ? ' is-drag' : '') + '" aria-hidden="true">' +
                '<div class="fig-band">' +
                    '<span class="fig-line"></span>' +
                    '<span class="fig-cap fig-cap--start"></span>' +
                    '<span class="fig-cap fig-cap--end"></span>' +
                    (kind === 'drag' ? '<span class="fig-arrow"></span>' : '') +
                '</div>' +
            '</div>';
    }
    // kind === 'menu'：実在するメニュー項目を並べ、本文で触れる「栞を追加 / キャラクター紹介 / 設定」を強調する
    const items = ['目次へ戻る', '栞を追加', 'チュートリアル', 'キャラクター紹介', '設定', '共有'];
    const hi: Record<string, boolean> = { '栞を追加': true, 'キャラクター紹介': true, '設定': true };
    const lis = items.map((t) => '<li class="' + (hi[t] ? 'is-hi' : '') + '">' + t + '</li>').join('');
    return '' +
        '<div class="fig fig-menu" aria-hidden="true">' +
            '<div class="fig-menu-panel"><ul>' + lis + '</ul></div>' +
            '<div class="fig-fab">☰</div>' +
        '</div>';
}

// 現ステップ(_step)の中身だけを差し替える（枠・ボタン・立ち絵の位置は据え置き）。
// _update(): void
function _update(): void {
    if (!_el) return;
    const s = STEPS[_step];
    const last = _step === STEPS.length - 1;
    _el.badge.textContent = s.badge;
    _el.title.textContent = s.title;
    _el.text.innerHTML = s.body;
    _el.figslot.innerHTML = s.figure ? '<div class="tutorial-figure">' + _figureHTML(s.figure) + '</div>' : '';
    _el.prev.style.visibility = _step > 0 ? 'visible' : 'hidden';   // 位置は保ったまま隠す
    _el.next.textContent = last ? 'はじめる' : '次へ';
    _el.dots.forEach((d, i) => d.classList.toggle('is-on', i === _step));
    _el.card.style.minHeight = _cardMinH ? `${_cardMinH}px` : '';
    _el.head.style.minHeight = _headMinH ? `${_headMinH}px` : '';   // 見出し帯を固定→メディア帯（絵）の位置を全ステップで揃える
}

// 見出し帯・カードの最大高を測って固定する（2パス: head 確定後に card を測る）。表示中でないと測れない。
// _measureMax(): void
function _measureMax(): void {
    if (!_el || !_popup || _popup.hidden) return;
    const saved = _step;
    // パス1: 見出し帯の最大高を測る（両方解除して自然高で）
    _cardMinH = 0; _headMinH = 0;
    let maxHead = 0;
    for (let i = 0; i < STEPS.length; i++) { _step = i; _update(); maxHead = Math.max(maxHead, _el.head.offsetHeight); }
    _headMinH = maxHead;
    // パス2: 見出し帯を固定した状態でカードの最大高を測る（head 確定後でないと media 高がズレる）
    _cardMinH = 0;
    let maxCard = 0;
    for (let i = 0; i < STEPS.length; i++) { _step = i; _update(); maxCard = Math.max(maxCard, _el.card.offsetHeight); }
    // 短い viewport では固定高を可視領域に頭打ちする（強制 min-height がビューポートを超えると footer/× が画面外に出るため。
    // 超過分は CSS の max-height + overflow-y:auto でカード内スクロールに回る）。
    const avail = window.innerHeight - OVERLAY_PAD * 2;
    _cardMinH = Math.min(maxCard, avail);
    _step = saved;
    _update();   // 両方 min-height 適用済みで元のステップに戻す
}

// #tutorial-popup のクリックを振り分ける（カード地＝次へ、背景・×＝閉じる、戻る/次へ＝前後）。
// 立ち絵は pointer-events:none なので「次へ」を妨げない。
// _onPopupClick(e: MouseEvent): void
function _onPopupClick(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    if (!t || !_popup) return;
    if (t === _popup) { _close(); return; }                 // 背景（カード外）クリックで閉じる
    if (t.closest('.tutorial-close')) { _close(); return; }
    if (t.closest('.tutorial-prev')) { _prev(); return; }
    if (t.closest('.tutorial-next')) { _next(); return; }
    if (t.closest('.tutorial-card')) { _next(); return; }   // カード地クリックで次へ／最後で閉じる
}

// 次のステップへ進む。最後のステップを越えたら閉じる。
// _next(): void
function _next(): void {
    _step++;
    if (_step >= STEPS.length) { _close(); return; }
    _update();
}

// 前のステップへ戻る（先頭では何もしない）。
// _prev(): void
function _prev(): void {
    if (_step > 0) { _step--; _update(); }
}

// ガイドを閉じる（hidden を付与）。
// _close(): void
function _close(): void {
    if (_popup) _popup.hidden = true;
}
