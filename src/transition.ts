/*
 * transition.ts
 * 【責務】進む／戻るトリガーを受けて、暗転→コンテンツ差し替え→背景切替→ナビ更新→
 *         進捗更新→既読記録→フェードインを順次実行。多重起動防止。
 * 【依存】state / renderer / bg / progress / bookmark
 * 【被依存】main / nav / menu
 * 【注意】nav との循環依存は main.ts がコールバック（updateNav）注入で解消する
 * 【注意】フェード変数はシーン境界とセクション境界で使い分ける:
 *         シーン境界   : --fade-scene-out-duration / --fade-scene-in-duration / --fade-scene-color
 *         セクション境界: --fade-section-out-duration / --fade-section-in-duration / --fade-section-color
 *         両者は共通の --fade-out-duration / --fade-in-duration / --fade-color にマップして使う
 * 【注意】contents.html に id="transition-overlay" の要素が必要
 * 【注意】スクロール位置は _scrollPositions（Map<string, number>）に保存する。
 *         キーは _sceneKey()（"ep-sec-scene" 形式）。
 *         戻る遷移のときのみ保存済み位置を renderer に渡す。進む遷移は境界位置（undefined）。
 * 【注意】progress.updateProgress には ep 内シーン通し番号（1始まり）を渡す。
 *         _currentEpSceneOffset で現在 sec の ep 内オフセットを保持し、sec 境界越えで更新する。
 *         init() の initialEpSceneOffset 引数で初期値を受け取る。
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
// getAllEpScenes: 指定 ep の全公開 sec をロードして結合した Scene[] と currentSec のオフセットを返す
type GetAllEpScenes = (ep: number, currentSec: number) => Promise<{ all: Scene[]; offset: number }>;

let _loadSec: LoadSec = () => Promise.resolve([]);
let _getAllEpScenes: GetAllEpScenes = async () => ({ all: [], offset: 0 });
let _updateNav: () => void = () => {};
let _scenes: Scene[] = [];
let _currentEpSceneOffset = 0;
let _busy = false;
let _overlay!: HTMLElement;
let _container!: HTMLElement;
const _scrollPositions = new Map<string, number>();

/**
 * main.ts が初期ロード完了後に一度だけ呼ぶ。
 * @param scenes                初期表示 sec のパース済み Scene 配列
 * @param initialEpSceneOffset  初期 sec の ep 内シーンオフセット（0始まり）
 * @param loadSec               別 sec へ遷移するとき呼ぶコールバック
 * @param getAllEpScenes         ep 全 sec の Scene[] と currentSec オフセットを返すコールバック
 * @param updateNav             遷移完了後にナビボタン状態を更新するコールバック
 */
export function init(
    scenes: Scene[],
    initialEpSceneOffset: number,
    loadSec: LoadSec,
    getAllEpScenes: GetAllEpScenes,
    updateNav: () => void,
): void {
    _scenes = scenes;
    _currentEpSceneOffset = initialEpSceneOffset;
    _loadSec = loadSec;
    _getAllEpScenes = getAllEpScenes;
    _updateNav = updateNav;
    _overlay = document.querySelector('#transition-overlay')!;
    _container = document.querySelector('#main-container')!;
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
    const needsSecLoad = target.ep !== current.ep || target.sec !== current.sec || target.scene === LAST_SCENE;
    const crossesSec = target.ep !== current.ep || target.sec !== current.sec;

    // 離脱時のスクロール位置を保存
    _scrollPositions.set(_sceneKey(current), _container.scrollLeft);

    // sec をまたぐかどうかに応じてフェード変数セットを選択する
    _setFadeVars(crossesSec);

    await _fadeOut();

    if (needsSecLoad) {
        _scenes = await _loadSec(target.ep, target.sec);
    }

    // LAST_SCENE 番兵をロード済みシーン総数に解決する
    if (target.scene === LAST_SCENE) {
        target = { ...target, scene: _scenes.length };
    }

    // LAST_SCENE 解決後に方向を判定し、戻る遷移かつ保存済みなら復元位置を渡す
    const isBackward = _isBefore(target, current);
    const savedScroll = isBackward ? _scrollPositions.get(_sceneKey(target)) : undefined;

    if (target.scene === 0) {
        renderer.renderTitleScreen(state.getEpTitle(target.ep) ?? '');
    } else {
        renderer.renderScene(_scenes[target.scene - 1], savedScroll);
    }

    bg.set(target.scene === 0 ? null : (_scenes[target.scene - 1]?.bgFile ?? null));

    history.replaceState(null, '', state.toHash(target));
    state.setCurrent(target);

    _updateNav();

    // sec またぎ時は全 sec をロードして progress を再初期化し、ep 内オフセットを更新する
    if (crossesSec) {
        const { all, offset } = await _getAllEpScenes(target.ep, target.sec);
        _currentEpSceneOffset = offset;
        progress.initProgress(all);
    }
    progress.updateProgress(target.scene === 0 ? 0 : _currentEpSceneOffset + target.scene);

    // forward 遷移かつ scene >= 1 のときのみ既読を記録する
    if (!isBackward && target.scene >= 1) {
        bookmark.recordSceneRead(target.ep, target.sec, target.scene);
    }

    await _fadeIn();
}

// sec をまたぐかどうかに応じて CSS 変数プレフィックスを切り替える。
// フェード変数の実値は style.css の --fade-scene-* / --fade-section-* で定義する。
// _setFadeVars(crossesSec: boolean): void
function _setFadeVars(crossesSec: boolean): void {
    const root = document.documentElement;
    if (crossesSec) {
        root.style.setProperty('--fade-out-duration', 'var(--fade-section-out-duration)');
        root.style.setProperty('--fade-in-duration', 'var(--fade-section-in-duration)');
        root.style.setProperty('--fade-color', 'var(--fade-section-color)');
    } else {
        root.style.setProperty('--fade-out-duration', 'var(--fade-scene-out-duration)');
        root.style.setProperty('--fade-in-duration', 'var(--fade-scene-in-duration)');
        root.style.setProperty('--fade-color', 'var(--fade-scene-color)');
    }
}

function _onTransitionEnd(el: HTMLElement): Promise<void> {
    return new Promise(resolve => el.addEventListener('transitionend', () => resolve(), { once: true }));
}

function _fadeOut(): Promise<void> {
    // #main-container が hidden（タイトル画面中）の場合は transitionend が発火しないためスキップ
    const containerVisible = !_container.hidden;
    const promises: Promise<void>[] = [_onTransitionEnd(_overlay)];
    if (containerVisible) promises.push(_onTransitionEnd(_container));
    _overlay.classList.add('fading');
    _container.classList.add('fading');
    return Promise.all(promises).then(() => {});
}

function _fadeIn(): Promise<void> {
    // renderTitleScreen / renderScene 後に hidden 状態を確認する
    const containerVisible = !_container.hidden;
    const promises: Promise<void>[] = [_onTransitionEnd(_overlay)];
    if (containerVisible) promises.push(_onTransitionEnd(_container));
    _overlay.classList.remove('fading');
    _container.classList.remove('fading');
    return Promise.all(promises).then(() => {});
}

// シーンの一意キー（スクロール位置の保存用）
// _sceneKey(a: SceneAddress): string
function _sceneKey(a: SceneAddress): string {
    return `${a.ep}-${a.sec}-${a.scene}`;
}

// target が current より読み順で前かどうか（戻る遷移の判定）
// _isBefore(target: SceneAddress, current: SceneAddress): boolean
function _isBefore(target: SceneAddress, current: SceneAddress): boolean {
    if (target.ep !== current.ep) return target.ep < current.ep;
    if (target.sec !== current.sec) return target.sec < current.sec;
    return target.scene < current.scene;
}
