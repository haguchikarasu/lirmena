/*
 * pan.ts
 * 責務: マウスの「手のひら（パン）ツール」。本文ページの横スクロールコンテナ（#main-container）を
 *       マウス左ドラッグで横スクロールする。デフォルトが手のひら（ドラッグ＝スクロール）で、Shift を
 *       押している間だけ選択ツール（テキスト選択）へ譲る。マウス限定（タッチ／ペンは既存のネイティブ
 *       横スクロールのまま）。微調整＝ホイール（main.ts）／大量移動＝ドラッグ、の棲み分けを担う。
 * export: init(): void ／ computePanScrollLeft(...): number ／ shouldPanFromInput(...): boolean（テスト用の純関数）
 * 依存: なし（#main-container の DOM と <html>.is-selecting クラスのみを操作する。他モジュール非依存）。
 *
 * 結線: main.ts がホイールリスナー登録の直後に init() を1度だけ呼ぶ。
 *   パンは container.scrollLeft を直接書き換えるだけで、スクロール由来の波及（背景クロスフェード・進捗・
 *   オートセーブ・開幕判定・読了検知）は既存の scroll イベント → bg.ts → reader.ts／nav.ts の購読が
 *   自動追従する（このモジュールからの新規配線は不要）。
 *
 * 暴発防止（要件 06-1）:
 *   パン開始は「左ボタン（button===0）＋モディファイヤ無し＋pointerType==='mouse'」かつ
 *   インタラクティブ要素（端ボタン・FAB・開幕アフォーダンス・読書点ノブ）の上でないときだけ。
 *   Shift/Ctrl/Cmd/Alt のいずれかが押されていればパンせずブラウザに委ねる（Mac の Ctrl+クリック＝
 *   右クリック等と喧嘩しない）。右／中ボタンも対象外（コンテキストメニュー・オートスクロールを温存）。
 *
 * 選択ツールへの切り替え（押しっぱなし・要件 06-1）:
 *   Shift の押下状態を <html>.is-selecting に反映するだけ（カーソルと user-select の切り替えは CSS）。
 *   Shift+ドラッグはネイティブのテキスト選択に委ねる（パンを開始しない）。
 *
 * 背景鑑賞モード（immersive.ts・要件 06-3）:
 *   <html>.is-immersive の間はパンを開始しない。鑑賞モード中は CSS が #main-container を pointer-events:none に
 *   するため本リスナーは元々発火しないが、明示ガードで二重に担保する（is-immersive クラスを読むだけ＝疎結合）。
 */

// パン開始時に「読ませない／反応させない」インタラクティブ要素のセレクタ。
// これらの上で押下されたドラッグはパンにせず、各自のクリック／ドラッグ挙動を温存する。
const INTERACTIVE_SELECTOR = 'button, a, .reading-anchor-cap';

// パン中フラグ・ドラッグ起点（clientX）・起点スクロール量・捕捉中の pointerId。
let _panning = false;
let _startX = 0;
let _startScrollLeft = 0;
let _pointerId = -1;

// #main-container を取得し、手のひらツールの入力ハンドラを登録する。main.ts が起動時に1度だけ呼ぶ。
// init(): void
export function init(): void {
    const container = document.querySelector<HTMLElement>('#main-container');
    if (!container) return;

    container.addEventListener('pointerdown', (e) => _onPointerDown(container, e));

    // Shift 押下中だけ選択ツール（カーソル＝Iビーム・user-select 有効）にする状態を <html> に反映する。
    // 表示・選択可否の実体は CSS（html.is-selecting #main-container）。離した瞬間に手のひらへ戻る。
    document.addEventListener('keydown', _syncSelecting);
    document.addEventListener('keyup', _syncSelecting);
    // フォーカスを失うと keyup を取りこぼし Iビームのまま固着しうるため、blur で確実に解除する。
    window.addEventListener('blur', () => _setSelecting(false));
}

// 押下を判定し、パン条件を満たすときだけドラッグ追従スクロールを開始する。
// _onPointerDown(container: HTMLElement, e: PointerEvent): void
function _onPointerDown(container: HTMLElement, e: PointerEvent): void {
    // 背景鑑賞モード中はパンしない（CSS の pointer-events:none で通常届かないが明示的に弾く）。
    if (document.documentElement.classList.contains('is-immersive')) return;
    if (!shouldPanFromInput(e)) return;
    // インタラクティブ要素（端ボタン・FAB・開幕アフォーダンス・読書点ノブ）の上ではパンしない。
    if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) return;

    _panning = true;
    _startX = e.clientX;
    _startScrollLeft = container.scrollLeft;
    _pointerId = e.pointerId;

    // ドラッグがコンテナ外（背景レイヤー上など）へ出ても追従できるよう捕捉する。
    container.setPointerCapture(e.pointerId);
    container.classList.add('is-panning'); // カーソルを grabbing に（CSS）
    e.preventDefault();                    // 画像ドラッグ等の既定動作を抑止

    container.addEventListener('pointermove', _onPointerMove);
    container.addEventListener('pointerup', _onPointerUp);
    container.addEventListener('pointercancel', _onPointerUp);
}

// パン中の移動。content-follows-cursor で scrollLeft を直接更新する（端はブラウザが自動クランプ）。
// _onPointerMove(e: PointerEvent): void
function _onPointerMove(e: PointerEvent): void {
    if (!_panning) return;
    const container = e.currentTarget as HTMLElement;
    container.scrollLeft = computePanScrollLeft(_startScrollLeft, _startX, e.clientX);
}

// パン終了。捕捉とリスナーを解放し、カーソルを手のひらへ戻す。
// _onPointerUp(e: PointerEvent): void
function _onPointerUp(e: PointerEvent): void {
    if (!_panning) return;
    _panning = false;
    const container = e.currentTarget as HTMLElement;
    if (container.hasPointerCapture(_pointerId)) container.releasePointerCapture(_pointerId);
    container.classList.remove('is-panning');
    container.removeEventListener('pointermove', _onPointerMove);
    container.removeEventListener('pointerup', _onPointerUp);
    container.removeEventListener('pointercancel', _onPointerUp);
}

// Shift の押下状態を <html>.is-selecting へ反映する（keydown / keyup 共通ハンドラ）。
// _syncSelecting(e: KeyboardEvent): void
function _syncSelecting(e: KeyboardEvent): void {
    _setSelecting(e.shiftKey);
}

// <html>.is-selecting を付け外しする。CSS が #main-container のカーソル／user-select を切り替える。
// _setSelecting(on: boolean): void
function _setSelecting(on: boolean): void {
    document.documentElement.classList.toggle('is-selecting', on);
}

// 起点スクロール量・起点 clientX・現在 clientX から、パン後の scrollLeft を返す。
// content-follows-cursor：マウスを右へ動かす（currentX 増）と scrollLeft が減り、縦書き負モデルの
// forward（scrollLeft が負方向）と一致する。移動量と scrollLeft の変化は 1:1。
// computePanScrollLeft(startScrollLeft: number, startX: number, currentX: number): number
export function computePanScrollLeft(startScrollLeft: number, startX: number, currentX: number): number {
    return startScrollLeft - (currentX - startX);
}

// 押下イベントがパン開始の条件（マウス・左ボタン・モディファイヤ無し）を満たすか。
// インタラクティブ要素上かどうかの DOM 判定は含めない（呼び出し側で closest により別途除外する）。
// shouldPanFromInput(input): boolean
export function shouldPanFromInput(input: {
    pointerType: string;
    button: number;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
}): boolean {
    if (input.pointerType !== 'mouse') return false;        // タッチ／ペンはネイティブスクロール
    if (input.button !== 0) return false;                   // 左ボタンのみ
    if (input.shiftKey || input.ctrlKey || input.metaKey || input.altKey) return false; // 修飾キーは委譲
    return true;
}
