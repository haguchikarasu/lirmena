/*
 * transition.ts
 * 【責務】進む／戻るトリガーを受けて、暗転→コンテンツ差し替え→背景切替→ナビ更新→
 *         進捗更新→フェードインを順次実行。多重起動防止。
 * 【依存】state / renderer / bg / progress / bookmark
 * 【被依存】main / nav / menu
 * 【注意】nav との循環依存は main.ts がコールバック（updateNav）注入で解消する
 * 【注意】フェード時間は CSS 変数 --fade-duration で管理する
 * 【注意】contents.html に id="transition-overlay" の要素が必要
 */

import type { Scene, SceneAddress } from './types';
import * as state from './state';
import { LAST_SCENE } from './state';
import * as renderer from './renderer';
import * as bg from './bg';
import * as progress from './progress';
import * as bookmark from './bookmark';

// loadSec: ロード・パース・state.setScenesCount() まで行い Scene[] を返す
type LoadSec = (ep: number, sec: number) => Promise<Scene[]>;

let _loadSec: LoadSec = () => Promise.resolve([]);
let _updateNav: () => void = () => {};
let _scenes: Scene[] = [];
let _busy = false;
let _overlay!: HTMLElement;

/**
 * main.ts が初期ロード完了後に一度だけ呼ぶ。
 * @param scenes    初期表示 sec のパース済み Scene 配列
 * @param loadSec   別 sec へ遷移するとき呼ぶコールバック（ロード・パース・setScenesCount まで担う）
 * @param updateNav 遷移完了後にナビボタン状態を更新するコールバック（nav.update のラッパー）
 */
export function init(scenes: Scene[], loadSec: LoadSec, updateNav: () => void): void {
    _scenes = scenes;
    _loadSec = loadSec;
    _updateNav = updateNav;
    _overlay = document.querySelector('#transition-overlay')!;
}

/**
 * nav / menu から呼ばれる。指定アドレスへシーン遷移を実行する。
 * scene === LAST_SCENE の場合は対象 sec をロードしてシーン総数に解決してから遷移する。
 * 遷移中の場合は即リターン（多重起動防止）。
 */
export async function trigger(address: SceneAddress): Promise<void> {
    if (_busy) return;
    _busy = true;
    try {
        await _run(address);
    } finally {
        _busy = false;
    }
}

async function _run(address: SceneAddress): Promise<void> {
    const current = state.getCurrent();
    let target = { ...address };
    const needsLoad = target.ep !== current.ep || target.sec !== current.sec || target.scene === LAST_SCENE;

    await _fadeOut();

    if (needsLoad) {
        _scenes = await _loadSec(target.ep, target.sec);
    }

    // LAST_SCENE 番兵をロード済みシーン総数に解決する
    if (target.scene === LAST_SCENE) {
        target = { ...target, scene: _scenes.length };
    }

    if (target.scene === 0) {
        renderer.renderTitleCard(state.getEpisode(target.ep)!, state.getSection(target.ep, target.sec)!);
    } else {
        renderer.renderScene(_scenes[target.scene - 1]);
    }

    bg.set(target.scene === 0 ? null : (_scenes[target.scene - 1]?.bgFile ?? null));

    history.replaceState(null, '', state.toHash(target));
    state.setCurrent(target);

    _updateNav();
    if (needsLoad) progress.initProgress(_scenes);
    progress.updateProgress(target.scene);

    // scene >= 1 のときのみ既読記録（タイトルカード表示では記録しない）
    if (target.scene >= 1) {
        bookmark.markRead(target);
    }

    await _fadeIn();
}

// オーバーレイに 'fading' クラスを付与→CSS transition で暗転。transitionend で解決。
function _fadeOut(): Promise<void> {
    return new Promise(resolve => {
        _overlay.classList.add('fading');
        _overlay.addEventListener('transitionend', () => resolve(), { once: true });
    });
}

function _fadeIn(): Promise<void> {
    return new Promise(resolve => {
        _overlay.classList.remove('fading');
        _overlay.addEventListener('transitionend', () => resolve(), { once: true });
    });
}
