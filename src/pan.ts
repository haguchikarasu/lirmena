/*
 * pan.ts
 * 責務: マウスの「手のひら（パン）ツール」。本文ページの横スクロールコンテナ（#main-container）を
 *       マウス左ドラッグで横スクロールする。デフォルトが手のひら（ドラッグ＝スクロール）で、Shift キーの
 *       「単独 tap（押して離す）」で選択モードをトグルし、ON の間は通常クリック／ドラッグでテキスト選択ができる。
 *       マウス限定（タッチ／ペンは既存のネイティブ横スクロールのまま）。微調整＝ホイール（main.ts）／大量移動＝
 *       ドラッグ、の棲み分けを担う。
 * export: init(): void ／ computePanForward(...): number ／ shouldPanFromInput(...): boolean
 *         ／ smoothVelocity(...): number ／ decayVelocity(...): number ／ shouldStartMomentum(...): boolean
 *         （init 以外はすべて DOM 非依存の純関数＝テスト用）。
 * 依存: axis.ts（進行軸・書字方向の解決）。ほかは #main-container の DOM と <html>.is-selecting クラスのみ操作する。
 *
 * 結線: main.ts がホイールリスナー登録の直後に init() を1度だけ呼ぶ。
 *   パンは axis.setProgress で forward 位置を書き換えるだけで、スクロール由来の波及（背景クロスフェード・進捗・
 *   オートセーブ・開幕判定・読了検知）は既存の scroll イベント → bg.ts → reader.ts／nav.ts の購読が
 *   自動追従する（このモジュールからの新規配線は不要）。慣性スクロール（下記）も forward を動かすだけなので同様に追従する。
 *
 * 慣性（momentum・大量移動のフリック送り）:
 *   pointermove ごとに離脱速度（forward px/ms・正＝読み進め方向）を指数平滑で追跡し、pointerup で
 *   その速度が閾値（MIN_FLICK_VELOCITY）以上なら摩擦減衰の rAF スクロールを走らせる（フィーリングは「標準」＝
 *   OS のスクロールに近い自然な減速）。閾値未満の微調整ドラッグは慣性を出さずその場で正確に止まる。
 *   prefers-reduced-motion 時は慣性を無効化（即停止）。慣性走行中に新たな pointerdown が来たら停止（＝タップで停止）。
 *   端は forward 可動域 [0, range]（range = axis.getProgressRange）でクランプし、端に達したら停止（バウンスなし）。
 *
 * 暴発防止（要件 06-1）:
 *   パン開始は「左ボタン（button===0）＋モディファイヤ無し＋pointerType==='mouse'」かつ
 *   インタラクティブ要素（端ボタン・FAB・開幕アフォーダンス・読書点ノブ）の上でないときだけ。
 *   Shift/Ctrl/Cmd/Alt のいずれかが押されていればパンせずブラウザに委ねる（Mac の Ctrl+クリック＝
 *   右クリック等と喧嘩しない）。右／中ボタンも対象外（コンテキストメニュー・オートスクロールを温存）。
 *
 * 選択モードへの切り替え（Shift tap でトグル・要件 06-1 / 06-6）:
 *   Shift キーの「単独 tap（修飾キー同伴なし・他キー混在なし）」を検出して <html>.is-selecting を
 *   トグルする。判定アルゴリズム：keydown で Shift が単独で押されたら tap 候補 ON ／ その後 Shift 以外の
 *   キーが押されたら候補 OFF（Ctrl+Shift+C など組合せを誤発火させない）／ Shift の keyup 時に候補が
 *   ON のままならトグル。is-selecting ON 中は #main-container のパンを開始しない（通常クリック／ドラッグを
 *   ブラウザのネイティブ選択に委ねる）。トグル状態はページ滞在中だけ維持（ナビゲーション後・初回ロード時は OFF）。
 *   blur 解除はしない（フォーカスが外れても選択中の状態を維持したいユースケースのため）。
 *
 * 背景鑑賞モード（immersive.ts・要件 06-3）:
 *   <html>.is-immersive の間はパンを開始しない。鑑賞モード中は CSS が #main-container を pointer-events:none に
 *   するため本リスナーは元々発火しないが、明示ガードで二重に担保する（is-immersive クラスを読むだけ＝疎結合）。
 */

import * as axis from './axis';

// パン開始時に「読ませない／反応させない」インタラクティブ要素のセレクタ。
// これらの上で押下されたドラッグはパンにせず、各自のクリック／ドラッグ挙動を温存する。
const INTERACTIVE_SELECTOR = 'button, a, .reading-anchor-cap';

// 慣性（momentum）のフィーリング定数（「標準」＝自然な減速）。すべて後から微調整できる。
export const FRAME_REF_MS = 1000 / 60; // 減衰の基準フレーム時間（≈16.67ms）。decayVelocity の指数の基準（テスト用に公開）。
const VELOCITY_SMOOTHING = 0.6;        // 離脱速度の指数平滑で「新しい瞬間速度」に置く重み（0〜1。小さいほど離す直前のフリックに鈍くなる）。
const FRICTION = 0.88;                  // 基準1フレームあたりの速度減衰率（小さいほど早く止まる＝滑走が短い）。
const MIN_FLICK_VELOCITY = 0.3;        // 慣性を開始する離脱速度の下限（px/ms。大きいほど発火しにくい）。未満は微調整とみなし即停止。
const MIN_MOMENTUM_VELOCITY = 0.02;    // 慣性ループを終了する速度の下限（px/ms）。

// パン中フラグ・ドラッグ起点（進行軸ポインタ座標）・起点 forward 位置・捕捉中の pointerId。
let _panning = false;
let _startPointer = 0;
let _startForward = 0;
let _pointerId = -1;

// 慣性用：直近 pointermove の進行軸ポインタ座標／タイムスタンプ（速度算出）・平滑化した離脱速度（forward px/ms）・慣性 rAF ハンドル（0=停止）。
let _lastPointer = 0;
let _lastT = 0;
let _velocity = 0;
let _momentumRAF = 0;

// #main-container を取得し、手のひらツールの入力ハンドラを登録する。main.ts が起動時に1度だけ呼ぶ。
// init(): void
export function init(): void {
    const container = document.querySelector<HTMLElement>('#main-container');
    if (!container) return;

    container.addEventListener('pointerdown', (e) => _onPointerDown(container, e));

    // Shift キーの単独 tap（修飾キー同伴・他キー混在なし）で選択モードをトグルする。
    // 表示・選択可否の実体は CSS（html.is-selecting #main-container）。トグル状態はページ滞在中のみ維持。
    document.addEventListener('keydown', _onKeyDownForToggle);
    document.addEventListener('keyup', _onKeyUpForToggle);
    // Shift 押下中に何らかの pointer 操作が入った場合（Shift+クリック等）は tap ではないので候補を倒す。
    document.addEventListener('pointerdown', _cancelShiftTapCandidate);
}

// 押下を判定し、パン条件を満たすときだけドラッグ追従スクロールを開始する。
// _onPointerDown(container: HTMLElement, e: PointerEvent): void
function _onPointerDown(container: HTMLElement, e: PointerEvent): void {
    // 慣性走行中の押下は常に慣性を止める（新規パン開始でなくても「タップで停止」させる）。
    _cancelMomentum();
    // 背景鑑賞モード中はパンしない（CSS の pointer-events:none で通常届かないが明示的に弾く）。
    if (document.documentElement.classList.contains('is-immersive')) return;
    // 選択モード中はパンせず、ブラウザのネイティブテキスト選択に委ねる。
    if (document.documentElement.classList.contains('is-selecting')) return;
    if (!shouldPanFromInput(e)) return;
    // インタラクティブ要素（端ボタン・FAB・開幕アフォーダンス・読書点ノブ）の上ではパンしない。
    if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) return;

    _panning = true;
    _startPointer = _pointerAlong(e);
    _startForward = axis.getProgress(container);
    _pointerId = e.pointerId;
    // 離脱速度トラッキングの初期化（起点を現在位置・現在時刻に置く）。
    _velocity = 0;
    _lastPointer = _pointerAlong(e);
    _lastT = performance.now();

    // ドラッグがコンテナ外（背景レイヤー上など）へ出ても追従できるよう捕捉する。
    container.setPointerCapture(e.pointerId);
    container.classList.add('is-panning'); // カーソルを grabbing に（CSS）
    e.preventDefault();                    // 画像ドラッグ等の既定動作を抑止

    container.addEventListener('pointermove', _onPointerMove);
    container.addEventListener('pointerup', _onPointerUp);
    container.addEventListener('pointercancel', _onPointerUp);
}

// パン中の移動。content-follows-cursor で forward 位置を axis.setProgress で更新する（端はブラウザが自動クランプ）。
// あわせて離脱速度（forward px/ms・pointerup 後の慣性に使う）を指数平滑で追跡する。
// _onPointerMove(e: PointerEvent): void
function _onPointerMove(e: PointerEvent): void {
    if (!_panning) return;
    const container = e.currentTarget as HTMLElement;
    const pointer = _pointerAlong(e);
    axis.setProgress(container, computePanForward(_startForward, _startPointer, pointer, axis.sign()));

    // 瞬間 forward 速度（content-follows-cursor で forward 変化＝-sign×dPointer）を平滑化して _velocity に積む。
    const now = performance.now();
    const dt = now - _lastT;
    if (dt > 0) {
        const instantaneous = -axis.sign() * (pointer - _lastPointer) / dt;
        _velocity = smoothVelocity(_velocity, instantaneous, VELOCITY_SMOOTHING);
        _lastPointer = pointer;
        _lastT = now;
    }
}

// パン終了。捕捉とリスナーを解放し、カーソルを手のひらへ戻す。
// 離脱速度が十分（フリック）なら慣性スクロールへ引き継ぐ（reduced-motion 時は引き継がない）。
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

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && shouldStartMomentum(_velocity, MIN_FLICK_VELOCITY)) _startMomentum(container);
}

// 離脱速度から摩擦で自然減速する慣性スクロールを rAF で回す。位置は forward px（float）で持ち、
// 可動域 [0, range] で自前クランプする（端に達したら停止＝バウンスなし）。速度が下限を切ったら停止する。
// _startMomentum(container: HTMLElement): void
function _startMomentum(container: HTMLElement): void {
    let pos = axis.getProgress(container);
    const range = axis.getProgressRange(container); // forward 可動域の終端
    let last = performance.now();

    const step = (now: number): void => {
        const dt = now - last;
        last = now;
        _velocity = decayVelocity(_velocity, dt, FRICTION);
        if (Math.abs(_velocity) < MIN_MOMENTUM_VELOCITY) { _momentumRAF = 0; return; }

        pos += _velocity * dt;
        const clamped = Math.max(0, Math.min(range, pos));
        axis.setProgress(container, clamped);
        if (clamped !== pos) { _momentumRAF = 0; return; } // 端に到達したら停止

        _momentumRAF = requestAnimationFrame(step);
    };
    _momentumRAF = requestAnimationFrame(step);
}

// 走行中の慣性アニメを停止し、速度をリセットする（pointerdown ＝タップで停止に使う）。
// _cancelMomentum(): void
function _cancelMomentum(): void {
    if (_momentumRAF) {
        cancelAnimationFrame(_momentumRAF);
        _momentumRAF = 0;
    }
    _velocity = 0;
}

// Shift 単独 tap の検出状態：keydown で候補 ON → 他キー混在 or 修飾キー同伴で OFF → keyup で発火判定。
let _shiftTapCandidate = false;

// keydown ハンドラ：Shift 単独押下なら tap 候補を立て、それ以外の押下では候補を倒す。
// Shift+他キー（Ctrl+Shift+C 等）・Shift と他キーの押し順を問わず誤発火を防ぐ。
// _onKeyDownForToggle(e: KeyboardEvent): void
function _onKeyDownForToggle(e: KeyboardEvent): void {
    if (e.key === 'Shift') {
        // 他の修飾キーが既に押されている／キーリピートでの再発火は tap として扱わない。
        _shiftTapCandidate = !(e.ctrlKey || e.altKey || e.metaKey || e.repeat);
        return;
    }
    // Shift 以外のキー押下が来た時点で tap ではなくなる（Shift+任意キーの組合せ）。
    _shiftTapCandidate = false;
}

// keyup ハンドラ：Shift の解放時に候補が立っていれば選択モードをトグルする。
// _onKeyUpForToggle(e: KeyboardEvent): void
function _onKeyUpForToggle(e: KeyboardEvent): void {
    if (e.key !== 'Shift') return;
    if (_shiftTapCandidate) _toggleSelecting();
    _shiftTapCandidate = false;
}

// pointer 操作（Shift+クリック等）が入ったら tap ではないので候補を倒す。
// _cancelShiftTapCandidate(): void
function _cancelShiftTapCandidate(): void {
    _shiftTapCandidate = false;
}

// <html>.is-selecting をトグルする。CSS が #main-container のカーソル／user-select を切り替える。
// _toggleSelecting(): void
function _toggleSelecting(): void {
    document.documentElement.classList.toggle('is-selecting');
}

// ポインタイベントから進行軸方向の座標を取り出す（縦書き=水平 clientX／横書き=垂直 clientY）。
// _pointerAlong(e: PointerEvent): number
function _pointerAlong(e: PointerEvent): number {
    return axis.isReverse() ? e.clientX : e.clientY;
}

// 起点 forward 位置・起点ポインタ座標・現在ポインタ座標・進行符号 sign から、パン後の forward 位置を返す。
// content-follows-cursor：掴んだ内容がポインタに追従する。進行軸のポインタ移動 (current-start) に対し forward は
// -sign 倍で動く（縦書き sign=-1：進行軸正方向＝右ドラッグで forward 増／横書き sign=+1：上ドラッグで forward 増）。変化は 1:1。
// computePanForward(startForward: number, startPointer: number, currentPointer: number, sign: 1 | -1): number
export function computePanForward(startForward: number, startPointer: number, currentPointer: number, sign: 1 | -1): number {
    return startForward - sign * (currentPointer - startPointer);
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

// 瞬間速度を指数平滑して安定した離脱速度を得る。weight は新サンプル（instantaneous）に置く重み（0〜1）。
// weight=1 で新値そのまま・weight=0 で旧値（prev）そのまま。
// smoothVelocity(prev: number, instantaneous: number, weight: number): number
export function smoothVelocity(prev: number, instantaneous: number, weight: number): number {
    return prev * (1 - weight) + instantaneous * weight;
}

// 摩擦による速度減衰。friction は基準1フレーム（FRAME_REF_MS）あたりの減衰率で、実際の経過 dtMs に対して
// フレームレート非依存になるよう指数補正する（dtMs=FRAME_REF_MS なら velocity*friction、dtMs=0 なら不変）。
// decayVelocity(velocity: number, dtMs: number, friction: number): number
export function decayVelocity(velocity: number, dtMs: number, friction: number): number {
    return velocity * Math.pow(friction, dtMs / FRAME_REF_MS);
}

// 離脱速度が閾値以上なら慣性を開始すべきか。スクロール方向に依らず絶対値で判定する。
// shouldStartMomentum(velocity: number, threshold: number): boolean
export function shouldStartMomentum(velocity: number, threshold: number): boolean {
    return Math.abs(velocity) >= threshold;
}
