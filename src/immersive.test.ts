/*
 * immersive.test.ts
 * 対象: immersive.ts の DOM 非依存な純関数
 *   - shouldToggleFromTap: 押下→離しの移動量・時間から「その場の軽いタップ」＝トグル発火かを判定する
 * 方針: 期待値は実装ではなく immersive.ts の IF コメント／要件 06-3（移動が小さく短い操作だけをトグルとみなし、
 *   移動の大きいスワイプ／ドラッグや長押しは無視してスクロール・選択へ委ねる）から導出する（仕様駆動）。
 *   pointer 購読・closest・クラス読み取り等の DOM 依存は jsdom 不安定のため自動化しない（CLAUDE.md §7）。
 */
import { describe, expect, it } from 'vitest';
import { shouldToggleFromTap } from './immersive';

describe('shouldToggleFromTap（タップ＝トグル発火の判定）', () => {
    it('その場の軽いタップ（移動ほぼ無し・短時間）→ true', () => {
        expect(shouldToggleFromTap({ dx: 0, dy: 0, dt: 50 })).toBe(true);
        expect(shouldToggleFromTap({ dx: 3, dy: 4, dt: 120 })).toBe(true); // 距離 5px
    });

    it('移動量が大きい（スワイプ／ドラッグ）→ false（横スクロール・パンに委ねる）', () => {
        expect(shouldToggleFromTap({ dx: 40, dy: 0, dt: 100 })).toBe(false);
        expect(shouldToggleFromTap({ dx: 0, dy: 30, dt: 100 })).toBe(false);
        expect(shouldToggleFromTap({ dx: 9, dy: 9, dt: 100 })).toBe(false); // 距離 ≈12.7px
    });

    it('長く押している（長押し）→ false（文字選択・コンテキスト操作を温存）', () => {
        expect(shouldToggleFromTap({ dx: 0, dy: 0, dt: 800 })).toBe(false);
    });

    it('時間が先に評価され、長押しは移動が小さくても false', () => {
        expect(shouldToggleFromTap({ dx: 2, dy: 2, dt: 600 })).toBe(false);
    });
});
