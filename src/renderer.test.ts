/*
 * renderer.test.ts
 * 対象: renderer.ts の字下げ判定（.indent クラスの付与）と、<p> の切れ目・空行の出力。
 * 期待値の出典: design/requirements/05-4-text.md（本文の書式規約）／design/modules/renderer.md。
 *   - 行頭が全角スペース（U+3000）／始め括弧類の段落は字下げしない
 *   - それ以外（地の文）は .indent を付ける。字下げ量は CSS の --paragraph-indent が持つ
 *   - 空段落には付けない
 *   - 判定は <p> を積む単一の出口（seal）で行うので、各シーンの最終段落も対象になる。
 *     parser がタグ直前シーンの末尾改行を剥がすため最終 <p> は空とは限らず、
 *     flushPara だけに判定を置くとここが素通りする（回帰防止のテストを置く）
 * renderScenes() は #main-container / #scene-content をモジュール読み込み時に掴むため直接は呼べない。
 * DOM 取得を伴わない buildNodes() / shouldIndent() を対象にする。
 */

import { describe, it, expect } from "vitest";
import { parse, type TextNode } from "./parser";
import { buildNodes, shouldIndent } from "./renderer";

// 本文を parse し、シーンごとに <p> 要素だけを取り出す（blank が出す <br> は除く）
function parasOf(text: string): HTMLParagraphElement[][] {
  return parse(text).map((scene) => {
    const nodes = buildNodes(scene.content as TextNode[]);
    return nodes.filter((n): n is HTMLParagraphElement => n.nodeName === "P");
  });
}

// 単一シーンの本文から [段落テキスト, 字下げの有無] を並べる
function indentMapOf(text: string): Array<[string, boolean]> {
  const scenes = parasOf(text);
  expect(scenes).toHaveLength(1);
  return scenes[0].map((p) => [p.textContent ?? "", p.classList.contains("indent")]);
}

describe("renderer 字下げ判定（shouldIndent）", () => {
  it("地の文の先頭文字は字下げする", () => {
    expect(shouldIndent("リ")).toBe(true);
    expect(shouldIndent("―")).toBe(true); // 行頭ダッシュも地の文
    expect(shouldIndent("t")).toBe(true);
  });

  it("始め括弧類は字下げしない（地の文か会話文かを問わず形で決める）", () => {
    for (const c of ["「", "『", "（", "〈", "《", "【", "〔", "［", "｛", "("]) {
      expect(shouldIndent(c)).toBe(false);
    }
  });

  it("全角スペースは字下げしない（原稿が自前でインデント済みの段落）", () => {
    expect(shouldIndent("　")).toBe(false);
  });

  it("空段落（先頭文字なし）は字下げしない", () => {
    expect(shouldIndent(undefined)).toBe(false);
  });
});

describe("renderer <p> への .indent 付与", () => {
  it("地の文に付き、会話文・心中には付かない", () => {
    expect(indentMapOf("リッカは歩いた。\n「やあ」\n（そうか）\n答えた。")).toEqual([
      ["リッカは歩いた。", true],
      ["「やあ」", false],
      ["（そうか）", false],
      ["答えた。", true],
    ]);
  });

  it("引用句で始まる地の文にも付かない（行頭の形で決める）", () => {
    expect(indentMapOf("答えた。\n『やはり』とまではいかない。")).toEqual([
      ["答えた。", true],
      ["『やはり』とまではいかない。", false],
    ]);
  });

  it("全角スペースで始まる段落（ブロック引用）には付かない", () => {
    expect(indentMapOf("その文はこうだ。\n　　talbart lirmenatir.\n読み終えた。")).toEqual([
      ["その文はこうだ。", true],
      ["　　talbart lirmenatir.", false],
      ["読み終えた。", true],
    ]);
  });

  it("ルビ・傍点・縦中横が先頭でも親文字の先頭で判定する", () => {
    // 段落テキストも併せて検証する。真偽値だけ見ると、記法が壊れて平文化したとき
    // 先頭が | や ^ になり（どちらも NO_INDENT_HEADS に無い）true のまま通ってしまうため。
    expect(indentMapOf("|大海原《マルブ》は遠い。")).toEqual([["大海原マルブは遠い。", true]]);
    expect(indentMapOf("《《強調》》して言った。")).toEqual([["強•調•して言った。", true]]);
    expect(indentMapOf("^12^日の朝だった。")).toEqual([["12日の朝だった。", true]]);
  });

  it("字下げしない段落にはクラスを一切付けない", () => {
    const paras = parasOf("「やあ」\n　　引用。\n地の文。")[0];
    expect(paras.map((p) => p.className)).toEqual(["", "", "indent"]);
  });

  it("全角スペース1文字だけの段落にも付かない（実データに存在する）", () => {
    const paras = parasOf("前。\n　\n後。")[0];
    expect(paras.map((p) => [p.textContent, p.className])).toEqual([
      ["前。", "indent"],
      ["　", ""],
      ["後。", "indent"],
    ]);
  });
});

describe("renderer シーン最終段落の字下げ（判定の出口が1つであること）", () => {
  it("タグ直前の段落にも付く（parser が末尾改行を剥がすので最終 <p> は非空）", () => {
    const scenes = parasOf("最初の段落。\nタグ直前の段落。\n@@BG:a.avif@@\n次のシーン。");
    expect(scenes).toHaveLength(2);

    const firstLast = scenes[0][scenes[0].length - 1];
    expect(firstLast.textContent).toBe("タグ直前の段落。");
    expect(firstLast.classList.contains("indent")).toBe(true);
  });

  it("末尾に改行のない本文でも最終段落に付く", () => {
    const paras = parasOf("前の段落。\n最後の段落。")[0];
    const last = paras[paras.length - 1];
    expect(last.textContent).toBe("最後の段落。");
    expect(last.classList.contains("indent")).toBe(true);
  });

  it("タグ直後に生じる空段落には付かない", () => {
    const paras = parasOf("@@BG:a.avif@@\n\n本文。")[0];
    expect(paras[0].textContent).toBe("");
    expect(paras[0].classList.contains("indent")).toBe(false);
  });
});

describe("renderer 段落の切れ目（従来どおり）", () => {
  it("改行1つは <p> の境界だけを作る", () => {
    const nodes = buildNodes(parse("前。\n後。")[0].content as TextNode[]);
    expect(nodes.map((n) => n.nodeName)).toEqual(["P", "P"]);
  });

  it("空行（\\n\\n）は <p> の境界に加えて <br> を出す。<br> にクラスは付かず次の段落は通常どおり判定される", () => {
    const nodes = buildNodes(parse("前。\n\n後。")[0].content as TextNode[]);
    expect(nodes.map((n) => n.nodeName)).toEqual(["P", "BR", "P"]);
    expect(nodes.map((n) => (n as HTMLElement).className)).toEqual(["indent", "", "indent"]);
  });
});
