/*
 * parser.test.ts
 * 対象: parser.ts の傍点（《《…》》）パースと、ルビ・傍点・リテラルの曖昧性解消。
 * 期待値の出典: requirements/05-5-bouten.html ／ module-responsibilities.md（parser.ts 責務）。
 *   - 《《対象》》 → emphasis（| 不要・二重ギュメ）
 *   - |親文字《ルビ》 → ruby（先頭 | 必須・単一ギュメ）
 *   - 単独の 《 》 → 本文中のリテラル文字（text へフォールバック）
 *   - 平文の取り込みから 《 を除外し、二重ギュメの傍点を平文より優先してマッチする
 * tokenize は非公開のため、@@BG@@ タグなしの parse()（＝単一シーン）の content を検証する。
 */

import { describe, it, expect } from "vitest";
import { parse, type TextNode } from "./parser";

// @@BG タグを含まない本文を tokenize 結果（TextNode[]）に変換する
function nodesOf(text: string): TextNode[] {
  const scenes = parse(text);
  expect(scenes).toHaveLength(1);
  return scenes[0].content as TextNode[];
}

describe("parser 傍点（emphasis）", () => {
  it("《《対象》》 を emphasis ノードにする", () => {
    expect(nodesOf("《《対象》》")).toEqual([{ type: "emphasis", value: "対象" }]);
  });

  it("前後の平文と傍点を分離する（平文から 《 を除外）", () => {
    expect(nodesOf("前《《強調》》後")).toEqual([
      { type: "text", value: "前" },
      { type: "emphasis", value: "強調" },
      { type: "text", value: "後" },
    ]);
  });

  it("ルビ（|親文字《ルビ》）は傍点ではなく ruby になる", () => {
    expect(nodesOf("|親文字《ルビ》")).toEqual([
      { type: "ruby", base: "親文字", rt: "ルビ" },
    ]);
  });

  it("同一行のルビと傍点を両立させる", () => {
    expect(nodesOf("|光輝《リルム》の《《刃》》")).toEqual([
      { type: "ruby", base: "光輝", rt: "リルム" },
      { type: "text", value: "の" },
      { type: "emphasis", value: "刃" },
    ]);
  });

  it("単独の 《 はリテラル文字として平文に取り込む", () => {
    expect(nodesOf("あ《い")).toEqual([{ type: "text", value: "あ《い" }]);
  });

  it("単独の 》 はリテラル文字として平文に取り込む", () => {
    expect(nodesOf("あ》い")).toEqual([{ type: "text", value: "あ》い" }]);
  });

  it("閉じていない二重ギュメはリテラルにフォールバックする", () => {
    expect(nodesOf("《《未閉じ")).toEqual([{ type: "text", value: "《《未閉じ" }]);
  });

  it("傍点は行数（lineCount）に算入しない", () => {
    const scenes = parse("《《あ》》\n《《い》》");
    expect(scenes[0].lineCount).toBe(1); // \n 1つ分のみ
  });
});
