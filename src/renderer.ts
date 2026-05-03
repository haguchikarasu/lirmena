/*
 * renderer.ts
 * 責務: Scene → DOM 生成（エリアC 本文）、タイトル画面（#title-screen）の DOM 生成
 * export: renderTitleScreen(epTitle, changelog, img?), renderScene()
 * 依存: parser.ts（TextNode 型）、types.ts（ChangelogEntry 型）
 *
 * Scene.content は TextNode[] として実装する（types.ts 側は unknown のまま。本モジュールでキャスト）。
 *
 * タイトル画面（#title-screen）：
 *   - #main-container を非表示にして #title-screen を表示する
 *   - 呼び出しのたびに replaceChildren() で全体を再構築する
 *   - DOM 構造：
 *       .title-screen-header
 *         .title-screen-ep-title（ep タイトル）
 *         #btn-title-enter  : 本文に入るボタン
 *         #btn-title-prev   : 前 ep へ戻るボタン
 *         #btn-title-index  : 目次に戻るボタン（<a> タグ）
 *       .title-screen-changelog（ChangelogEntry[] または「更新履歴なし」）
 *   - レイアウトは縦長固定
 *
 * エリアC（本文）：
 *   - 既存の本文コンテナ要素の内容を差し替える
 *   - #title-screen を非表示にして #main-container を表示する
 *   - TextNode[] を <p> 要素に分割して変換する：
 *       { type: "text"  }  → テキストノード（空白・連続スペースを保持）
 *       { type: "ruby"  }  → <ruby>base<rt>rt</rt></ruby>
 *       { type: "tcy"   }  → <span style="text-combine-upright: all">value</span>
 *       { type: "br"    }  → <p> の境界（\n 1つ → </p><p>）
 *       { type: "blank" }  → <p> の境界＋空行（\n\n → </p><br><p>）
 *
 * スクロール位置（_applyScroll）：
 *   - scrollLeft が undefined のとき：表示要素のブロック始端（vertical-rl では右端）が
 *     ビューポート右端に来るよう scrollIntoView({ block: 'start' }) で境界スクロールする。
 *     scrollLeft 直接操作は writing-mode: vertical-rl での符号が実装依存のため避ける。
 *   - scrollLeft が数値のとき：#main-container の scrollLeft をその値に復元する（戻る遷移用）。
 */

import type { Scene, ChangelogEntry } from "./types";
import type { TextNode } from "./parser";

const mainContainerEl = document.querySelector<HTMLElement>('#main-container')!;
const titleScreenEl = document.querySelector<HTMLElement>('#title-screen')!;
const sceneContentEl = document.querySelector<HTMLElement>('#scene-content')!;

// タイトル画面を #title-screen に描画し、#main-container を非表示にする。
// 呼び出しのたびに replaceChildren() で全体を再構築する。
// nav.ts が querySelector でボタンを取得してイベントを登録する。
// img が指定されたとき img/titlecard/ から画像を全面表示する。未指定なら黒背景のみ。
// renderTitleScreen(epTitle: string, changelog: ChangelogEntry[], img?: string): void
export function renderTitleScreen(epTitle: string, changelog: ChangelogEntry[], img?: string): void {
    const header = document.createElement('div');
    header.className = 'title-screen-header';

    const titleEl = document.createElement('p');
    titleEl.className = 'title-screen-ep-title';
    titleEl.textContent = epTitle;

    const btnEnter = document.createElement('button');
    btnEnter.type = 'button';
    btnEnter.id = 'btn-title-enter';
    btnEnter.textContent = '本文を読む';

    const btnPrev = document.createElement('button');
    btnPrev.type = 'button';
    btnPrev.id = 'btn-title-prev';
    btnPrev.textContent = '前のエピソードへ';

    const btnIndex = document.createElement('a');
    btnIndex.id = 'btn-title-index';
    btnIndex.href = 'index.html';
    btnIndex.textContent = '目次へ戻る';

    header.append(titleEl, btnEnter, btnPrev, btnIndex);

    const changelogArea = document.createElement('div');
    changelogArea.className = 'title-screen-changelog';
    if (changelog.length === 0) {
        changelogArea.appendChild(document.createTextNode('更新履歴なし'));
    } else {
        for (const entry of changelog) {
            const row = document.createElement('p');
            const link = document.createElement('a');
            link.href = `https://github.com/haguchikarasu/lirmena/commit/${entry.sha}`;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = entry.version;
            row.append(link, document.createTextNode(` ${entry.date} ${entry.change}`));
            changelogArea.appendChild(row);
        }
    }

    titleScreenEl.style.backgroundImage = img ? `url('img/titlecard/${img}')` : '';
    titleScreenEl.replaceChildren(header, changelogArea);

    mainContainerEl.hidden = true;
    titleScreenEl.hidden = false;
}

// エリアCに本文を生成・差し替えし、#title-screen を非表示にして #main-container を表示する。
// - scene.content を TextNode[] にキャストして変換する
// - scrollLeft が undefined なら境界位置、数値なら指定位置に復元
// renderScene(scene: Scene, scrollLeft?: number): void
export function renderScene(scene: Scene, scrollLeft?: number): void {
    sceneContentEl.replaceChildren(...buildNodes(scene.content as TextNode[]));

    titleScreenEl.hidden = true;
    mainContainerEl.hidden = false;
    sceneContentEl.hidden = false;
    _applyScroll(sceneContentEl, scrollLeft);
}

// scrollLeft が undefined なら境界スクロール、数値なら指定位置に復元
// _applyScroll(el: HTMLElement, scrollLeft?: number): void
function _applyScroll(el: HTMLElement, scrollLeft?: number): void {
    if (scrollLeft !== undefined) {
        mainContainerEl.scrollLeft = scrollLeft;
    } else {
        el.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
}

// TextNode[] を <p> ベースの DOM Node[] に変換する
// - br は <p> の境界、blank は <p> の境界＋<br>
// buildNodes(nodes: TextNode[]): Node[]
function buildNodes(nodes: TextNode[]): Node[] {
    const result: Node[] = [];
    let p = document.createElement('p');

    function flushPara(): void {
        result.push(p);
        p = document.createElement('p');
    }

    for (const node of nodes) {
        switch (node.type) {
            case 'text':
                p.appendChild(document.createTextNode(node.value));
                break;
            case 'ruby': {
                const ruby = document.createElement('ruby');
                const rt = document.createElement('rt');
                rt.textContent = node.rt;
                ruby.append(document.createTextNode(node.base), rt);
                p.appendChild(ruby);
                break;
            }
            case 'tcy': {
                const span = document.createElement('span');
                span.style.textCombineUpright = 'all';
                span.textContent = node.value;
                p.appendChild(span);
                break;
            }
            case 'br':
                flushPara();
                break;
            case 'blank':
                flushPara();
                result.push(document.createElement('br'));
                break;
        }
    }
    result.push(p);
    return result;
}
