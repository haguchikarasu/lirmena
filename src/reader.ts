/*
 * reader.ts
 * 責務: bg.ts のスクロール通知を受け、progress / bookmark（オートセーブ）へ fan-out する集約点。
 *       bg.ts を疎結合に保つため、スクロール由来の1イベントをここで各モジュールへ振り分ける。
 * export: init(address: SecAddress): void
 *         handleScroll(n: ScrollNotification): void
 *         getLastRatio(): number … 直近のスクロール範囲比（0〜1）。書字方向のライブ切替時に main.ts が切替前の読書位置として読む
 * 依存: progress.ts / opening.ts / bookmark.ts / state.ts
 *
 * 結線: main.ts が reader.init({ ep, sec }) のあと bg.subscribe(reader.handleScroll) で結ぶ。
 *
 * fan-out（handleScroll）:
 *   ① progress.update(progress) — bg.ts が本文領域基準で算出した連続進捗（0〜1）をそのまま渡す
 *   ② opening.update(forward) — 進行軸の先頭（forward≈0）でのみ開幕アフォーダンスを表示（n.scrollLeft は forward 進行 px）
 *   ③ bookmark.saveAutoSave(ep, sec, ratio) — オートセーブ上書き（スクロール範囲比 0〜1・過剰書込を避けスロットル）
 *      加えて bookmark.saveScrollToHistory(ratio) — 現在の履歴エントリへスクロール範囲比を刻む
 *      （戻る/進むで HTML 再読込された場合の per-entry スクロール復元用・同じスロットルに相乗り。割合なので書字方向に依存しない）
 *   ④ state.setCurrentScene(n.currentScene) — 現在シーンを反映し、栞保存の coarse アドレスに使う
 */

import * as progress from './progress';
import * as opening from './opening';
import * as bookmark from './bookmark';
import * as state from './state';
import type { SecAddress, ScrollNotification } from './types';

// オートセーブのスロットル間隔（ms）。過剰な localStorage 書き込みを避ける。
const AUTOSAVE_THROTTLE_MS = 500;

let _address: SecAddress = { ep: 1, sec: 1 };
let _lastAutoSaveAt = 0;
// 直近のスクロール範囲比（0〜1）。スロットルに依らず毎通知で更新し、書字方向のライブ切替時に切替前位置として使う。
let _lastRatio = 0;

// 自ページの ep/sec を保持する。main.ts が bg.subscribe の前に一度だけ呼ぶ。
// init(address: SecAddress): void
export function init(address: SecAddress): void {
    _address = { ...address };
    _lastAutoSaveAt = 0;
    _lastRatio = 0;
}

// 直近のスクロール範囲比（0〜1）を返す。main.ts が書字方向のライブ切替で「切替前の読書位置」を新方向へ復元するために読む。
// getLastRatio(): number
export function getLastRatio(): number {
    return _lastRatio;
}

// bg.ts のスクロール通知を受け、progress 更新とオートセーブへ振り分ける。
// handleScroll(n: ScrollNotification): void
export function handleScroll(n: ScrollNotification): void {
    progress.update(n.progress);
    opening.update(n.scrollLeft);
    state.setCurrentScene(n.currentScene);
    _lastRatio = n.ratio;

    const now = Date.now();
    if (now - _lastAutoSaveAt >= AUTOSAVE_THROTTLE_MS) {
        _lastAutoSaveAt = now;
        bookmark.saveAutoSave(_address.ep, _address.sec, n.ratio);
        bookmark.saveScrollToHistory(n.ratio);
    }
}
