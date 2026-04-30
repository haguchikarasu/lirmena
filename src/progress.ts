/*
 * progress.ts
 * 責務: 進捗バーの計算・表示・スクロール監視
 * export: initProgress(allEpScenes: Scene[]): void
 *         updateProgress(currentSceneInEp: number): void
 *         hideProgress(): void
 * 依存: なし（state への依存を除去）
 *
 * 計算式（ep 内全シーンを対象とする）:
 *   シーン進捗率   = ep 内で読破したシーンの合算行数 ÷ ep 内の全シーンの合算行数
 *   シーン内進捗率 = |scrollLeft| ÷ (scrollWidth - clientWidth)
 *                   水平スクロールなければ scrollTop ÷ (scrollHeight - clientHeight) でフォールバック
 *   進捗率         = シーン進捗率 + シーン内進捗率 × (第nシーンの行数 ÷ ep 内の全シーンの合算行数)
 *
 * scene 0（タイトル画面）では hideProgress() と同等の動作をする。
 * 行数は Scene.lineCount（テキストファイル上の改行数）を使用する。
 * スクロール監視は #main-container を対象とする。
 *
 * initProgress の引数:
 *   allEpScenes — ep 内の全 sec の Scene[] を結合した配列。ep をまたぐ遷移時も再度渡す。
 *
 * updateProgress の引数:
 *   currentSceneInEp — ep 全体でのシーン通し番号（1始まり）。0 のとき hideProgress と同等。
 *   呼び出し元（transition.ts / main.ts）が ep 内オフセットを加算して渡すこと。
 */

import type { Scene } from './types';

let _scenes: Scene[] = [];
let _totalLines = 0;
let _currentSceneInEp = 0;
const _container = document.querySelector<HTMLElement>('#main-container')!;

// ep ロード完了後（全 sec パース後）に main.ts から呼ぶ。複数回呼ばれても二重登録しない。
// allEpScenes: ep 内の全 sec の Scene[] を結合した配列
// initProgress(allEpScenes: Scene[]): void
export function initProgress(allEpScenes: Scene[]): void {
    _scenes = allEpScenes;
    _totalLines = allEpScenes.reduce((sum, s) => sum + s.lineCount, 0);
    _container.removeEventListener('scroll', _onScroll);
    _container.addEventListener('scroll', _onScroll, { passive: true });
}

// currentSceneInEp: ep 全体での通し番号（1始まり）。0 のとき hideProgress() と同等。
// transition.ts がシーン切替後に呼ぶ。
// updateProgress(currentSceneInEp: number): void
export function updateProgress(currentSceneInEp: number): void {
    _currentSceneInEp = currentSceneInEp;
    if (currentSceneInEp === 0) {
        hideProgress();
        return;
    }
    _render(currentSceneInEp);
}

// hideProgress(): void
export function hideProgress(): void {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.hidden = true;
}

function _onScroll(): void {
    if (_currentSceneInEp === 0) return;
    _render(_currentSceneInEp);
}

function _render(currentSceneInEp: number): void {
    const bar = document.getElementById('progress-bar');
    const fill = document.getElementById('progress-fill');
    if (!bar || !fill) return;

    bar.hidden = false;
    fill.style.width = `${(_calcRatio(currentSceneInEp) * 100).toFixed(2)}%`;
}

function _calcRatio(currentSceneInEp: number): number {
    if (_totalLines === 0) return 0;

    // _scenes 配列は 0-indexed、currentSceneInEp は 1-indexed
    const idx = currentSceneInEp - 1;
    const completedLines = _scenes.slice(0, idx).reduce((sum, s) => sum + s.lineCount, 0);
    const currentLines = idx < _scenes.length ? _scenes[idx].lineCount : 0;

    const sceneRatio = completedLines / _totalLines;
    const inSceneRatio = _scrollRatio();

    return Math.min(1, sceneRatio + inSceneRatio * (currentLines / _totalLines));
}

// 縦書き水平スクロール想定。scrollLeft が負のブラウザ（Firefox RTL）は Math.abs で吸収。
// 水平スクロール範囲がなければ縦方向にフォールバック。
function _scrollRatio(): number {
    const hRange = _container.scrollWidth - _container.clientWidth;
    if (hRange > 1) {
        return Math.min(1, Math.max(0, Math.abs(_container.scrollLeft) / hRange));
    }
    const vRange = _container.scrollHeight - _container.clientHeight;
    if (vRange > 1) {
        return Math.min(1, Math.max(0, _container.scrollTop / vRange));
    }
    return 0;
}
