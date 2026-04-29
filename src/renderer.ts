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
 *   - TextNode[] を走査し以下のように変換する：
 *       { type: "text" }  → テキストノード（空白・連続スペースを保持）
 *       { type: "ruby" }  → <ruby>base<rt>rt</rt></ruby>
 *       { type: "tcy"  }  → <span style="text-combine-upright: all">value</span>
 *       { type: "br"   }  → <br>
 *
 * attachWheelFix(el: HTMLElement): void
 *   - writing-mode: vertical-rl の RTL scrollLeft 補正
 *   - モジュール初期化時に #title-card・#scene-content へ各1回登録する
 *   - replaceChildren() は要素自体を保持するため render 関数内ではなくここで呼ぶ
 *
 * attachScrollVisibility(el, btnPrev, btnNext, immediate): void
 *   - スクロール位置を監視し #btn-prev / #btn-next に .btn-visible を付与する
 *   - DOM 差し替え後に毎回呼ぶことでリスナーが付け直される
 */

import type { Episode, EpisodeSection, Scene } from "./types";
import type { TextNode } from "./parser";

const titleCardEl = document.querySelector<HTMLElement>("#title-card")!;
const sceneContentEl = document.querySelector<HTMLElement>("#scene-content")!;
attachWheelFix(titleCardEl);
attachWheelFix(sceneContentEl);

// エリアBにタイトルカードを生成・差し替えし、エリアCを非表示にする
// - sec.id === 1 のとき ep.title を表示
// - sec.id >= 2 のとき sec.id を縦中横（text-combine-upright）で表示
// renderTitleCard(ep: Episode, sec: EpisodeSection): void
export function renderTitleCard(ep: Episode, sec: EpisodeSection): void {
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

  const btnPrev = document.querySelector<HTMLElement>('#btn-prev')!;
  const btnNext = document.querySelector<HTMLElement>('#btn-next')!;
  attachScrollVisibility(titleCardEl, btnPrev, btnNext, true);
}

// エリアCに本文を生成・差し替えし、エリアBを非表示にする
// - scene.content を TextNode[] にキャストして変換する
// - 改行・空白を保持する
// renderScene(scene: Scene): void
export function renderScene(scene: Scene): void {
  sceneContentEl.replaceChildren(...buildNodes(scene.content as TextNode[]));

  sceneContentEl.hidden = false;
  titleCardEl.hidden = true;

  const btnPrev = document.querySelector<HTMLElement>('#btn-prev')!;
  const btnNext = document.querySelector<HTMLElement>('#btn-next')!;
  attachScrollVisibility(sceneContentEl, btnPrev, btnNext, false);
}

// wheel イベントで deltaY を RTL scrollLeft に変換する（vertical-rl 縦書き補正）
// el: スクロール対象要素（#scene-content または #title-card）
function attachWheelFix(el: HTMLElement): void {
  el.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    el.scrollLeft -= e.deltaY; // deltaY正 = 下スクロール = 左へ（本文を進む）
  }, { passive: false });
}

// スクロール位置を監視して #btn-prev / #btn-next に .btn-visible をトグルする
// writing-mode: vertical-rl では scrollLeft は 0 から負方向に増える
//   先頭判定: el.scrollLeft >= -THRESHOLD
//   末尾判定: el.scrollLeft <= -(el.scrollWidth - el.clientWidth) + THRESHOLD
// 端から離れたら .btn-visible を外して再び非表示に戻す
// attachScrollVisibility(el: HTMLElement, btnPrev: HTMLElement, btnNext: HTMLElement, immediate: boolean): void
function attachScrollVisibility(
  el: HTMLElement,
  btnPrev: HTMLElement,
  btnNext: HTMLElement,
  immediate: boolean = false
): void {
  const THRESHOLD = 10;

  btnPrev.classList.remove('btn-visible');
  btnNext.classList.remove('btn-visible');

  if (immediate) {
    btnPrev.classList.add('btn-visible');
    btnNext.classList.add('btn-visible');
    return;
  }

  const update = (): void => {
    if (el.scrollWidth <= el.clientWidth) {
      btnPrev.classList.add('btn-visible');
      btnNext.classList.add('btn-visible');
      return;
    }
    // 端から離れたら非表示に戻すため toggle を使う
    btnPrev.classList.toggle('btn-visible', el.scrollLeft >= -THRESHOLD);
    btnNext.classList.toggle('btn-visible', el.scrollLeft <= -(el.scrollWidth - el.clientWidth) + THRESHOLD);
  };

  el.addEventListener('scroll', update, { passive: true });
  update();
}

// TextNode[] を DOM Node[] に変換する
// buildNodes(nodes: TextNode[]): Node[]
function buildNodes(nodes: TextNode[]): Node[] {
  return nodes.map((node) => {
    switch (node.type) {
      case "text": {
        return document.createTextNode(node.value);
      }
      case "ruby": {
        const ruby = document.createElement("ruby");
        const rt = document.createElement("rt");
        rt.textContent = node.rt;
        ruby.append(document.createTextNode(node.base), rt);
        return ruby;
      }
      case "tcy": {
        const span = document.createElement("span");
        span.style.textCombineUpright = "all";
        span.textContent = node.value;
        return span;
      }
      case "br": {
        return document.createElement("br");
      }
    }
  });
}
