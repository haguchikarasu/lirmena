/*
 * glossary-page.ts
 * 責務: 用語集ページ（glossary.html。資料ページの 1 枚）のエントリ。public/glossary.md を取得して一覧を描き、
 *       直リンク（#g-見出し語）へ着地させる。上の帯（目次へ戻る・人物／地図／用語のタブ。?dev などのクエリの
 *       引き継ぎを含む）は ui/world-nav が結線する。
 * export: なし（エントリ）
 * 依存: glossary.ts（取得・描画・検索・五十音・相互参照）、ui/world-nav（上の帯）。reader 層を import しない
 *       （.dependency-cruiser.cjs の allowed が glossary-page → glossary・ui/world-nav だけを許す）
 * CSS: toc.css（目次と同じ紙面＝パレット・stage 別キーカラー --stage-hue を使い回す）→ _sheet.css（色の部品とアイコン）→
 *      _glossary.css（一覧）→ world-page.css（資料ページの枠組み）→ glossary-page.css（このページだけの差分）の順に
 *      import する。目次（index.ts）は共用ポップアップの CSS を toc.css より前に読むが、それは z-index の上書きを
 *      後勝ちにするため。このページには上書きが無い
 *
 * 飛んだ先（五十音・相互参照・直リンク）の見出しを検索欄の裏に潜らせないため、--gl-sticky-h（_glossary.css の
 * scroll-margin-top）に「検索欄の下端からの余白」を渡す。PC は検索欄が上の帯の真下に貼り付く（sticky）ので
 * 「帯の高さ＋検索欄の高さ＋8px」、スマホは検索欄が一覧の箱の外にある（static）ので 8px だけ。
 */

import './styles/toc.css';
import './styles/_sheet.css';
import './styles/_glossary.css';
import './styles/world-page.css';
import './styles/glossary-page.css';
import { mountGlossary } from './glossary';
import * as worldNav from './ui/world-nav';

worldNav.init();

// 以後の伸び縮み（五十音ボタンの描画・画面幅の変化・上の帯の高さ）は ResizeObserver が追う。ただし通知は非同期なので、
// 直リンクへのスクロールの直前には同期で測り直す（下の mountGlossary の後）
const sticky = document.querySelector<HTMLElement>('#gl-sticky');
const setStickyHeight = (): void => {
    if (!sticky) return;
    const stuck = getComputedStyle(sticky).position === 'sticky';
    const offset = stuck ? worldNav.topHeight() + sticky.offsetHeight : 0;
    document.documentElement.style.setProperty('--gl-sticky-h', `${offset + 8}px`);
};
setStickyHeight();
if (sticky) {
    const ro = new ResizeObserver(setStickyHeight);
    ro.observe(sticky);
    const top = document.getElementById('wp-top');
    if (top) ro.observe(top);
}
// 画面の幅で sticky と static が入れ替わる（glossary-page.css の 900px）。検索欄の高さが変わらなくても測り直す
window.addEventListener('resize', setStickyHeight);

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
