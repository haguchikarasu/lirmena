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
 *              getEpisode(ep: number): Episode | undefined
 *   transition: init(
 *                 scenes: Scene[],
 *                 initialEpSceneOffset: number,
 *                 loadSec: (ep: number, sec: number) => Promise<Scene[]>,
 *                 getAllEpScenes: (ep: number, currentSec: number) => Promise<{ all: Scene[]; offset: number }>,
 *                 updateNav: () => void,
 *               ): void
 *              trigger(address: SceneAddress): Promise<void>
 *   renderer : renderTitleScreen(epTitle: string): void
 *              renderScene(scene: Scene): void
 *   bg       : set(bgFile: string | null, bgPositionX?: string): void
 *   progress : initProgress(allEpScenes: Scene[]): void
 *              updateProgress(currentSceneInEp: number): void
 *   nav      : init(): void / update(): void
 *   menu     : init(): void
 *   settings : init(callbacks: { onClearBookmarks: () => void; onClearRead: () => void }): void
 *   bookmark : init(): void / clearSlots(): void / clearRead(): void
 * 【被依存】なし
 * 【注意】() => nav.update() をコールバック化して transition.init に渡すことで
 *         nav ↔ transition の循環依存を解消する
 * 【注意】bookmark.clearSlots / clearRead を settings.init に注入する
 *         （settings は bookmark を import しない）
 * 【注意】wheel 補正（deltaY → scrollLeft 変換）は #main-container に1度だけ登録する
 *         writing-mode: vertical-rl では scrollLeft は右端が 0・左スクロールで負値になるため
 *         deltaY（正＝下スクロール）を反転して加算し縦スクロール入力を横スクロールに変換する
 * 【注意】_getAllEpScenes は ep ごとにキャッシュする。同 ep 内での sec またぎ遷移では
 *         ブラウザキャッシュに頼らずメモリキャッシュを使うため2重フェッチにならない
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

// ep → { allScenes: Scene[]; secOffsets: Map<secId, sceneOffset> }
// sceneOffset は ep 内でのシーン開始インデックス（0始まり）
const _epCache = new Map<number, { allScenes: Scene[]; secOffsets: Map<number, number> }>();

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
 *   5. _getAllEpScenes(ep, sec) で ep 内全 Scene[] とオフセットを取得
 *   6. settings.init() でフォント設定を復元（bookmark クリア系コールバックを注入）
 *   7. bookmark.init() で栞・既読を localStorage から復元
 *   8. nav.init() でボタンイベントを登録
 *   9. transition.init(scenes, offset, _loadSec, _getAllEpScenes, () => nav.update()) で遷移エンジンを初期化
 *  10. menu.init() で右下メニューを初期化
 *  11. 初期レンダリング（タイトル画面 or シーン）
 *  12. bg.set() で初期背景を設定
 *  13. nav.update() でボタン表示を確定
 *  14. progress.initProgress(all) / updateProgress で進捗バーを初期化
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

    let epAllScenes: Scene[];
    let epSceneOffset: number;
    try {
        const result = await _getAllEpScenes(address.ep, address.sec);
        epAllScenes = result.all;
        epSceneOffset = result.offset;
    } catch {
        _showError('本文の読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    const mainContainer = document.querySelector<HTMLElement>('#main-container')!;
    mainContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        mainContainer.scrollLeft -= e.deltaY;
    }, { passive: false });

    settings.init({
        onClearBookmarks: () => bookmark.clearSlots(),
        onClearRead: () => bookmark.clearRead(),
    });
    bookmark.init();
    nav.init();
    transition.init(scenes, epSceneOffset, _loadSec, _getAllEpScenes, () => nav.update());
    menu.init();

    if (address.scene === 0) {
        renderer.renderTitleScreen(state.getEpTitle(address.ep) ?? '');
    } else {
        renderer.renderScene(scenes[address.scene - 1]);
    }
    const initSc = address.scene === 0 ? undefined : scenes[address.scene - 1];
    bg.set(initSc?.bgFile ?? null, initSc?.bgPositionX);
    nav.update();
    progress.initProgress(epAllScenes);
    progress.updateProgress(address.scene === 0 ? 0 : epSceneOffset + address.scene);

    const loadingEl = document.querySelector<HTMLElement>('#loading');
    if (loadingEl) loadingEl.hidden = true;
}

/**
 * URLハッシュを検証し、遷移先アドレスを返す。
 * - ハッシュなし → 最初の公開済み sec の scene 0（エラーにしない）
 * - ハッシュあり・形式不正 → null
 * - ハッシュあり・存在しない ep または未公開 sec → null
 */
function _resolveAddress(data: EpisodesData): SceneAddress | null {
    const hash = window.location.hash;
    if (!hash || hash === '#') {
        return _findFirstPublished(data);
    }

    const address = state.parseHash(hash);
    if (!address) return null;

    // state.init() より前に呼ばれるため state._data は未設定。data を直接参照する
    const ep = data.find(e => e.id === address.ep);
    const sec = ep?.sections.find(s => s.id === address.sec);
    if (!sec?.published) return null;

    return address;
}

/**
 * 指定 sec の本文をロード・パースして Scene[] を返す。
 * transition.init に LoadSec コールバックとして渡す。
 * state.setScenesCount() もここで呼ぶ。
 *
 * @throws fetch 失敗時はそのまま throw する
 */
async function _loadSec(ep: number, sec: number): Promise<Scene[]> {
    const text = await loader.loadText(ep, sec);
    const scenes = parser.parse(text);
    state.setScenesCount(scenes.length);
    return scenes;
}

/**
 * 指定 ep の全公開 sec をロード・パースして結合した Scene[] と
 * currentSec の ep 内シーンオフセット（0始まり）を返す。
 * ep ごとにメモリキャッシュする。
 *
 * @param ep         エピソード番号
 * @param currentSec オフセットを知りたいセクション番号
 * @returns { all: ep 内全 Scene[], offset: currentSec の ep 内開始インデックス }
 * @throws fetch 失敗時はそのまま throw する
 */
async function _getAllEpScenes(
    ep: number,
    currentSec: number,
): Promise<{ all: Scene[]; offset: number }> {
    if (!_epCache.has(ep)) {
        const episode = state.getEpisode(ep);
        if (!episode) return { all: [], offset: 0 };

        const allScenes: Scene[] = [];
        const secOffsets = new Map<number, number>();

        for (const section of episode.sections) {
            if (!section.published) continue;
            secOffsets.set(section.id, allScenes.length);
            const text = await loader.loadText(ep, section.id);
            const scenes = parser.parse(text);
            allScenes.push(...scenes);
        }

        _epCache.set(ep, { allScenes, secOffsets });
    }

    const cached = _epCache.get(ep)!;
    const offset = cached.secOffsets.get(currentSec) ?? 0;
    return { all: cached.allScenes, offset };
}

/**
 * エラーメッセージを #error-message に表示し、#main-container を非表示にする。
 */
function _showError(message: string): void {
    const loadingEl = document.querySelector<HTMLElement>('#loading');
    const errorEl = document.querySelector<HTMLElement>('#error-message');
    const containerEl = document.querySelector<HTMLElement>('#main-container');
    if (loadingEl) loadingEl.hidden = true;
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
