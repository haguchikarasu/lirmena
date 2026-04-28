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
 *       { type: "ruby" }  → <ruby><rb>base</rb><rt>rt</rt></ruby>
 *       { type: "tcy"  }  → <span style="text-combine-upright: all">value</span>
 *       { type: "br"   }  → <br>
 */

import type { Episode, EpisodeSection, Scene } from "./types";
import type { TextNode } from "./parser";

// エリアBにタイトルカードを生成・差し替えする
// - sec.id === 1 のとき ep.title を表示
// - sec.id >= 2 のとき sec.id を縦中横（text-combine-upright）で表示
// renderTitleCard(ep: Episode, sec: EpisodeSection): void

// エリアCに本文を生成・差し替えする
// - scene.content を TextNode[] にキャストして変換する
// - 改行・空白を保持する
// renderScene(scene: Scene): void