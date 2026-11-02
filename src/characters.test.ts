/*
 * characters.test.ts
 * characters.ts の仕様駆動テスト（純関数だけ。描画とシートの開閉は e2e/characters-popup.spec.ts）。
 * IF: resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[]
 *     availableVolumes(data: CharactersData, stage: StoryStage): number[]
 *     faceImage(image: string): string
 *
 * 網羅する観点：
 *   - Stage 1〜4 は同じ番号の巻の登録を返す
 *   - Stage 5（物語完結）は最終巻（vol4）の登録を返す
 *   - 登録が昇順でなくても規則（巻番号が Stage 以下で最大）どおりに引く
 *   - 該当が無ければ空配列
 *   - 「何巻時点の紹介か」の選択肢は Stage までの登録のある巻を小さい順に（最後が resolveCharacters の巻）
 *   - 顔の画像名は全身の画像名の拡張子の前に -face を足したもの（tool/chara-crop と同じ決まり）
 */

import { describe, expect, it } from 'vitest';
import { availableVolumes, faceImage, resolveCharacters } from './characters';
import type { CharactersData } from './types';

// 4 巻ぶんの登録。名前に巻番号を入れて、どの巻を引いたかを見分ける。
function _fourVolumes(): CharactersData {
    return [1, 2, 3, 4].map(v => ({
        volume: v,
        characters: [{ name: `vol${v}のキャラ`, description: '', image: '' }],
    }));
}

describe('resolveCharacters — Stage から登録を引く', () => {
    it.each([1, 2, 3, 4] as const)('Stage %i は同じ番号の巻', (stage) => {
        expect(resolveCharacters(_fourVolumes(), stage).map(c => c.name)).toEqual([`vol${stage}のキャラ`]);
    });

    it('Stage 5（物語完結）は vol4', () => {
        expect(resolveCharacters(_fourVolumes(), 5).map(c => c.name)).toEqual(['vol4のキャラ']);
    });

    it('登録の並び順に依存しない', () => {
        const data = _fourVolumes().reverse();
        expect(resolveCharacters(data, 2).map(c => c.name)).toEqual(['vol2のキャラ']);
        expect(resolveCharacters(data, 5).map(c => c.name)).toEqual(['vol4のキャラ']);
    });

    it('該当が無ければ空配列', () => {
        expect(resolveCharacters([], 1)).toEqual([]);
        expect(resolveCharacters([{ volume: 2, characters: [] }], 1)).toEqual([]);
    });
});

describe('availableVolumes — 何巻時点の紹介かの選択肢', () => {
    it('Stage までの登録のある巻を小さい順に返す（先の巻は出さない）', () => {
        const data = _fourVolumes().reverse();
        expect(availableVolumes(data, 1)).toEqual([1]);
        expect(availableVolumes(data, 3)).toEqual([1, 2, 3]);
        expect(availableVolumes(data, 5)).toEqual([1, 2, 3, 4]);
    });

    it('最後の要素は resolveCharacters が選ぶ巻と一致する', () => {
        const data = _fourVolumes().filter(e => e.volume !== 3);
        const vols = availableVolumes(data, 3);
        expect(vols).toEqual([1, 2]);
        expect(resolveCharacters(data, 3).map(c => c.name)).toEqual([`vol${vols[vols.length - 1]}のキャラ`]);
    });
});

describe('faceImage — 顔の画像名', () => {
    it('拡張子の前に -face を足す', () => {
        expect(faceImage('vol1_リッカ.avif')).toBe('vol1_リッカ-face.avif');
        expect(faceImage('vol2_a.b.webp')).toBe('vol2_a.b-face.webp');
    });
});
