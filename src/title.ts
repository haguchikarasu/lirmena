/*
 * title.ts
 * 責務: タイトルページ（contents/[ep2桁]-00.html）の制御。
 *       <body> の data-ep から自 ep を確定し、ep タイトル・背景画像・変更履歴を描画、
 *       3ボタン（本文を読む／戻る／目次に戻る）の遷移を結線する。
 * export: なし（エントリーポイント）
 * 依存: state.ts / loader.ts / bookmark.ts（「戻る」の終端スクロールフラグ受け渡しのみ）/ transition.ts（離脱・到着フェード）
 * 被依存: なし
 *
 * 画面（タイトルシェルに静的記述された DOM を querySelector で取得）:
 *   #title-screen            … 縦長フルスクリーンの器（初期 hidden、描画後に表示）
 *   #title-screen-ep-title   … ep タイトル
 *   #btn-title-enter         … 本文を読む → 当 ep の先頭公開 sec 本文ページへ
 *   #btn-title-prev          … 戻る → 前 ep の最終 sec 本文ページの終端へ（pendingScrollEnd を書く。ep1 等は disabled）
 *   #btn-title-index         … 目次に戻る（<a href="../index.html">。JS では制御しない）
 *   #title-screen-changelog  … 変更履歴（パッチを除外しマイナー以上を表示。無ければ「更新履歴なし」）
 *
 * 背景画像: {BASE_URL}ep[XX]/{coverFile}（episodes.json の coverFile。省略時 title.avif）。存在しなければ CSS の黒背景にフォールバック。
 *   coverPositionX（任意・例 "30%"）は CSS 変数 --cover-position-x に設定し、縦長画面のみ style.css 側で background-position に反映する。
 *
 * 【ページ遷移】「本文を読む」「戻る」は transition.leave 経由（離脱フェード）。「目次に戻る」は <a href> のまま。
 *         _init 冒頭で transition.init() を呼び、シェル class="fading" を外して到着フェードインを起こす。
 */

import * as state from './state';
import * as loader from './loader';
import * as bookmark from './bookmark';
import * as transition from './transition';
import type { ChangelogEntry, EpisodesData } from './types';

const GITHUB_COMMIT_BASE = 'https://github.com/haguchikarasu/lirmena/commit/';

document.addEventListener('DOMContentLoaded', () => { void _init(); });

async function _init(): Promise<void> {
    // 到着フェードイン（シェルは class="fading" で読み込まれる）。await より前に外して黒から明ける。
    transition.init();

    const ep = _readEp();
    if (ep === null) {
        _showError('ページ情報が不正です。URLをご確認ください。');
        return;
    }

    let data: EpisodesData;
    try {
        data = await loader.loadEpisodes();
    } catch {
        _showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
        return;
    }

    state.init(data, { ep, sec: 0 });

    _renderTitle(ep);
    _wireButtons();

    let changelog: ChangelogEntry[] = [];
    try {
        changelog = await loader.fetchEpChangelog(ep);
    } catch {
        // 変更履歴が無い ep は「更新履歴なし」を表示する
    }
    _renderChangelog(changelog);

    const titleScreen = document.querySelector<HTMLElement>('#title-screen');
    if (titleScreen) titleScreen.hidden = false;
}

/** <body> の data-ep を読む。数値として解釈できなければ null */
function _readEp(): number | null {
    const epNum = Number(document.body.dataset.ep);
    return Number.isInteger(epNum) && epNum >= 1 ? epNum : null;
}

/** ep タイトルと背景画像を反映する */
function _renderTitle(ep: number): void {
    const titleEl = document.querySelector<HTMLElement>('#title-screen-ep-title');
    if (titleEl) titleEl.textContent = state.getEpTitle(ep) ?? '';

    const titleScreen = document.querySelector<HTMLElement>('#title-screen');
    if (titleScreen) {
        // 背景ファイル名は episodes.json の coverFile（省略時 title.avif）。常に epNN/ 配下から解決。
        const episode = state.getEpisode(ep);
        const file = episode?.coverFile ?? 'title.avif';
        const path = `${import.meta.env.BASE_URL}ep${String(ep).padStart(2, '0')}/${file}`;
        titleScreen.style.backgroundImage = `url('${path}')`;
        // 左右位置は CSS 変数に流すのみ。縦長画面での反映可否は style.css のメディアクエリが担う。
        if (episode?.coverPositionX) {
            titleScreen.style.setProperty('--cover-position-x', episode.coverPositionX);
        }
    }
}

/** 3ボタンのうち JS 制御が必要な「本文を読む」「戻る」を結線する */
function _wireButtons(): void {
    const enter = document.querySelector<HTMLButtonElement>('#btn-title-enter');
    if (enter) {
        const url = state.getTitleEnterUrl();
        enter.disabled = url === null;
        if (url) enter.addEventListener('click', () => { transition.leave(url); });
    }

    const prev = document.querySelector<HTMLButtonElement>('#btn-title-prev');
    if (prev) {
        const addr = state.getTitlePrevAddress();
        prev.disabled = addr === null;
        if (addr) {
            const url = state.getTitlePrevUrl()!;
            prev.addEventListener('click', () => {
                // 遷移先（前 ep 最終 sec）をロード時に終端へスクロールさせる（オートセーブ復元より優先）。
                bookmark.writePendingScrollEnd(addr.ep, addr.sec);
                transition.leave(url);
            });
        }
    }
}

/**
 * 変更履歴を描画する。パッチ（バージョン第3位が 0 でない）を除外しマイナー以上のみ表示。
 * エントリが無ければ「更新履歴なし」。バージョン番号を GitHub コミットへのリンクにする。
 */
function _renderChangelog(changelog: ChangelogEntry[]): void {
    const area = document.querySelector<HTMLElement>('#title-screen-changelog');
    if (!area) return;

    const filtered = changelog.filter(entry => entry.version.split('.')[2] === '0');
    if (filtered.length === 0) {
        area.replaceChildren(document.createTextNode('更新履歴なし'));
        return;
    }

    const rows = filtered.map(entry => {
        const row = document.createElement('p');
        row.className = 'changelog-entry';

        const dateSpan = document.createElement('span');
        dateSpan.className = 'changelog-date';
        dateSpan.textContent = entry.date;

        const versionSpan = document.createElement('span');
        versionSpan.className = 'changelog-version';
        const link = document.createElement('a');
        link.href = `${GITHUB_COMMIT_BASE}${entry.sha}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `v${entry.version}`;
        versionSpan.append(link);

        const changeSpan = document.createElement('span');
        changeSpan.className = 'changelog-change';
        changeSpan.textContent = entry.change;

        row.append(dateSpan, versionSpan, changeSpan);
        return row;
    });
    area.replaceChildren(...rows);
}

/** エラーメッセージを #error-message に表示し、#title-screen を非表示にする */
function _showError(message: string): void {
    const errorEl = document.querySelector<HTMLElement>('#error-message');
    const titleScreen = document.querySelector<HTMLElement>('#title-screen');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }
    if (titleScreen) titleScreen.hidden = true;
}
