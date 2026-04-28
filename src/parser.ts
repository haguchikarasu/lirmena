/*
 * parser.ts
 * 責務: 本文テキスト → Scene[] 変換（背景遷移タグ分割・ルビ・縦中横の中間表現化）
 * export: TextNode, parse()
 * 依存: なし
 *
 * TextNode の種別:
 *   { type: "text";  value: string }             平文
 *   { type: "ruby";  base: string; rt: string }  |漢字《かんじ》
 *   { type: "tcy";   value: string }             ^17^ （縦中横）
 *   { type: "br" }                               改行
 *
 * Scene.content は TextNode[] として確定する。
 * types.ts 側は unknown のまま。renderer.ts は TextNode[] にキャストして使う。
 */

// export type TextNode =
//   | { type: "text"; value: string }
//   | { type: "ruby"; base: string; rt: string }
//   | { type: "tcy";  value: string }
//   | { type: "br" }

// 本文テキスト全体を受け取り Scene[] を返す
// - @@BG:file@@ でシーン分割・bgFile にファイル名のみ（パスなし）を格納
// - @@BG@@ は bgFile: null（直前シーンの画像を引き継ぐ指示）
// - lineCount は @@BG タグを除いた改行数
// - タグ直後の改行1つは本文に含めない
// parse(text: string): Scene[]