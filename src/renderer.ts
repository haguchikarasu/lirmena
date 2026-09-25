/*
 * renderer.ts
 * 責務: Scene[] → 本文 DOM 生成（エリアC）。現在 sec の全シーンを連続レイアウトで一括描画する。
 * export: renderScenes(scenes: Scene[]): void
 *         buildNodes(nodes: TextNode[]): Node[]（テスト用に公開。DOM 取得を伴わない純粋な組み立て）
 *         shouldIndent(first: string | undefined): boolean（テスト用に公開）
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
 *       { type: "emphasis" }  → <em class="bouten"> 内に1文字ずつ <ruby>字<rt>•</rt></ruby>（• = U+2022）
 *                               （字の右に小さい黒丸。text-emphasis は列幅を広げ・サイズ制御不可のため不使用）
 *       { type: "tcy"      }  → <span class="tcy">value</span>（text-combine-upright）
 *       { type: "br"       }  → <p> の境界（\n 1つ → </p><p>）
 *       { type: "blank"    }  → <p> の境界＋空行（\n\n → </p><br><p>）
 *   - text・ruby の親文字・傍点の各字は appendText() を通す。二重引用符 “ ” だけを
 *     <span class="dq-h">“</span><span class="dq-v">〝</span> の対に展開し、どちらを見せるかは
 *     CSS（_layout.css）が html[data-writing-mode] で決める（縦書き＝〝 〟。要件 05-4）。
 *     本モジュールは書字方向を知らない（縦中横 .tcy と同じ分担）。縦中横の中とルビの読み（rt）は対象外
 *   - 各 <p> は先頭文字を見て字下げクラス .indent を付ける（要件 05-4）。字下げは本文テキストに
 *     書かず、CSS の text-indent（--paragraph-indent）が与える。段落間の空行と排他で切り替わる
 *     ため、settings が --paragraph-margin と --paragraph-indent を必ずセットで駆動する（要件 06-4）
 *
 * タイトル画面の描画は担当しない（title.ts の責務）。初期スクロール位置の決定も担当しない（main.ts の責務）。
 */

import type { Scene } from "./types";
import type { TextNode } from "./parser";

// 字下げしない段落の先頭文字（要件 05-4）。意味（地の文か会話文か）ではなく形（行頭の文字）で決める。
//   U+3000     … 原稿が自前でインデント済みの段落（ブロック引用）。表示側で重ねない
//   始め括弧類 … 行頭が始め括弧なら、地の文か会話文かを問わず字下げしない
//                “ と 〝 も JLREQ の始め括弧類（cl-01）。原稿の字でも縦書きの字でも同じ判定になるよう両方置く
const NO_INDENT_HEADS = new Set(['　', '「', '『', '（', '〈', '《', '【', '〔', '［', '｛', '(', '“', '〝']);

// 縦書きで差し替える二重引用符（要件 05-4）。原稿の字 → 縦書きの字。
// 閉じは縦組用の U+301F 〟（U+301E 〞 は横組用なので使わない）。
const DQ_VERTICAL: ReadonlyMap<string, string> = new Map([['“', '〝'], ['”', '〟']]);
// 引用符で分割し、引用符自身も結果に残す（キャプチャ付き）。g を付けない＝test() が状態を持たない
const DQ_SPLIT = new RegExp(`([${[...DQ_VERTICAL.keys()].join('')}])`);

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

// 段落の先頭文字から字下げの要否を返す。空段落（first === undefined）は字下げしない。
// 呼び出し側はコードユニットではなく1文字を渡すこと（サロゲートペアで孤立片を渡さないため）。
// shouldIndent(first: string | undefined): boolean
export function shouldIndent(first: string | undefined): boolean {
    return first !== undefined && !NO_INDENT_HEADS.has(first);
}

// 本文の文字列を parent に足す。二重引用符（DQ_VERTICAL のキー）だけは
// <span class="dq-h">原稿の字</span><span class="dq-v">縦書きの字</span> の対に展開する。
// - 対は dq-h → dq-v の順に置き、textContent が原稿の字から始まるようにする（seal() の字下げ判定もこれを見るが、
//   判定表は “ と 〝 を同じ扱いにしてあるので、今は順序で字下げの結果は変わらない）
// - 引用符を含まない文字列はテキストノード 1 つを足すだけ（従来と同じ DOM）
// - aria-hidden も hidden 属性も付けない。読み上げ・コピー・ページ内検索は display の出し分けで見えている字に揃う
//   （aria-hidden は縦書きで見えている 〝 まで読ませなくし、hidden は _base.css の !important に負けて表示に戻せない）
// appendText(parent: Element, s: string): void
function appendText(parent: Element, s: string): void {
    if (!DQ_SPLIT.test(s)) {
        parent.appendChild(document.createTextNode(s));
        return;
    }
    for (const part of s.split(DQ_SPLIT)) {
        if (part === '') continue; // 端・連続の引用符で split が返す空文字
        const vertical = DQ_VERTICAL.get(part);
        if (vertical === undefined) {
            parent.appendChild(document.createTextNode(part));
            continue;
        }
        const h = document.createElement('span');
        h.className = 'dq-h';
        h.textContent = part;
        const v = document.createElement('span');
        v.className = 'dq-v';
        v.textContent = vertical;
        parent.append(h, v);
    }
}

// TextNode[] を <p> ベースの DOM Node[] に変換する
// - br は <p> の境界、blank は <p> の境界＋<br>
// - <p> は seal() を通してから result に積む（字下げクラスの付与点を1箇所に保つ）
// buildNodes(nodes: TextNode[]): Node[]
export function buildNodes(nodes: TextNode[]): Node[] {
    const result: Node[] = [];
    let p = document.createElement('p');

    // 段落を確定する唯一の出口。字下げ判定はここでだけ行う。
    // ループ末尾の push もここを通すこと（通さないと各シーンの最終段落が判定を素通りする。
    // parser がタグ直前シーンの末尾改行を剥がすため、最終 <p> は空とは限らない）。
    function seal(el: HTMLParagraphElement): HTMLParagraphElement {
        if (shouldIndent([...el.textContent ?? ''][0])) el.classList.add('indent');
        return el;
    }

    function flushPara(): void {
        result.push(seal(p));
        p = document.createElement('p');
    }

    for (const node of nodes) {
        switch (node.type) {
            case 'text':
                appendText(p, node.value);
                break;
            case 'ruby': {
                const ruby = document.createElement('ruby');
                const rt = document.createElement('rt');
                rt.textContent = node.rt;
                appendText(ruby, node.base);
                ruby.appendChild(rt);
                p.appendChild(ruby);
                break;
            }
            case 'emphasis': {
                // 傍点：1文字ずつ <ruby>字<rt>•</rt></ruby> にして字の右へ小さい黒丸を載せる。
                // 既存ルビと同じ字送りに揃い、text-emphasis のような列幅増加を避けられる。
                // rt の • は装飾なので aria-hidden で読み上げから除外し、<em> で強調の意味だけ残す。
                const em = document.createElement('em');
                em.className = 'bouten';
                for (const ch of [...node.value]) {
                    const ruby = document.createElement('ruby');
                    const rt = document.createElement('rt');
                    rt.textContent = '•'; // • U+2022 BULLET
                    rt.setAttribute('aria-hidden', 'true');
                    appendText(ruby, ch);
                    ruby.appendChild(rt);
                    em.appendChild(ruby);
                }
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
    result.push(seal(p));
    return result;
}
