/*
 * renderer.ts
 * 責務: Scene[] → 本文 DOM 生成（エリアC）。現在 sec の全シーンを連続レイアウトで一括描画する。
 * export: renderScenes(scenes: Scene[]): void
 * 依存: parser.ts（TextNode 型）、types.ts（Scene 型）
 *
 * Scene.content は TextNode[] として実装する（types.ts 側は unknown のまま。本モジュールでキャスト）。
 *
 * エリアC（本文）：
 *   - 現在 sec の全シーンを #scene-content に連続レイアウトで一括生成する（シーン差し替えはしない）
 *   - 各シーンは1つの <section class="scene"> コンテナにまとめる
 *     （bg.ts が getBoundingClientRect() で境界位置を読む単位。不可視マーカーは挿入しない）
 *   - writing-mode は #scene-content から継承（vertical-rl）。各シーン／各段落はブロックとして
 *     右→左へ連続配置され、スクロールで読み進める
 *   - TextNode[] を <p> 要素に分割して変換する：
 *       { type: "text"     }  → テキストノード（空白・連続スペースを保持）
 *       { type: "ruby"     }  → <ruby>base<rt>rt</rt></ruby>
 *       { type: "emphasis" }  → <em>value</em>（text-emphasis で黒丸傍点。CSS は #scene-content em）
 *       { type: "tcy"      }  → <span class="tcy">value</span>（text-combine-upright）
 *       { type: "br"       }  → <p> の境界（\n 1つ → </p><p>）
 *       { type: "blank"    }  → <p> の境界＋空行（\n\n → </p><br><p>）
 *
 * タイトル画面の描画は担当しない（title.ts の責務）。初期スクロール位置の決定も担当しない（main.ts の責務）。
 */

import type { Scene } from "./types";
import type { TextNode } from "./parser";

const mainContainerEl = document.querySelector<HTMLElement>('#main-container')!;
const sceneContentEl = document.querySelector<HTMLElement>('#scene-content')!;

// 現在 sec の全シーンを #scene-content に連続レイアウトで一括生成し、表示する。
// renderScenes(scenes: Scene[]): void
export function renderScenes(scenes: Scene[]): void {
    const frag = document.createDocumentFragment();
    for (const scene of scenes) {
        const sceneEl = document.createElement('section');
        sceneEl.className = 'scene';
        sceneEl.append(...buildNodes(scene.content as TextNode[]));
        frag.appendChild(sceneEl);
    }
    sceneContentEl.replaceChildren(frag);

    mainContainerEl.hidden = false;
    sceneContentEl.hidden = false;
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
            case 'emphasis': {
                const em = document.createElement('em');
                em.textContent = node.value;
                p.appendChild(em);
                break;
            }
            case 'tcy': {
                const span = document.createElement('span');
                span.className = 'tcy';
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
