/*
 * parser.ts
 * 責務: 本文テキスト → Scene[] 変換（背景遷移タグ分割・ルビ・縦中横の中間表現化）
 * export: TextNode, parse()
 * 依存: types.ts (import type のみ)
 *
 * TextNode の種別:
 *   { type: "text";  value: string }             平文
 *   { type: "ruby";  base: string; rt: string }  |漢字《かんじ》
 *   { type: "tcy";   value: string }             ^17^ （縦中横）
 *   { type: "br" }                               段落区切り（\n 1つ）
 *   { type: "blank" }                            段落間空行（\n\n）
 *
 * Scene.content は TextNode[] として確定する。
 * types.ts 側は unknown のまま。renderer.ts は TextNode[] にキャストして使う。
 */

import type { Scene } from "./types";

export type TextNode =
  | { type: "text";  value: string }
  | { type: "ruby";  base: string; rt: string }
  | { type: "tcy";   value: string }
  | { type: "br" }
  | { type: "blank" };

// 本文テキスト全体を受け取り Scene[] を返す
// - @@BG:file@@ でシーン分割・bgFile にファイル名のみ（パスなし）を格納
// - @@BG:file:X%@@ の第3トークン（% を含む）を bgPositionX に格納。% を含まない場合は無視
// - @@BG@@ は bgFile: null（直前シーンの画像を引き継ぐ指示）。横位置トークンがあっても無視
// - タグより前のテキストは bgFile: null の先頭シーンとして格納
// - lineCount は @@BG タグを除いた改行数
// - タグ直後の改行1つは本文に含めない
// parse(text: string): Scene[]
export function parse(text: string): Scene[] {
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  type TagInfo = { start: number; end: number; bgFile: string | null; bgPositionX?: string };
  const tags: TagInfo[] = [];
  const tagRe = /@@BG(?::([^@]+))?@@/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src)) !== null) {
    let bgFile: string | null = null;
    let bgPositionX: string | undefined;
    if (m[1] !== undefined) {
      const tokens = m[1].split(":");
      bgFile = tokens[0].length > 0 ? tokens[0] : null;
      const posToken = tokens[1];
      if (bgFile !== null && posToken !== undefined && posToken.includes("%")) {
        bgPositionX = posToken;
      }
    }
    tags.push({ start: m.index, end: m.index + m[0].length, bgFile, bgPositionX });
  }

  const segments: Array<{ bgFile: string | null; bgPositionX?: string; raw: string }> = [];

  if (tags.length === 0) {
    segments.push({ bgFile: null, raw: src });
  } else {
    // 最初のタグより前のテキスト（bgFile なし）
    segments.push({ bgFile: null, raw: src.slice(0, tags[0].start) });

    for (let i = 0; i < tags.length; i++) {
      let start = tags[i].end;
      if (src[start] === "\n") start++;  // タグ直後の改行1つを除去
      const end = i + 1 < tags.length ? tags[i + 1].start : src.length;
      segments.push({ bgFile: tags[i].bgFile, bgPositionX: tags[i].bgPositionX, raw: src.slice(start, end) });
    }
  }

  return segments.map(({ bgFile, bgPositionX, raw }) => {
    const content = tokenize(raw);
    const lineCount = content.reduce((acc, n) => acc + (n.type === "br" ? 1 : n.type === "blank" ? 2 : 0), 0);
    return { bgFile, bgPositionX, lineCount, content };
  });
}

// raw テキストを TextNode[] に変換する
// - |base《rt》 → ruby ノード
// - ^value^ → tcy ノード
// - \n\n → blank ノード（段落間空行）
// - \n → br ノード（段落区切り）
// - それ以外 → text ノード（隣接するものはマージ）
// tokenize(raw: string): TextNode[]
function tokenize(raw: string): TextNode[] {
  const nodes: TextNode[] = [];
  // 優先順: ruby → tcy → blank(\n\n) → br(\n) → 平文バッチ → 単独の | ^
  const re = /\|([^《\n]+)《([^》\n]+)》|\^([^^]+)\^|\n\n|\n|[^|^\n]+|[|^]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) {
      nodes.push({ type: "ruby", base: m[1], rt: m[2] });
    } else if (m[3] !== undefined) {
      nodes.push({ type: "tcy", value: m[3] });
    } else if (m[0] === "\n\n") {
      nodes.push({ type: "blank" });
    } else if (m[0] === "\n") {
      nodes.push({ type: "br" });
    } else {
      // 平文：直前の text ノードにマージして隣接ノードを減らす
      const last = nodes[nodes.length - 1];
      if (last?.type === "text") {
        last.value += m[0];
      } else {
        nodes.push({ type: "text", value: m[0] });
      }
    }
  }
  return nodes;
}
