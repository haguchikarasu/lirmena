/*
 * pan.ts
 * 責務: マウスの「手のひら（パン）ツール」。本文ページの横スクロールコンテナ（#main-container）を
 *       マウス左ドラッグで横スクロールする。デフォルトが手のひら（ドラッグ＝スクロール）で、Shift を
 *       押している間だけ選択ツール（テキスト選択）へ譲る。マウス限定（タッチ／ペンは既存のネイティブ
 *       横スクロールのまま）。微調整＝ホイール（main.ts）／大量移動＝ドラッグ、の棲み分けを担う。
 * export: init(): void ／ computePanScrollLeft(...): number ／ shouldPanFromInput(...): boolean
 *         ／ smoothVelocity(...): number ／ decayVelocity(...): number ／ shouldStartMomentum(...): boolean
 *         （init 以外はすべて DOM 非依存の純関数＝テスト用）。
 * 依存: なし（#main-container の DOM と <html>.is-selecting クラスのみを操作する。他モジュール非依存）。
 *
 * 結線: main.ts がホイールリスナー登録の直後に init() を1度だけ呼ぶ。
 *   パンは container.scrollLeft を直接書き換えるだけで、スクロール由来の波及（背景クロスフェード・進捗・
 *   オートセーブ・開幕判定・読了検知）は既存の scroll イベント → bg.ts → reader.ts／nav.ts の購読が
 *   自動追従する（このモジュールからの新規配線は不要）。慣性スクロール（下記）も scrollLeft を動かすだけなので同様に追従する。
 *
 * 慣性（momentum・大量移動のフリック送り）:
 *   pointermove ごとに離脱速度（scrollLeft px/ms・符号は scrollLeft 方向）を指数平滑で追跡し、pointerup で
 *   その速度が閾値（MIN_FLICK_VELOCITY）以上なら摩擦減衰の rAF スクロールを走らせる（フィーリングは「標準」＝
 *   OS のスクロールに近い自然な減速）。閾値未満の微調整ドラッグは慣性を出さずその場で正確に止まる。
 *   prefers-reduced-motion 時は慣性を無効化（即停止）。慣性走行中に新たな pointerdown が来たら停止（＝タップで停止）。
 *   端は負モデル [minLeft, 0]（minLeft = -(scrollWidth - clientWidth)）でクランプし、端に達したら停止（バウンスなし）。
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

// 慣性（momentum）のフィーリング定数（「標準」＝自然な減速）。すべて後から微調整できる。
export const FRAME_REF_MS = 1000 / 60; // 減衰の基準フレーム時間（≈16.67ms）。decayVelocity の指数の基準（テスト用に公開）。
const VELOCITY_SMOOTHING = 0.6;        // 離脱速度の指数平滑で「新しい瞬間速度」に置く重み（0〜1。小さいほど離す直前のフリックに鈍くなる）。
const FRICTION = 0.88;                  // 基準1フレームあたりの速度減衰率（小さいほど早く止まる＝滑走が短い）。
const MIN_FLICK_VELOCITY = 0.3;        // 慣性を開始する離脱速度の下限（px/ms。大きいほど発火しにくい）。未満は微調整とみなし即停止。
const MIN_MOMENTUM_VELOCITY = 0.02;    // 慣性ループを終了する速度の下限（px/ms）。

// パン中フラグ・ドラッグ起点（clientX）・起点スクロール量・捕捉中の pointerId。
let _panning = false;
let _startX = 0;
let _startScrollLeft = 0;
let _pointerId = -1;

// 慣性用：直近 pointermove の clientX／タイムスタンプ（速度算出）・平滑化した離脱速度・慣性 rAF ハンドル（0=停止）。
let _lastX = 0;
let _lastT = 0;
let _velocity = 0;
let _momentumRAF = 0;

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
    // 慣性走行中の押下は常に慣性を止める（新規パン開始でなくても「タップで停止」させる）。
    _cancelMomentum();
    // 背景鑑賞モード中はパンしない（CSS の pointer-events:none で通常届かないが明示的に弾く）。
    if (document.documentElement.classList.contains('is-immersive')) return;
    if (!shouldPanFromInput(e)) return;
    // インタラクティブ要素（端ボタン・FAB・開幕アフォーダンス・読書点ノブ）の上ではパンしない。
    if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) return;

    _panning = true;
    _startX = e.clientX;
    _startScrollLeft = container.scrollLeft;
    _pointerId = e.pointerId;
    // 離脱速度トラッキングの初期化（起点を現在位置・現在時刻に置く）。
    _velocity = 0;
    _lastX = e.clientX;
    _lastT = performance.now();

    // ドラッグがコンテナ外（背景レイヤー上など）へ出ても追従できるよう捕捉する。
    container.setPointerCapture(e.pointerId);
    container.classList.add('is-panning'); // カーソルを grabbing に（CSS）
    e.preventDefault();                    // 画像ドラッグ等の既定動作を抑止

    container.addEventListener('pointermove', _onPointerMove);
    container.addEventListener('pointerup', _onPointerUp);
    container.addEventListener('pointercancel', _onPointerUp);
}

// パン中の移動。content-follows-cursor で scrollLeft を直接更新する（端はブラウザが自動クランプ）。
// あわせて離脱速度（pointerup 後の慣性に使う）を指数平滑で追跡する。
// _onPointerMove(e: PointerEvent): void
function _onPointerMove(e: PointerEvent): void {
    if (!_panning) return;
    const container = e.currentTarget as HTMLElement;
    container.scrollLeft = computePanScrollLeft(_startScrollLeft, _startX, e.clientX);

    // 瞬間速度（scrollLeft の変化は content-follows-cursor で -(dx)）を平滑化して _velocity に積む。
    const now = performance.now();
    const dt = now - _lastT;
    if (dt > 0) {
        const instantaneous = -(e.clientX - _lastX) / dt;
        _velocity = smoothVelocity(_velocity, instantaneous, VELOCITY_SMOOTHING);
        _lastX = e.clientX;
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

// 離脱速度から摩擦で自然減速する慣性スクロールを rAF で回す。位置は float（pos）で持ち、負モデル
// [minLeft, 0] で自前クランプする（端に達したら停止＝バウンスなし）。速度が下限を切ったら停止する。
// _startMomentum(container: HTMLElement): void
function _startMomentum(container: HTMLElement): void {
    let pos = container.scrollLeft;
    const minLeft = -(container.scrollWidth - container.clientWidth); // 負モデルの終端側
    let last = performance.now();

    const step = (now: number): void => {
        const dt = now - last;
        last = now;
        _velocity = decayVelocity(_velocity, dt, FRICTION);
        if (Math.abs(_velocity) < MIN_MOMENTUM_VELOCITY) { _momentumRAF = 0; return; }

        pos += _velocity * dt;
        const clamped = Math.max(minLeft, Math.min(0, pos));
        container.scrollLeft = clamped;
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
