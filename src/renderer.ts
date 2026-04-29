/*
 * renderer.ts
 * 責務: Scene → DOM 生成（エリアB タイトルカード・エリアC 本文）。ルビ・縦中横の最終変換
 * export: renderTitleCard(), renderScene()
 * 依存: parser.ts（TextNode 型）
 *
 * Scene.content は TextNode[] として実装する（types.ts 側は unknown のまま。本モジュールでキャスト）。
 *
 * エリアB（タイトルカード）：
 *   - sec.id === 1 のとき ep.title を表示する
 *   - sec.id >= 2 のとき sec.id を縦中横で表示する
 *   - contents.html のタイトルカード要素を querySelector で取得し差し替える
 *
 * エリアC（本文）：
 *   - 既存の本文コンテナ要素の内容を差し替える
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

import type { Episode, EpisodeSection, Scene } from "./types";
import type { TextNode } from "./parser";

const titleCardEl = document.querySelector<HTMLElement>("#title-card")!;
const sceneContentEl = document.querySelector<HTMLElement>("#scene-content")!;

// エリアBにタイトルカードを生成・差し替えし、エリアCを非表示にする
// - sec.id === 1 のとき ep.title を表示
// - sec.id >= 2 のとき sec.id を縦中横（text-combine-upright）で表示
// - scrollLeft が undefined なら境界位置、数値なら指定位置に復元
// renderTitleCard(ep: Episode, sec: EpisodeSection, scrollLeft?: number): void
export function renderTitleCard(ep: Episode, sec: EpisodeSection, scrollLeft?: number): void {
  titleCardEl.replaceChildren();

  if (sec.id === 1) {
    titleCardEl.appendChild(document.createTextNode(ep.title));
  } else {
    const span = document.createElement("span");
    span.style.textCombineUpright = "all";
    span.textContent = String(sec.id);
    titleCardEl.appendChild(span);
  }

  titleCardEl.hidden = false;
  sceneContentEl.hidden = true;
  _applyScroll(titleCardEl, scrollLeft);
}

// エリアCに本文を生成・差し替えし、エリアBを非表示にする
// - scene.content を TextNode[] にキャストして変換する
// - 改行・空白を保持する
// - scrollLeft が undefined なら境界位置、数値なら指定位置に復元
// renderScene(scene: Scene, scrollLeft?: number): void
export function renderScene(scene: Scene, scrollLeft?: number): void {
  sceneContentEl.replaceChildren(...buildNodes(scene.content as TextNode[]));

  sceneContentEl.hidden = false;
  titleCardEl.hidden = true;
  _applyScroll(sceneContentEl, scrollLeft);
}

// scrollLeft が undefined なら境界スクロール、数値なら指定位置に復元
// _applyScroll(el: HTMLElement, scrollLeft?: number): void
function _applyScroll(el: HTMLElement, scrollLeft?: number): void {
  if (scrollLeft !== undefined) {
    document.querySelector<HTMLElement>('#main-container')!.scrollLeft = scrollLeft;
  } else {
    el.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
}

// TextNode[] を <p> ベースの DOM Node[] に変換する
// - br は <p> の境界、blank は <p> の境界＋<br>
// buildNodes(nodes: TextNode[]): Node[]
function buildNodes(nodes: TextNode[]): Node[] {
  const result: Node[] = [];
  let p = document.createElement("p");

  function flushPara(): void {
    result.push(p);
    p = document.createElement("p");
  }

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        p.appendChild(document.createTextNode(node.value));
        break;
      case "ruby": {
        const ruby = document.createElement("ruby");
        const rt = document.createElement("rt");
        rt.textContent = node.rt;
        ruby.append(document.createTextNode(node.base), rt);
        p.appendChild(ruby);
        break;
      }
      case "tcy": {
        const span = document.createElement("span");
        span.style.textCombineUpright = "all";
        span.textContent = node.value;
        p.appendChild(span);
        break;
      }
      case "br":
        flushPara();
        break;
      case "blank":
        flushPara();
        result.push(document.createElement("br"));
        break;
    }
  }
  result.push(p);
  return result;
}
