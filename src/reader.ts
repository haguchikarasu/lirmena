/*
 * reader.ts
 * 責務: bg.ts のスクロール通知を受け、progress / bookmark（オートセーブ）へ fan-out する集約点。
 *       bg.ts を疎結合に保つため、スクロール由来の1イベントをここで各モジュールへ振り分ける。
 * export: init(address: SecAddress): void
 *         handleScroll(n: ScrollNotification): void
 * 依存: progress.ts / opening.ts / bookmark.ts / state.ts
 *
 * 結線: main.ts が reader.init({ ep, sec }) のあと bg.subscribe(reader.handleScroll) で結ぶ。
 *
 * fan-out（handleScroll）:
 *   ① progress.update(progress) — bg.ts が本文領域基準で算出した連続進捗（0〜1）をそのまま渡す
 *   ② opening.update(scrollLeft) — スクロール右端（scrollLeft≈0）でのみ開幕アフォーダンスを表示
 *   ③ bookmark.saveAutoSave(ep, sec, scrollLeft) — オートセーブ上書き（過剰書込を避けスロットル）
 *      加えて bookmark.saveScrollToHistory(scrollLeft) — 現在の履歴エントリへ scrollLeft を刻む
 *      （戻る/進むで HTML 再読込された場合の per-entry スクロール復元用・同じスロットルに相乗り）
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

// 自ページの ep/sec を保持する。main.ts が bg.subscribe の前に一度だけ呼ぶ。
// init(address: SecAddress): void
export function init(address: SecAddress): void {
    _address = { ...address };
    _lastAutoSaveAt = 0;
}

// bg.ts のスクロール通知を受け、progress 更新とオートセーブへ振り分ける。
// handleScroll(n: ScrollNotification): void
export function handleScroll(n: ScrollNotification): void {
    progress.update(n.progress);
    opening.update(n.scrollLeft);
    state.setCurrentScene(n.currentScene);

    const now = Date.now();
    if (now - _lastAutoSaveAt >= AUTOSAVE_THROTTLE_MS) {
        _lastAutoSaveAt = now;
        bookmark.saveAutoSave(_address.ep, _address.sec, n.scrollLeft);
        bookmark.saveScrollToHistory(n.scrollLeft);
    }
}
