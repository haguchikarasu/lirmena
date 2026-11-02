// @vitest-environment node
/*
 * core/chara.test.ts
 * core/chara.ts（人物の画像の置き場所とファイル名の規約）の仕様駆動テスト。
 * IF: charaPath(file: string): string / faceImage(image: string): string
 */

import { describe, expect, it } from 'vitest';
import { charaPath, faceImage } from './chara';

describe('core/chara — 人物の画像の規約', () => {
    it('置き場所は public の chara/ の下', () => {
        expect(charaPath('vol1_リッカ.avif')).toBe('chara/vol1_リッカ.avif');
    });

    it('顔は全身の拡張子の前に -face を足したもの（tool/chara-crop と同じ決まり）', () => {
        expect(faceImage('vol1_リッカ.avif')).toBe('vol1_リッカ-face.avif');
        expect(charaPath(faceImage('vol2_a.b.webp'))).toBe('chara/vol2_a.b-face.webp');
    });
});
