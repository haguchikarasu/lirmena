/*
 * reader.ts
 * 責務: bg.ts のスクロール通知を受け、progress / bookmark（オートセーブ）へ fan-out する集約点。
 *       bg.ts を疎結合に保つため、スクロール由来の1イベントをここで各モジュールへ振り分ける。
 * export: init(address: SecAddress): void
 *         handleScroll(n: ScrollNotification): void
 *         handleScrollEnd(): void … スクロールが止まった通知。止まった位置を 1 回書く（下の ⑤）
 *         getLastRatio(): number … 直近のスクロール範囲比（0〜1）。書字方向のライブ切替時に main.ts が切替前の読書位置として読む
 *         SCROLL_END_QUIET_MS: number … 止まったとみなすまでの静かな時間（ms。テストが読む）
 * 依存: progress.ts / opening.ts / bookmark.ts / state.ts（DOM には触らない。scrollend の購読は main.ts が持つ）
 *
 * 結線: main.ts が reader.init({ ep, sec }) のあと bg.subscribe(reader.handleScroll) で結び、
 *       #main-container の scrollend（未対応のブラウザでは scroll）を reader.handleScrollEnd へ結ぶ。
 *
 * fan-out（handleScroll）:
 *   ① progress.update(progress) — bg.ts が本文領域基準で算出した連続進捗（0〜1）をそのまま渡す
 *   ② opening.update(forward) — 進行軸の先頭（forward≈0）でのみ開幕アフォーダンスを表示（n.scrollLeft は forward 進行 px）
 *   ③ オートセーブ上書き（スクロール範囲比 0〜1・過剰書込を避けスロットル 500ms）：
 *        本文モード → bookmark.saveAutoSave(ep, sec, ratio)（キー autosave。書いてよいページかは main.ts が判定して抑止する）
 *        あとがきモード → 書かない（あとがきは位置を保存しない。要件 06-5）
 *      加えて bookmark.saveScrollToHistory(ratio) — 現在の履歴エントリへスクロール範囲比を刻む
 *      （戻る/進むで HTML 再読込された場合の per-entry スクロール復元用・同じスロットルに相乗り。割合なので書字方向に依存しない）
 *      移動中の間引きは外さない：離脱時に位置を書く処理が無いので、移動中にリロード・遷移したときの位置はこれが持つ
 *   ④ state.setCurrentScene(n.currentScene) — 現在シーンを反映し、栞保存の coarse アドレスに使う
 *
 * 止まったときの書き込み（handleScrollEnd）:
 *   ⑤ 止まった通知のあと SCROLL_END_QUIET_MS のあいだ次の止まった通知が来なければ、直近の位置（getLastRatio）を
 *      ③ と同じ条件・同じ書き先へ 1 回書く。前回書いた値と同じなら書かない。書いたら ③ の間引きの時刻も進める
 *      （＝書き込みは 500ms に 1 回＋止まったときの 1 回まで）。
 *      静かな時間を待つ理由：rAF ごとに位置を書き換える移動（pan.ts のドラッグと慣性・opening.ts の _animateScrollTo）は、
 *      書き換えのたびに scrollend が出る（Chromium・Firefox・WebKit とも毎フレーム）。待たずに書くと移動中に毎フレーム書く。
 *      scrollend 未対応のブラウザでは main.ts が scroll ごとにこれを呼ぶので、同じ待ちが「scroll が来なくなった」の判定になる。
 *      init は待っている書き込みを捨てる。
 */

import * as progress from './progress';
import * as opening from './opening';
import * as bookmark from './bookmark';
import * as state from './state';
import type { SecAddress, ScrollNotification } from './types';

// オートセーブのスロットル間隔（ms）。過剰な localStorage 書き込みを避ける。
const AUTOSAVE_THROTTLE_MS = 500;
// 止まった通知のあと、止まったとみなすまでの静かな時間（ms）。1 フレーム（低速な端末で 33ms 程度）より十分長くとる。
// characters.ts の _wireWheel の代替（scroll が 150ms 来ない）と同じ値。
export const SCROLL_END_QUIET_MS = 150;

let _address: SecAddress = { ep: 1, sec: 1 };
let _lastAutoSaveAt = 0;
// 直近のスクロール範囲比（0〜1）。スロットルに依らず毎通知で更新し、書字方向のライブ切替時に切替前位置として使う。
let _lastRatio = 0;
// 直近に書いた範囲比（止まったときに同じ値を書き直さないため）。init で null に戻す
let _lastWrittenRatio: number | null = null;
let _endTimer: ReturnType<typeof setTimeout> | null = null;

// 自ページの ep/sec を保持する。main.ts が bg.subscribe の前に一度だけ呼ぶ。
// init(address: SecAddress): void
export function init(address: SecAddress): void {
    _address = { ...address };
    _lastAutoSaveAt = 0;
    _lastRatio = 0;
    _lastWrittenRatio = null;
    if (_endTimer !== null) clearTimeout(_endTimer);
    _endTimer = null;
}

// 直近のスクロール範囲比（0〜1）を返す。main.ts が書字方向のライブ切替で「切替前の読書位置」を新方向へ復元するために読む。
// getLastRatio(): number
export function getLastRatio(): number {
    return _lastRatio;
}

// 位置を書く（③⑤ 共通）。あとがきモードでは autosave を書かず、履歴だけ刻む。
// _write(ratio: number): void
function _write(ratio: number): void {
    _lastAutoSaveAt = Date.now();
    _lastWrittenRatio = ratio;
    if (state.getMode() !== 'afterword') bookmark.saveAutoSave(_address.ep, _address.sec, ratio);
    bookmark.saveScrollToHistory(ratio);
}

// bg.ts のスクロール通知を受け、progress 更新とオートセーブへ振り分ける。
// handleScroll(n: ScrollNotification): void
export function handleScroll(n: ScrollNotification): void {
    progress.update(n.progress);
    opening.update(n.scrollLeft);
    state.setCurrentScene(n.currentScene);
    _lastRatio = n.ratio;

    if (Date.now() - _lastAutoSaveAt >= AUTOSAVE_THROTTLE_MS) _write(n.ratio);
}

// スクロールが止まった通知（scrollend。未対応のブラウザでは scroll ごと）。SCROLL_END_QUIET_MS 次の通知が来なければ、
// 直近の位置を 1 回書く（前回書いた値と同じなら書かない）。
// handleScrollEnd(): void
export function handleScrollEnd(): void {
    if (_endTimer !== null) clearTimeout(_endTimer);
    _endTimer = setTimeout(() => {
        _endTimer = null;
        if (_lastRatio !== _lastWrittenRatio) _write(_lastRatio);
    }, SCROLL_END_QUIET_MS);
}
