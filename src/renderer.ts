/*
 * renderer.ts
 * 責務: Scene → DOM 生成（エリアC 本文）、タイトル画面（#title-screen）の動的部分の更新
 * export: renderTitleScreen(epTitle, changelog, epId), renderScene()
 * 依存: parser.ts（TextNode 型）、types.ts（ChangelogEntry 型）
 *
 * Scene.content は TextNode[] として実装する（types.ts 側は unknown のまま。本モジュールでキャスト）。
 *
 * タイトル画面（#title-screen）：
 *   - 静的構造は contents.html に記述済み
 *   - #main-container を非表示にして #title-screen を表示する
 *   - 動的更新：ep タイトルのテキスト、背景画像、.title-screen-changelog の中身
 *   - DOM 構造（静的）：
 *       #title-screen-header
 *         #title-screen-ep-title（ep タイトル）
 *         #btn-title-enter  : 本文に入るボタン
 *         #btn-title-prev   : 前 ep へ戻るボタン
 *         #btn-title-index  : 目次に戻るボタン（<a> タグ）
 *       #title-screen-changelog（ChangelogEntry[] または「更新履歴なし」）
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

// タイトル画面の動的部分（ep タイトル・背景画像・changelog）を更新し、#main-container を非表示にする。
// 静的構造（ボタン・リンク等）は contents.html に記述済み。
// nav.ts が querySelector でボタンを取得してイベントを登録する。
// ep[XX]/title.png を背景画像として全面表示する。ファイルが存在しない場合は黒背景のみ。
// renderTitleScreen(epTitle: string, changelog: ChangelogEntry[], epId: number): void
export function renderTitleScreen(epTitle: string, changelog: ChangelogEntry[], epId: number): void {
    const titleEl = document.getElementById('title-screen-ep-title')!;
    titleEl.textContent = epTitle;

    const changelogArea = titleScreenEl.querySelector<HTMLElement>('#title-screen-changelog')!;
    if (changelog.length === 0) {
        changelogArea.replaceChildren(document.createTextNode('更新履歴なし'));
    } else {
        const rows = changelog.map(entry => {
            const row = document.createElement('p');
            row.className = 'changelog-entry';

            const versionSpan = document.createElement('span');
            versionSpan.className = 'changelog-version';
            const link = document.createElement('a');
            link.href = `https://github.com/haguchikarasu/lirmena/commit/${entry.sha}`;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = `v${entry.version}`;
            versionSpan.append(link);

            const dateSpan = document.createElement('span');
            dateSpan.className = 'changelog-date';
            dateSpan.textContent = entry.date;

            const changeSpan = document.createElement('span');
            changeSpan.className = 'changelog-change';
            changeSpan.textContent = entry.change;

            row.append(dateSpan, versionSpan, changeSpan);
            return row;
        });
        changelogArea.replaceChildren(...rows);
    }

    const titlePath = `ep${String(epId).padStart(2, '0')}/title.png`;
    titleScreenEl.style.backgroundImage = `url('${titlePath}')`;

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
