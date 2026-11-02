/*
 * ui/world-nav.ts
 * 責務: 資料ページ（characters.html・map.html・glossary.html）の上の帯 #wp-top の結線。markup は差し込みの断片
 *       templates/parts/world-nav.html。
 *         - 目次へ戻るリンクと 3 つのタブの href に、いまのクエリ（?dev など）を引き継ぐ（core/query の withQuery）
 *         - ‹ はブラウザの「戻る」と同じ：来た元（本文・目次）へ戻る。来た元がこのサイトに無い（直に開いた・外から来た）
 *           ときだけ目次へ移る（href の './'）
 *         - タブは location.replace で移る＝資料ページ間の行き来を履歴に積まない。‹ やブラウザの「戻る」の行き先は、
 *           タブを何度押しても入ってきた元のまま
 *         - いまのページのタブに aria-current="page" を付ける（どのページかは <body data-world>）
 *         - 帯の実際の高さを CSS 変数 --wp-top-h（<html> の上）に渡す。用語の検索欄が帯の真下に貼り付く位置と、
 *           PC の人物の詳細が貼り付く位置に使う（決め打ちすると、フォントで帯の高さが変わったとき潜る・隙間が空く）
 * export: init(): void
 *         topHeight(): number
 * 依存: core/query。ui 層＝reader 層を import しない。呼び出し元：world-page.ts（人物・地図）、glossary-page.ts（用語）
 *
 * 来た元を覚える場所は sessionStorage（タブごと）：資料ページに入った最初のページで決め、タブで移った先では
 * 来た元（document.referrer）が資料ページになるので、最初に決めた値を使い続ける。
 *
 * 目次へ戻る先を './' にするのは state.indexUrl() が '../' を使うのと同じ流儀＝目次の URL を /lirmena/ 1 つに保つ
 * （index.html と書くと GA の page_path が /lirmena/ と /lirmena/index.html に割れる）。
 */

import { withQuery } from '../core/query';

const BACK_KEY = 'lirmena.worldBack';
const WORLD_PAGE = /\/(characters|map|glossary)\.html$/;

// init(): void
// 帯が無いページでは何もしない。
export function init(): void {
    const top = document.getElementById('wp-top');
    if (!top) return;
    const back = document.querySelector<HTMLAnchorElement>('#wp-back');
    const canBack = _canGoBack();
    if (back) {
        back.href = withQuery('./');
        back.addEventListener('click', (e) => {
            if (!canBack || _modified(e)) return;
            e.preventDefault();
            history.back();
        });
    }
    const here = document.body.dataset.world;
    for (const tab of top.querySelectorAll<HTMLAnchorElement>('.wp-tab[data-world]')) {
        tab.href = withQuery(`${tab.dataset.world}.html`);
        if (tab.dataset.world === here) tab.setAttribute('aria-current', 'page');
        tab.addEventListener('click', (e) => {
            if (_modified(e)) return;
            e.preventDefault();
            if (tab.dataset.world !== here) location.replace(tab.href);
        });
    }
    const setHeight = (): void => {
        document.documentElement.style.setProperty('--wp-top-h', `${top.offsetHeight}px`);
    };
    setHeight();
    new ResizeObserver(setHeight).observe(top);
}

// ‹ で履歴を戻ってよいか（＝来た元がこのサイトの本文・目次か）。資料ページに入った最初のページで決めて覚える。
// 来た元が資料ページ（タブで移ってきた）なら、覚えている値を使う。
// _canGoBack(): boolean
function _canGoBack(): boolean {
    let from: URL | null;
    try { from = document.referrer ? new URL(document.referrer) : null; } catch { from = null; }
    const ours = !!from && from.origin === location.origin && from.pathname.startsWith(import.meta.env.BASE_URL);
    if (ours && WORLD_PAGE.test(from!.pathname)) {
        try { return sessionStorage.getItem(BACK_KEY) === '1' && history.length > 1; } catch { return false; }
    }
    try { sessionStorage.setItem(BACK_KEY, ours ? '1' : '0'); } catch { /* 覚えられなくても、このページでは判定できる */ }
    return ours && history.length > 1;
}

// 修飾キー付き・中クリックなど（別タブで開く操作）はブラウザに任せる。
// _modified(e: MouseEvent): boolean
function _modified(e: MouseEvent): boolean {
    return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

// topHeight(): number
// 帯のいまの高さ（px）。ResizeObserver の通知は非同期なので、測り直しが要る場面（直リンクへの着地の直前）で同期で読む。
export function topHeight(): number {
    return document.getElementById('wp-top')?.offsetHeight ?? 0;
}
