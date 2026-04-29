/*
 * progress.ts
 * 責務: 進捗バーの計算・表示・スクロール監視
 * export: initProgress(scenes: Scene[]): void
 *         updateProgress(currentScene: number): void
 *         hideProgress(): void
 * 依存: state.ts
 *
 * 計算式:
 *   シーン進捗率   = 読破済みシーンの合算行数 ÷ 全シーンの合算行数
 *   シーン内進捗率 = |scrollLeft| ÷ (scrollWidth - clientWidth)
 *                   水平スクロールなければ scrollTop ÷ (scrollHeight - clientHeight) でフォールバック
 *   進捗率         = シーン進捗率 + シーン内進捗率 × (現シーン行数 ÷ 全シーン合算行数)
 *
 * scene 0（タイトルカード）では hideProgress() と同等の動作をする。
 * 行数は Scene.lineCount（テキストファイル上の改行数）を使用する。
 * スクロール監視は #main-container を対象とする（スクロールコンテナが #main-container に一本化されたため）。
 */

import * as state from './state';
import type { Scene } from './types';

let _scenes: Scene[] = [];
let _totalLines = 0;
const _container = document.querySelector<HTMLElement>('#main-container')!;

// sec ロード完了後（パース後）に main.ts から呼ぶ。複数回呼ばれても二重登録しない。
export function initProgress(scenes: Scene[]): void {
    _scenes = scenes;
    _totalLines = scenes.reduce((sum, s) => sum + s.lineCount, 0);
    _container.removeEventListener('scroll', _onScroll);
    _container.addEventListener('scroll', _onScroll, { passive: true });
}

// currentScene: 1始まり。0 のとき hideProgress() と同等。transition.ts がシーン切替後に呼ぶ。
export function updateProgress(currentScene: number): void {
    if (currentScene === 0) {
        hideProgress();
        return;
    }
    _render(currentScene);
}

export function hideProgress(): void {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.hidden = true;
}

function _onScroll(): void {
    const { scene } = state.getCurrent();
    if (scene === 0) return;
    _render(scene);
}

function _render(currentScene: number): void {
    const bar = document.getElementById('progress-bar');
    const fill = document.getElementById('progress-fill');
    if (!bar || !fill) return;

    bar.hidden = false;
    fill.style.width = `${(_calcRatio(currentScene) * 100).toFixed(2)}%`;
}

function _calcRatio(currentScene: number): number {
    if (_totalLines === 0) return 0;

    // scenes 配列は 0-indexed、currentScene は 1-indexed
    const idx = currentScene - 1;
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
