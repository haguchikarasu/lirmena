/*
 * tutorial.ts
 * 責務: 読書点（基準点）チュートリアル。常時アンカーマーカーの表示とドラッグ移動、初回ガイドの画像カルーセル。
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
 * 初回ガイド: KEY_TUTORIAL_SEEN 未設定時のみ表示し、表示後フラグを立てる。再表示は menu.ts の「読み方」が open() を呼ぶ。
 * ガイド画像カルーセル: ステップ（画像＋説明文）は本文シェルの #tutorial-popup に静的記述（.tutorial-step、画像は
 *   public/contents/img/）。tutorial.ts は現在ステップの hidden 切替ロジックのみを持つ（カードクリックで次へ／最後で閉じる）。
 *   各画像にキャラクターが描き込まれているため、説明文(.tutorial-text)はキャラクターに被らない縦中央バンドへ重ねる（要件 06-12）。
 */

import * as axis from './axis';
import * as settings from './settings';

const KEY_TUTORIAL_SEEN = 'lirmena.tutorialSeen';

let _marker: HTMLElement | null = null;
let _container: HTMLElement | null = null;
let _popup: HTMLElement | null = null;
let _steps: HTMLElement[] = [];   // #tutorial-popup 内の .tutorial-step（本文シェルに静的記述）
let _step = 0;                    // 現在表示中のステップ index
let _dragging = false;
let _activeGrip: HTMLElement | null = null;

// 常時アンカーを表示してドラッグを結線し、初回ならガイドポップアップを出す。main.ts が起動時に呼ぶ。
// init(): void
export function init(): void {
    _container = document.getElementById('main-container');
    _marker = document.getElementById('reading-anchor');
    _initPopup();

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

// ガイドを開く（再表示。menu.ts の「読み方」が呼ぶ）。先頭ステップから表示する。
// open(): void
export function open(): void {
    if (!_popup) return;
    _step = 0;
    _render();
    _popup.hidden = false;
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

// #tutorial-popup の静的ステップ(.tutorial-step)を集め、クリック／Escape の挙動を登録する。
// 中身（画像＋説明文）は本文シェルに静的記述済みで、ここでは生成しない。
// _initPopup(): void
function _initPopup(): void {
    _popup = document.getElementById('tutorial-popup');
    if (!_popup) return;
    _steps = Array.from(_popup.querySelectorAll<HTMLElement>('.tutorial-step'));

    _popup.addEventListener('click', (e) => {
        if (e.target === _popup) _close();   // 背景（カード外）クリックでスキップ閉じ
        else _advance();                     // カード（画像）クリックで次へ／最後なら閉じる
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _popup && !_popup.hidden) _close();
    });
}

// 現在のステップ(_step)だけを表示し、ほかを隠す。
// _render(): void
function _render(): void {
    _steps.forEach((step, i) => { step.hidden = i !== _step; });
}

// 次のステップへ進む。最後のステップを越えたら閉じる（カードクリックのハンドラ）。
// _advance(): void
function _advance(): void {
    _step++;
    if (_step >= _steps.length) { _close(); return; }
    _render();
}

// ガイドを閉じる（hidden を付与）。
// _close(): void
function _close(): void {
    if (_popup) _popup.hidden = true;
}
