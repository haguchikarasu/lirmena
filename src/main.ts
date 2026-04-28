/*
 * main.ts
 * 【責務】DOMContentLoaded 後の起動・URLハッシュによるルーティング・
 *         各モジュール初期化・モジュール間の参照注入
 * 【IF】export なし（エントリーポイント）
 * 【依存】
 *   loader   : loadEpisodes(): Promise<EpisodesData>
 *              loadText(ep: number, sec: number): Promise<string>
 *   parser   : parse(text: string): Scene[]
 *   state    : init(data: EpisodesData, address: SceneAddress): void
 *              setScenesCount(count: number): void
 *              parseHash(hash: string): SceneAddress | null
 *              isPublished(ep: number, sec: number): boolean
 *              getEpTitle(ep: number): string | undefined
 *   transition: init(scenes: Scene[], loadSec: (ep: number, sec: number) => Promise<Scene[]>, updateNav: () => void): void
 *              / trigger(address: SceneAddress): Promise<void>
 *   renderer : renderTitleCard(ep: Episode, sec: EpisodeSection): void
 *              renderScene(scene: Scene): void
 *   bg       : set(bgFile: string | null): void
 *   progress : initProgress(scenes: Scene[]): void
 *              updateProgress(currentScene: number): void
 *              currentScene === 0 のとき 0% 表示
 *   nav      : init(): void / update(): void
 *   menu     : init(): void
 *   settings : init(callbacks: { onClearBookmarks: () => void; onClearRead: () => void }): void
 *   bookmark : init(): void / clearSlots(): void / clearRead(): void
 * 【被依存】なし
 * 【注意】() => nav.update() をコールバック化して transition.init に渡すことで
 *         nav ↔ transition の循環依存を解消する
 * 【注意】bookmark.clearSlots / clearRead を settings.init に注入する
 *         （settings は bookmark を import しない）
 */

import * as state from './state';
import * as transition from './transition';
import * as renderer from './renderer';
import * as bg from './bg';
import * as progress from './progress';
import * as nav from './nav';
import * as menu from './menu';
import * as settings from './settings';
import * as bookmark from './bookmark';
import * as loader from './loader';
import * as parser from './parser';
import type { Scene, EpisodesData, SceneAddress } from './types';

document.addEventListener('DOMContentLoaded', () => { void _init(); });

/**
 * エントリーポイント。各モジュールを順次初期化する。
 * エラー発生時は _showError() を呼んで処理を中断する。
 *
 * 初期化順序:
 *   1. loader.loadEpisodes() で episodes.json を取得
 *   2. _resolveAddress(data) でハッシュを解析・検証
 *   3. state.init(data, address) で現在位置を確定
 *   4. _loadSec(ep, sec) で初期 sec の Scene[] を取得
 *   5. settings.init() でフォント設定を復元（bookmark クリア系コールバックを注入）
 *   6. bookmark.init() で栞・既読を localStorage から復元
 *   7. nav.init() でボタンイベントを登録
 *   8. transition.init(scenes, _loadSec, () => nav.update()) で遷移エンジンを初期化
 *   9. menu.init() で右下メニューを初期化
 *  10. 初期レンダリング（タイトルカード or シーン）
 *  11. bg.set() で初期背景を設定
 *  12. nav.update() でボタン表示を確定
 *  13. progress.update(scenes, scene) で進捗バーを初期化
 */
async function _init(): Promise<void> {
    let data: EpisodesData;
    try {
        data = await loader.loadEpisodes();
    } catch {
        _showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    const address = _resolveAddress(data);
    if (!address) {
        _showError('ページが見つかりません。URLをご確認ください。');
        return;
    }

    state.init(data, address);

    let scenes: Scene[];
    try {
        scenes = await _loadSec(address.ep, address.sec);
    } catch {
        _showError('本文の読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    settings.init({
        onClearBookmarks: () => bookmark.clearSlots(),
        onClearRead: () => bookmark.clearRead(),
    });
    bookmark.init();
    nav.init();
    transition.init(scenes, _loadSec, () => nav.update());
    menu.init();

    if (address.scene === 0) {
        renderer.renderTitleCard(state.getEpisode(address.ep)!, state.getSection(address.ep, address.sec)!);
    } else {
        renderer.renderScene(scenes[address.scene - 1]);
    }
    bg.set(address.scene === 0 ? null : (scenes[address.scene - 1]?.bgFile ?? null));
    nav.update();
    progress.initProgress(scenes);
    progress.updateProgress(address.scene);
}

/**
 * URLハッシュを検証し、遷移先アドレスを返す。
 * - ハッシュなし → 最初の公開済み sec の scene 0（エラーにしない）
 * - ハッシュあり・形式不正 → null
 * - ハッシュあり・存在しない ep または未公開 sec → null
 *
 * 依存: state.parseHash / state.isPublished / _findFirstPublished
 */
function _resolveAddress(data: EpisodesData): SceneAddress | null {
    const hash = window.location.hash;
    if (!hash || hash === '#') {
        return _findFirstPublished(data);
    }

    const address = state.parseHash(hash);
    if (!address) return null;

    if (!state.isPublished(address.ep, address.sec)) return null;

    return address;
}

/**
 * 指定 sec の本文をロード・パースして Scene[] を返す。
 * transition.init に LoadSec コールバックとして渡す。
 * state.setScenesCount() もここで呼ぶ。
 *
 * 依存: loader.loadText / parser.parse / state.setScenesCount
 * @throws fetch 失敗時はそのまま throw する
 */
async function _loadSec(ep: number, sec: number): Promise<Scene[]> {
    const text = await loader.loadText(ep, sec);
    const scenes = parser.parse(text);
    state.setScenesCount(scenes.length);
    return scenes;
}

/**
 * エラーメッセージを #error-message に表示し、#main-container を非表示にする。
 * エラーは回復不能とみなし、以降の処理は行わない。
 *
 * 依存: DOM (#error-message, #main-container)
 */
function _showError(message: string): void {
    const errorEl = document.querySelector<HTMLElement>('#error-message');
    const containerEl = document.querySelector<HTMLElement>('#main-container');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }
    if (containerEl) {
        containerEl.hidden = true;
    }
}

/**
 * data の中から最初の公開済み sec アドレス（scene 0）を返す。
 * ハッシュなし時のフォールバック先として使用する。
 * 公開済み sec がひとつもなければ null を返す。
 */
function _findFirstPublished(data: EpisodesData): SceneAddress | null {
    for (const episode of data) {
        for (const section of episode.sections) {
            if (section.published) {
                return { ep: episode.id, sec: section.id, scene: 0 };
            }
        }
    }
    return null;
}
