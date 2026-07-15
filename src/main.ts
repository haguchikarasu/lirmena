/*
 * main.ts
 * 【責務】本文ページ（contents/[ep2桁]-[sec2桁].html）／巻末あとがきページ（contents/vol[XX]-afterword.html）の
 *         起動・初期化・オーケストレーション。<body> の data-ep / data-sec / data-vol / data-kind から自ページを
 *         確定し、本文モードでは全シーンを連続レイアウトで一括描画、あとがきモードでは本文シェルを流用して
 *         あとがき本文（stub 段落）を描画する。ページ境界の移動は nav.ts が location.href で行う。
 * 【IF】export なし（エントリーポイント）
 * 【依存】
 *   loader   : loadStory(): Promise<StoryData>
 *              fetchCharacters(): Promise<CharactersData>
 *              loadText(ep, sec): Promise<string>
 *              loadAfterwordText(vol): Promise<string>
 *   parser   : parse(text: string): Scene[]
 *   state    : init(story: StoryData, address: SecAddress): void
 *              initAfterword(story: StoryData, vol: number): void
 *              isPublished / getPrevPublishedSec など（責務は state.ts 冒頭コメント参照）
 *   renderer : renderScenes(scenes: Scene[]): void
 *   bg       : init(layers: BgLayerSpec[], source: BgSource): void
 *              subscribe(cb: (n: ScrollNotification) => void): void
 *   reader   : init(address: SecAddress): void / handleScroll(n: ScrollNotification): void
 *   nav      : init() / initAfterword(vol) / update() / updateAfterword() / arm()
 *   transition: init(): void（到着フェードイン起動。シェル class="fading" を外す）
 *   menu     : init(characters: CharactersData): void
 *   feedback : init(): void（本文末の Ｘ共有／マシュマロ両ボタンに URL を載せ hidden 解除）
 *   settings : init(callbacks): void / getSettings(): Settings
 *   device   : init(callbacks?: { onDeviceChange?: (d: 'pc' | 'sp') => void }): void
 *   tutorial : init(): void
 *   opening  : init(): void / update(progress: number): void
 *   pan      : init(): void
 *   immersive: init(): void
 *   bookmark : init() / setAutoRecordSuppressed / recordReached / recordReachedAfterword / etc.
 *   suppression: shouldSuppressReachedRead / shouldSuppressAutoSave（本文モード用の純関数）
 *   volumes  : computeStoryStage(read, story): StoryStage（本文 sec キーのみで判定・あとがきキー vol[XX]-af は除外）
 *   analytics: send(settings, storyStage, read, reached, episodes): void
 * 【被依存】なし
 * 【注意】あとがきモードでは外部流入抑止判定を省略し、常に到達を記録する（あとがきに迷い込むケースは
 *         実運用で稀・内部遷移限定と割り切る）。オートセーブは reader.ts が state.getMode で本文／あとがき
 *         の saveAutoSave / saveAutoSaveAfterword を呼び分ける。「続きから読む」の復元は本文モードなら
 *         autosave、あとがきモードなら autosaveAfterword を参照する（保存キーは独立）。
 */

import './styles/index.css';

import * as axis from './axis';
import * as device from './device';
import * as state from './state';
import * as renderer from './renderer';
import * as bg from './bg';
import * as reader from './reader';
import * as nav from './nav';
import * as transition from './transition';
import * as menu from './menu';
import * as settings from './settings';
import * as tutorial from './tutorial';
import * as opening from './opening';
import * as pan from './pan';
import * as immersive from './immersive';
import * as bookmark from './bookmark';
import * as loader from './loader';
import * as parser from './parser';
import * as feedback from './feedback';
import * as analytics from './analytics';
import { computeStoryStage } from './volumes';
import { shouldSuppressReachedRead, shouldSuppressAutoSave } from './suppression';
import type { Scene, EpisodesData, CharactersData, StoryData, SecAddress } from './types';

const WHEEL_SCROLL_MULTIPLIER = 1;

// _readAddress の返り値。本文モードは data-ep / data-sec、あとがきモードは data-vol / data-kind="afterword" から得る。
type PageAddressLocal =
    | { kind: 'sec'; ep: number; sec: number }
    | { kind: 'afterword'; vol: number };

document.addEventListener('DOMContentLoaded', () => { void _init(); });

async function _init(): Promise<void> {
    try {
        await _bootstrap();
    } catch (err) {
        console.error('[main] 初期化中に想定外の例外が発生しました。フォールバック表示します。', err);
        _showError('ページの表示中に問題が発生しました。お手数ですが再読み込みしてください。');
    }
}

/**
 * 初期化シーケンス本体。address の kind で本文モード（_bootstrapSec）／あとがきモード（_bootstrapAfterword）に分岐する。
 * transition.init と _readAddress / loader.loadStory は共通処理としてラッパー側で行い、分岐先にはロード済みの
 * story と address を渡す（両モードで再取得しない）。
 */
async function _bootstrap(): Promise<void> {
    transition.init();

    const address = _readAddress();
    if (!address) {
        _showError('ページ情報が不正です。URLをご確認ください。');
        return;
    }

    let story: StoryData;
    try {
        story = await loader.loadStory();
    } catch {
        _showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    if (address.kind === 'afterword') {
        await _bootstrapAfterword(story, address.vol);
    } else {
        await _bootstrapSec(story, address.ep, address.sec);
    }
}

/**
 * 本文モードの初期化シーケンス。
 *   1. 平坦化 Episode[] から自 sec の存在／公開検証
 *   2. state.init(story, { ep, sec }) で現在位置を確定
 *   3. characters.json と本文 txt を取得・パース（vol 情報は story から派生）
 *   4-11. wheel/pan/immersive → settings/device/bookmark → stage 算出＋analytics → 外部流入抑止 →
 *         nav/menu/feedback → renderScenes/bg.init → 初期スクロール復元 → tutorial/opening/nav.update →
 *         reader.init/bg.subscribe → arm → loading 非表示
 */
async function _bootstrapSec(story: StoryData, ep: number, sec: number): Promise<void> {
    const data: EpisodesData = story.flatMap(v => v.episodes);
    const episode = data.find(e => e.id === ep);
    const section = episode?.sections.find(s => s.id === sec);
    if (!section) {
        _showError('ページが見つかりません。');
        return;
    }
    if (!section.published) {
        _showError('このページはまだ公開されていません。');
        return;
    }

    state.init(story, { ep, sec });

    let charactersData: CharactersData;
    try {
        charactersData = await loader.fetchCharacters();
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

    const mainContainer = _initMainContainer();

    settings.init({
        onClearBookmarks: () => bookmark.clearSlots(),
        onClearReached: () => bookmark.clearReached(),
        onClearRead: () => bookmark.clearRead(),
        onWritingModeChange: () => _onWritingModeChange(mainContainer),
    });
    device.init({ onDeviceChange: () => _onDeviceChange(mainContainer) });
    bookmark.init();

    const read = bookmark.getRead();
    const reached = bookmark.getReached();
    const storyStage = computeStoryStage(read, story);
    document.documentElement.dataset.storyStage = String(storyStage);
    // 次回ロード時の FOUC 回避用にキャッシュ。reader.html / title.html / index.html の早期 <script> が
    // 起動前に読み取り <html data-story-stage> を先付けする。値は 1〜5 の文字列のみ。
    try { localStorage.setItem('lirmena.storyStage', String(storyStage)); } catch {}
    analytics.send(settings.getSettings(), storyStage, read, reached, data);

    const externalEntry = _isExternalEntry();
    const prev = state.getPrevPublishedSec();
    const prevSecRead = prev !== null && bookmark.hasRead(prev.ep, prev.sec);
    const reachedHere = bookmark.hasReached(ep, sec);
    const readHere = bookmark.hasRead(ep, sec);
    const autoSaveHere = bookmark.isAutoSaveAt(ep, sec);
    const reachedReadSuppressed = shouldSuppressReachedRead({ externalEntry, prevSecRead, reachedHere, readHere, autoSaveHere });
    const autoSaveSuppressed = shouldSuppressAutoSave({ externalEntry, prevSecRead, autoSaveHere });
    bookmark.setAutoRecordSuppressed({ reachedRead: reachedReadSuppressed, autoSave: autoSaveSuppressed });
    if (!reachedReadSuppressed) bookmark.recordReached(ep, sec);

    nav.init();
    menu.init(charactersData);
    feedback.init();

    renderer.renderScenes(scenes);
    const currentVol = state.getCurrentVolume()?.volume ?? 1;
    bg.init(scenes.map(s => ({ bgFile: s.bgFile, bgPositionX: s.bgPositionX })), { kind: 'ep', vol: currentVol, ep });

    _restoreInitialScroll(mainContainer, { ep, sec });

    tutorial.init();
    opening.init();
    nav.update();

    reader.init({ ep, sec });
    bg.subscribe(reader.handleScroll);

    requestAnimationFrame(() => requestAnimationFrame(() => nav.arm()));

    const loadingEl = document.querySelector<HTMLElement>('#loading');
    if (loadingEl) loadingEl.hidden = true;
}

/**
 * あとがきモードの初期化シーケンス。本文シェル（reader.html）を流用しつつ、本文の代わりに
 * あとがき本文（public/vol[XX]/txt/vol[XX]-afterword.txt）をパースして描画する。
 * オートセーブ／pendingJump は独立キー（autosaveAfterword / pendingJumpAfterword）を使い、
 * 「戻る」は自 vol の巻末公開 sec 本文末へ、「次へ」は次巻タイトルページへ遷移する（nav 側でモード分岐）。
 * 外部流入抑止判定は行わず常に到達を記録する（あとがきに迷い込むケースは実運用で稀と割り切る）。
 */
async function _bootstrapAfterword(story: StoryData, vol: number): Promise<void> {
    const target = story.find(v => v.volume === vol);
    if (!target) {
        _showError('ページが見つかりません。');
        return;
    }
    if (target.afterword?.published !== true) {
        _showError('このページはまだ公開されていません。');
        return;
    }

    state.initAfterword(story, vol);

    let charactersData: CharactersData;
    try {
        charactersData = await loader.fetchCharacters();
    } catch {
        _showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    let scenes: Scene[];
    try {
        scenes = parser.parse(await loader.loadAfterwordText(vol));
    } catch {
        _showError('本文の読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    const mainContainer = _initMainContainer();

    settings.init({
        onClearBookmarks: () => bookmark.clearSlots(),
        onClearReached: () => bookmark.clearReached(),
        onClearRead: () => bookmark.clearRead(),
        onWritingModeChange: () => _onWritingModeChange(mainContainer),
    });
    device.init({ onDeviceChange: () => _onDeviceChange(mainContainer) });
    bookmark.init();

    const read = bookmark.getRead();
    const reached = bookmark.getReached();
    const storyStage = computeStoryStage(read, story);
    document.documentElement.dataset.storyStage = String(storyStage);
    // 次回ロード時の FOUC 回避用にキャッシュ（本文モード側と同処理）。
    try { localStorage.setItem('lirmena.storyStage', String(storyStage)); } catch {}
    // analytics は本文 Episode[] を渡す（あとがきキー vol[XX]-af は buildSecOrderIndex に含まれない＝
    // read_ratio 分母に影響しない・furthest_position は本文 sec のみで算出される既存動作を維持）。
    analytics.send(settings.getSettings(), storyStage, read, reached, story.flatMap(v => v.episodes));

    // あとがきは外部流入抑止判定を省略し、常に到達を記録する。
    bookmark.setAutoRecordSuppressed({ reachedRead: false, autoSave: false });
    bookmark.recordReachedAfterword(vol);

    nav.initAfterword(vol);
    menu.init(charactersData);
    feedback.init();

    renderer.renderScenes(scenes);
    // あとがきモードでも @@BG@@ が使える。画像 URL は BgSource で分岐し、あとがきは public/vol[XX]/{ファイル名} 直下から解決する
    // （ep/img/ フォルダを切らず vol 直下＝heroCard と同じ場所を共有する。要件 06-3 / 03）。
    bg.init(scenes.map(s => ({ bgFile: s.bgFile, bgPositionX: s.bgPositionX })), { kind: 'afterword', vol });

    _restoreInitialScrollAfterword(mainContainer, vol);

    tutorial.init();
    opening.init();
    nav.updateAfterword();

    // reader.init は本文用 SecAddress を受けるが、あとがきモードでは reader 内部の handleScroll が
    // state.getMode() を見て saveAutoSaveAfterword を呼ぶため、ep/sec=0 のダミーを渡してよい。
    reader.init({ ep: 0, sec: 0 });
    bg.subscribe(reader.handleScroll);

    requestAnimationFrame(() => requestAnimationFrame(() => nav.arm()));

    const loadingEl = document.querySelector<HTMLElement>('#loading');
    if (loadingEl) loadingEl.hidden = true;
}

/** #main-container を取得し、wheel/pan/immersive の共通結線を行う（両モード共通） */
function _initMainContainer(): HTMLElement {
    const mainContainer = document.querySelector<HTMLElement>('#main-container')!;
    mainContainer.addEventListener('wheel', (e) => {
        if (axis.getMode() === 'horizontal') return;
        e.preventDefault();
        const forward = axis.getProgressFromEvent(e) * WHEEL_SCROLL_MULTIPLIER;
        mainContainer.scrollBy({ left: -forward, behavior: 'smooth' });
    }, { passive: false });
    pan.init();
    immersive.init();
    return mainContainer;
}

/**
 * 起動時の初期スクロール位置を優先度順で決定し #main-container に適用する（本文モード用）。
 * 1. pendingJump / 2. pendingScrollEnd / 3. history.state ratio → autosave / 4. sec 先頭
 */
function _restoreInitialScroll(container: HTMLElement, address: SecAddress): void {
    const { ep, sec } = address;

    const jump = bookmark.readPendingJump();
    if (jump && jump.ep === ep && jump.sec === sec) {
        bookmark.clearPendingJump();
        if (jump.ratio) _scrollToRatio(container, jump.ratio);
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

    if (!_isInAppNavigation()) {
        const histRatio = bookmark.readScrollFromHistory();
        if (histRatio !== null) {
            _scrollToRatio(container, histRatio);
            return;
        }
        const auto = bookmark.getAutoSave();
        if (auto && auto.ep === ep && auto.sec === sec) {
            _scrollToRatio(container, auto.ratio);
            return;
        }
    }

    _scrollToHead(container);
}

/**
 * あとがきモード用の初期スクロール位置決定。
 * 1. pendingJumpAfterword（vol 一致） → 2. history.state ratio（明示前進ナビでない時） →
 * 3. autosaveAfterword（vol 一致） → 4. 先頭
 * 「戻る」でここへ来るケースは無い（あとがき「戻る」は本文ページに遷移するため）＝pendingScrollEnd は対象外。
 */
function _restoreInitialScrollAfterword(container: HTMLElement, vol: number): void {
    const jump = bookmark.readPendingJumpAfterword();
    if (jump && jump.vol === vol) {
        bookmark.clearPendingJumpAfterword();
        _scrollToRatio(container, jump.ratio);
        return;
    }

    if (!_isInAppNavigation()) {
        const histRatio = bookmark.readScrollFromHistory();
        if (histRatio !== null) {
            _scrollToRatio(container, histRatio);
            return;
        }
        const auto = bookmark.getAutoSaveAfterword();
        if (auto && auto.vol === vol) {
            _scrollToRatio(container, auto.ratio);
            return;
        }
    }

    _scrollToHead(container);
}

function _scrollToHead(container: HTMLElement): void {
    axis.setProgress(container, 0);
}

function _scrollToRatio(container: HTMLElement, ratio: number): void {
    const range = axis.getProgressRange(container);
    axis.setProgress(container, Math.min(1, Math.max(0, ratio)) * range);
}

function _onWritingModeChange(container: HTMLElement): void {
    _scrollToRatio(container, reader.getLastRatio());
    tutorial.reposition();
    container.dispatchEvent(new Event('scroll'));
}

function _onDeviceChange(container: HTMLElement): void {
    _scrollToRatio(container, reader.getLastRatio());
    tutorial.reposition();
    container.dispatchEvent(new Event('scroll'));
}

function _scrollToEnd(container: HTMLElement): void {
    const range = axis.getProgressRange(container);
    if (range <= 0) return;
    const ratio = settings.getReadingAnchor() / 100;
    const target = range - axis.getClientSize(container) * (1 - ratio);
    axis.setProgress(container, Math.max(0, target));
}

function _scrollToScene(scene: number): void {
    const scenes = document.querySelectorAll<HTMLElement>('#scene-content .scene');
    const el = scenes[scene - 1];
    if (!el) return;
    el.scrollIntoView(axis.isReverse() ? { inline: 'start', block: 'nearest' } : { block: 'start', inline: 'nearest' });
}

function _isExternalEntry(): boolean {
    const ref = document.referrer;
    if (!ref) return true;
    try {
        return new URL(ref).origin !== location.origin;
    } catch {
        return true;
    }
}

function _navigationType(): string {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type ?? 'navigate';
}

function _isInAppNavigation(): boolean {
    return _navigationType() === 'navigate' && !_isExternalEntry();
}

/**
 * <body> の data-* を読み、本文モード ({ kind:'sec', ep, sec }) または
 * あとがきモード ({ kind:'afterword', vol }) を返す。どちらとも解釈できなければ null。
 * あとがきモードは data-kind="afterword" と数値の data-vol の両方が要る。
 */
function _readAddress(): PageAddressLocal | null {
    const ds = document.body.dataset;
    if (ds.kind === 'afterword') {
        const volNum = Number(ds.vol);
        if (!Number.isInteger(volNum) || volNum < 1) return null;
        return { kind: 'afterword', vol: volNum };
    }
    const epNum = Number(ds.ep);
    const secNum = Number(ds.sec);
    if (!Number.isInteger(epNum) || !Number.isInteger(secNum) || epNum < 1 || secNum < 1) {
        return null;
    }
    return { kind: 'sec', ep: epNum, sec: secNum };
}

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
    document.documentElement.classList.remove('at-opening');
}
