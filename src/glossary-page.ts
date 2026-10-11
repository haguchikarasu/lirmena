/*
 * glossary-page.ts
 * 責務: 用語集ページ（glossary.html）のエントリ。public/glossary.md を取得して一覧を描き、直リンク（#g-見出し語）へ
 *       着地させ、「‹ 目次へ」に ?dev などのクエリを引き継がせる。
 * export: なし（エントリ）
 * 依存: glossary.ts（取得・描画・検索・五十音・相互参照）。ほかの src/ は import しない
 *       （.dependency-cruiser.cjs の allowed が glossary-page → glossary だけを許す）
 * CSS: toc.css（目次と同じ紙面＝パレット・stage 別キーカラー --stage-hue を使い回す）→ _glossary.css（一覧）→
 *      glossary-page.css（このページだけの差分）の順に import する。目次（index.ts）は共用ポップアップの CSS を
 *      toc.css より前に読むが、それは z-index の上書きを後勝ちにするため。このページには上書きが無い
 *
 * 「目次へ」に location.search を付けるのは state.ts の _withQuery と同じ 1 行の複製（state を import しない方針）。
 * href を './' にするのは state.indexUrl() が '../' を使うのと同じ流儀＝目次の URL を /lirmena/ 1 つに保つ
 * （index.html と書くと GA の page_path が /lirmena/ と /lirmena/index.html に割れる）。
 */

import './styles/toc.css';
import './styles/_glossary.css';
import './styles/glossary-page.css';
import { mountGlossary } from './glossary';

const back = document.querySelector<HTMLAnchorElement>('#gl-back');
if (back) back.href = `./${location.search}`;

// 固定バー（検索と五十音）の高さを項目の scroll-margin-top（_glossary.css の --gl-sticky-h）に渡す。
// 以後の伸び縮み（五十音ボタンの描画・画面幅の変化）は ResizeObserver が追う。ただし通知は非同期なので、
// 直リンクへのスクロールの直前には同期で測り直す（下の mountGlossary の後）
const sticky = document.querySelector<HTMLElement>('#gl-sticky');
const setStickyHeight = (): void => {
    if (sticky) document.documentElement.style.setProperty('--gl-sticky-h', `${sticky.offsetHeight + 8}px`);
};
setStickyHeight();
if (sticky) new ResizeObserver(setStickyHeight).observe(sticky);

const list = document.querySelector<HTMLElement>('#gl-list');
const search = document.querySelector<HTMLInputElement>('#gl-search');
const kana = document.querySelector<HTMLElement>('#gl-kana');
const count = document.querySelector<HTMLElement>('#gl-count') ?? undefined;

if (list && search && kana) {
    mountGlossary({ list, search, kana, count, updateHash: true })
        .then(() => {
            // 一覧は fetch の後に描かれるので、ブラウザ標準のアンカースクロールは効かない＝描画後に自分で飛ぶ
            if (!location.hash) return;
            const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
            if (!target) return;
            // 描画で五十音ボタンが入って固定バーが伸びた直後なので、測り直してから飛ぶ
            // （ResizeObserver の通知は非同期で、このスクロールに間に合わない。e2e で着地が 24px ずれて気づいた）
            setStickyHeight();
            target.scrollIntoView({ block: 'start' });
            target.classList.add('gl-flash');
        })
        .catch(() => { /* 文言は mountGlossary が一覧の位置に出している */ });
}
