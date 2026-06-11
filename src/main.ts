/*
 * main.ts
 * 【責務】本文ページ（contents/[ep2桁]-[sec2桁].html）の起動・初期化・オーケストレーション。
 *         <body> の data-ep / data-sec から自ページを確定し、その sec の全シーンを連続レイアウトで一括描画する。
 *         ページ境界の移動は nav.ts が location.href で行う（URL ハッシュは持たない）。
 * 【IF】export なし（エントリーポイント）
 * 【依存】
 *   loader   : loadEpisodes(): Promise<EpisodesData>
 *              fetchCharacters(): Promise<CharactersData>
 *              fetchVolumes(): Promise<VolumesData>
 *              loadText(ep: number, sec: number): Promise<string>
 *   parser   : parse(text: string): Scene[]
 *   state    : init(data: EpisodesData, address: SecAddress): void
 *              isPublished(ep: number, sec: number): boolean
 *   renderer : renderScenes(scenes: Scene[]): void
 *   bg       : init(layers: BgLayerSpec[], ep: number): void
 *              subscribe(cb: (n: ScrollNotification) => void): void
 *   reader   : init(address: SecAddress): void / handleScroll(n: ScrollNotification): void
 *   nav      : init(): void / update(): void
 *   menu     : init(characters: CharactersData, volumes: VolumesData): void
 *   settings : init(callbacks: { onClearBookmarks: () => void; onClearRead: () => void }): void
 *   tutorial : init(): void
 *   opening  : init(): void / update(progress: number): void
 *   bookmark : init(): void / recordReached(ep, sec): void / clearSlots(): void / clearRead(): void
 *              readPendingJump() / clearPendingJump() / readPendingScrollEnd() / clearPendingScrollEnd() / getAutoSave()
 * 【被依存】なし
 * 【注意】GA4（gtag）は本文シェルの config スニペットがページロード時に page_view を自動送信する。
 *         マルチページ化により main.ts からの手動 page_view 送信は不要（ページ単位計測に戻した）。
 * 【注意】wheel 補正（deltaY → scrollLeft 変換）は #main-container に1度だけ登録する。
 *         writing-mode: vertical-rl では deltaY（正＝下スクロール）を反転して横スクロールに変換する。
 * 【Phase 2】bookmark.init() で旧データ移行を起動し recordReached() で自 sec を到達記録。
 *         render 後に reader.init() → bg.subscribe(reader.handleScroll) を結線し、スクロール由来の通知を
 *         progress（sec 進捗バー）／オートセーブ／現在シーンへ fan-out する。
 * 【Phase 3】renderScenes() 後に bg.init() で #bg-stack のクロスフェードレイヤーを構築。tutorial.init() で
 *         読書点マーカー・初回ガイドを起動。初期スクロール位置を以下の優先度で復元してから subscribe する：
 *           1. pendingJump（栞・自 ep/sec 一致）… 新栞=scrollLeft / 移行旧栞=該当シーン先頭 → 消費
 *           2. pendingScrollEnd（タイトル「戻る」・自 ep/sec 一致）… 本文末へ（末尾余白の手前・オートセーブより優先）→ 消費
 *           3. オートセーブ（自 ep/sec 一致）… scrollLeft 復元
 *           4. いずれもなし … sec 先頭（右端）
 */

// 本文ページの共有スタイル。main.ts を Vite エントリにしたことで、本 import が
// 本文シェル用の固定名 CSS（assets/main.css）として出力される。本文・タイトル両シェルがこれを <link> 参照する。
import '../style.css';

import * as state from './state';
import * as renderer from './renderer';
import * as bg from './bg';
import * as reader from './reader';
import * as nav from './nav';
import * as menu from './menu';
import * as settings from './settings';
import * as tutorial from './tutorial';
import * as opening from './opening';
import * as bookmark from './bookmark';
import * as loader from './loader';
import * as parser from './parser';
import type { Scene, EpisodesData, CharactersData, VolumesData, SecAddress } from './types';

/** マウスホイールのスクロール量倍率 */
const WHEEL_SCROLL_MULTIPLIER = 2;

document.addEventListener('DOMContentLoaded', () => { void _init(); });

/**
 * エントリーポイント。各モジュールを順次初期化する。
 * エラー発生時は _showError() を呼んで処理を中断する。
 *
 * 初期化順序:
 *   1. <body> の data-ep / data-sec から自ページの ep/sec を確定
 *   2. loader.loadEpisodes() で episodes.json を取得し、自 sec が公開済みか検証
 *   3. state.init(data, { ep, sec }) で現在位置を確定
 *   4. characters.json / volumes.json と本文 txt を取得・パース
 *   5. #main-container に wheel リスナーを登録（縦スクロール入力→横スクロール補正）
 *   6. settings / bookmark / nav / menu を初期化（bookmark.init で旧データ移行）→ 自 sec を到達記録
 *   7. renderer.renderScenes() で全シーンを連続レイアウト描画
 *   8. bg.init() で #bg-stack のクロスフェードレイヤーを構築
 *   9. 初期スクロール位置を復元（pendingJump → pendingScrollEnd → オートセーブ → sec 先頭）
 *   10. tutorial.init()（読書点マーカー・初回ガイド）・opening.init()（開幕アフォーダンス）・nav.update() でボタン状態を確定
 *   11. reader.init() → bg.subscribe(reader.handleScroll) で結線し（復元位置で初回 emit）、ローディングを隠す
 */
async function _init(): Promise<void> {
    const address = _readAddress();
    if (!address) {
        _showError('ページ情報が不正です。URLをご確認ください。');
        return;
    }
    const { ep, sec } = address;

    let data: EpisodesData;
    try {
        data = await loader.loadEpisodes();
    } catch {
        _showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    const episode = data.find(e => e.id === ep);
    const section = episode?.sections.find(s => s.id === sec);
    if (!section?.published) {
        _showError('ページが見つかりません。URLをご確認ください。');
        return;
    }

    state.init(data, { ep, sec });

    let charactersData: CharactersData;
    let volumesData: VolumesData;
    try {
        [charactersData, volumesData] = await Promise.all([
            loader.fetchCharacters(),
            loader.fetchVolumes(),
        ]);
    } catch {
        _showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    let scenes: Scene[];
    try {
        scenes = parser.parse(await loader.loadText(ep, sec));
    } catch {
        _showError('本文の読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    const mainContainer = document.querySelector<HTMLElement>('#main-container')!;
    mainContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        mainContainer.scrollBy({ left: -e.deltaY * WHEEL_SCROLL_MULTIPLIER, behavior: 'smooth' });
    }, { passive: false });

    settings.init({
        onClearBookmarks: () => bookmark.clearSlots(),
        onClearRead: () => bookmark.clearRead(),
    });
    bookmark.init();
    bookmark.recordReached(ep, sec);
    nav.init();
    menu.init(charactersData, volumesData);

    renderer.renderScenes(scenes);
    bg.init(scenes.map(s => ({ bgFile: s.bgFile, bgPositionX: s.bgPositionX })), ep);

    // 初期スクロール位置を復元してから subscribe する（初回 emit が復元後の位置・現在シーンを反映するため）。
    _restoreInitialScroll(mainContainer, address);

    tutorial.init();
    opening.init();
    nav.update();

    // スクロール由来の通知を progress（sec 進捗バー）／オートセーブ／現在シーンへ fan-out する結線。
    reader.init({ ep, sec });
    bg.subscribe(reader.handleScroll);

    const loadingEl = document.querySelector<HTMLElement>('#loading');
    if (loadingEl) loadingEl.hidden = true;
}

/**
 * 起動時の初期スクロール位置を優先度順で決定し #main-container に適用する。
 * 1. pendingJump（栞）が自 ep/sec と一致 → 新栞=scrollLeft / 移行旧栞(scrollLeft 0 & scene>0)=該当シーン先頭。消費する
 * 2. pendingScrollEnd（タイトル「戻る」）が自 ep/sec と一致 → 本文末へ（末尾余白の手前・オートセーブより優先）。消費する
 * 3. オートセーブが自 ep/sec と一致 → scrollLeft 復元
 * 4. いずれもなし → sec 先頭（右端）
 * 縦書き vertical-rl のスクロール符号差は、保存した scrollLeft をそのまま書き戻すことで吸収する。
 */
function _restoreInitialScroll(container: HTMLElement, address: SecAddress): void {
    const { ep, sec } = address;

    const jump = bookmark.readPendingJump();
    if (jump && jump.ep === ep && jump.sec === sec) {
        bookmark.clearPendingJump();
        if (jump.scrollLeft) container.scrollLeft = jump.scrollLeft;
        else if (jump.scene > 0) _scrollToScene(jump.scene);
        else _scrollToHead(container);
        return;
    }

    const end = bookmark.readPendingScrollEnd();
    if (end && end.ep === ep && end.sec === sec) {
        bookmark.clearPendingScrollEnd();
        _scrollToEnd(container);
        return;
    }

    const auto = bookmark.getAutoSave();
    if (auto && auto.ep === ep && auto.sec === sec) {
        container.scrollLeft = auto.scrollLeft;
        return;
    }

    _scrollToHead(container);
}

/** sec 先頭（右端＝読書開始）へ。vertical-rl では scrollLeft 0 が先頭 */
function _scrollToHead(container: HTMLElement): void {
    container.scrollLeft = 0;
}

/**
 * 本文末（＝末尾の恒久余白の手前）へ着地する。末尾には本文表示幅ぶんの空白余白（btn-container-end）が
 * あるため、絶対終端だと空白画面に着地してしまう。余白ぶん（=clientWidth）手前に寄せて本文末を見せる。
 * ブラウザ間のスクロール符号差は両方向トライで吸収する。
 */
function _scrollToEnd(container: HTMLElement): void {
    const range = container.scrollWidth - container.clientWidth;
    if (range <= 0) return;
    const target = Math.max(0, range - container.clientWidth);
    container.scrollLeft = target;
    if (Math.abs(container.scrollLeft) < target - 2) container.scrollLeft = -target;
}

/** 移行旧栞の coarse 復元：指定シーン（1-indexed）の先頭へ。厳密でなくてよい（要件 06-5） */
function _scrollToScene(scene: number): void {
    const scenes = document.querySelectorAll<HTMLElement>('#scene-content .scene');
    const el = scenes[scene - 1];
    if (el) el.scrollIntoView({ inline: 'start', block: 'nearest' });
}

/**
 * <body> の data-ep / data-sec を読み、{ ep, sec } を返す。
 * 数値として解釈できない場合は null。
 */
function _readAddress(): { ep: number; sec: number } | null {
    const { ep, sec } = document.body.dataset;
    const epNum = Number(ep);
    const secNum = Number(sec);
    if (!Number.isInteger(epNum) || !Number.isInteger(secNum) || epNum < 1 || secNum < 1) {
        return null;
    }
    return { ep: epNum, sec: secNum };
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
