/*
 * renderer.test.ts
 * 対象: renderer.ts の字下げ判定（.indent クラスの付与）と、<p> の切れ目・空行の出力、
 *       二重引用符 “ ” の展開（<span.dq-h> と <span.dq-v> の対）。
 * 期待値の出典: design/requirements/05-4-text.md（本文の書式規約・「二重引用符の縦書き表示」）／design/modules/renderer.md。
 *   - 行頭が全角スペース（U+3000）／始め括弧類（“ 〝 を含む）の段落は字下げしない
 *   - それ以外（地の文）は .indent を付ける。字下げ量は CSS の --paragraph-indent が持つ
 *   - 空段落には付けない
 *   - 判定は <p> を積む単一の出口（seal）で行うので、各シーンの最終段落も対象になる。
 *     parser がタグ直前シーンの末尾改行を剥がすため最終 <p> は空とは限らず、
 *     flushPara だけに判定を置くとここが素通りする（回帰防止のテストを置く）
 *   - “ ” は横書きでそのまま・縦書きで 〝 〟 に見える。出し分けは CSS なので、ここでは DOM の形
 *     （対の順序・展開する範囲）と、CSS の出し分けを DOM 上で再現した「見える字」を検証する
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

// 単一シーン・単一段落の本文から、その <p> を取り出す
function onlyParaOf(text: string): HTMLParagraphElement {
  const scenes = parasOf(text);
  expect(scenes).toHaveLength(1);
  expect(scenes[0]).toHaveLength(1);
  return scenes[0][0];
}

// 書字方向ごとに読者に見える本文の字。jsdom は CSS を当てないので、_layout.css の出し分け
// （横書き＝.dq-v を隠す／縦書き＝.dq-h を隠す）を DOM 上で再現する。rt（ルビの読み・傍点）も除く。
function visibleText(el: Element, mode: "horizontal" | "vertical"): string {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll(mode === "vertical" ? ".dq-h, rt" : ".dq-v, rt").forEach((n) => n.remove());
  return c.textContent ?? "";
}

describe("renderer 字下げ判定（shouldIndent）", () => {
  it("地の文の先頭文字は字下げする", () => {
    expect(shouldIndent("リ")).toBe(true);
    expect(shouldIndent("―")).toBe(true); // 行頭ダッシュも地の文
    expect(shouldIndent("t")).toBe(true);
  });

  it("始め括弧類は字下げしない（地の文か会話文かを問わず形で決める）", () => {
    for (const c of ["「", "『", "（", "〈", "《", "【", "〔", "［", "｛", "(", "“", "〝"]) {
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

  it("“ や 〝 で始まる段落にも付かない（書字方向に依らず原稿の字で判定する）", () => {
    const paras = parasOf("答えた。\n“雇い主”と呼んだ。\n〝雇い主〟と呼んだ。")[0];
    expect(paras.map((p) => [[...(p.textContent ?? "")][0], p.className])).toEqual([
      ["答", "indent"],
      ["“", ""], // textContent の先頭は dq-h（原稿の字）。dq-v の 〝 は 2 文字目
      ["〝", ""],
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

describe("renderer 二重引用符の書字方向別表示（“ ” ⇔ 〝 〟）", () => {
  it("横書きでは “ ” のまま、縦書きでは 〝 〟 に見える", () => {
    const p = onlyParaOf("「理由は簡単だ。“雇い主”」");
    expect(visibleText(p, "horizontal")).toBe("「理由は簡単だ。“雇い主”」");
    expect(visibleText(p, "vertical")).toBe("「理由は簡単だ。〝雇い主〟」");
  });

  it("各引用符は dq-h → dq-v の順の対で出る（textContent は原稿の字から始まる）", () => {
    const p = onlyParaOf("“雇い主”");
    expect([...p.querySelectorAll("span")].map((s) => [s.className, s.textContent])).toEqual([
      ["dq-h", "“"], ["dq-v", "〝"], ["dq-h", "”"], ["dq-v", "〟"],
    ]);
  });

  it("“ ” を含まない段落は従来どおりテキストノード 1 つ", () => {
    const p = onlyParaOf("リッカは歩いた。");
    expect(p.childNodes).toHaveLength(1);
    expect(p.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("連続・端の引用符でも空のテキストノードを作らない", () => {
    const p = onlyParaOf("“”“a”");
    expect([...p.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue === "")).toBe(false);
    expect(visibleText(p, "vertical")).toBe("〝〟〝a〟");
  });

  it("ルビの親文字の中でも出し分け、rt は ruby の最後の子のまま", () => {
    const ruby = onlyParaOf("|“雇い主”《やといぬし》と呼ぶ。").querySelector("ruby")!;
    expect(ruby.lastElementChild?.tagName).toBe("RT");
    expect(ruby.lastElementChild?.textContent).toBe("やといぬし");
    expect(visibleText(ruby, "horizontal")).toBe("“雇い主”");
    expect(visibleText(ruby, "vertical")).toBe("〝雇い主〟");
  });

  it("傍点の各字でも出し分け、黒丸は字数ぶん（引用符にも付く＝ほかの約物と同じ）", () => {
    const p = onlyParaOf("《《“強”》》");
    const rubies = [...p.querySelectorAll("em.bouten > ruby")];
    expect(rubies.map((r) => r.lastElementChild?.textContent)).toEqual(["•", "•", "•"]);
    expect(visibleText(p, "vertical")).toBe("〝強〟");
  });

  it("縦中横の中は変換しない", () => {
    const tcy = onlyParaOf("^“1”^日").querySelector(".tcy")!;
    expect(tcy.textContent).toBe("“1”");
    expect(tcy.querySelector(".dq-h, .dq-v")).toBeNull();
  });

  it("原稿に直接書いた 〝 〟 は変換しない（逆方向の変換はしない）", () => {
    const p = onlyParaOf("〝雇い主〟");
    expect(p.querySelector(".dq-h, .dq-v")).toBeNull();
    expect(p.textContent).toBe("〝雇い主〟");
  });
});
