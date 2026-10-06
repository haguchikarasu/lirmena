/*
 * characters.test.ts
 * characters.ts の仕様駆動テスト（純関数 resolveCharacters のみ。ポップアップの開閉は e2e/characters-popup.spec.ts）。
 * IF: resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[]
 *
 * 網羅する観点：
 *   - Stage 1〜4 は同じ番号の巻の登録を返す
 *   - Stage 5（物語完結）は最終巻（vol4）の登録を返す
 *   - 登録が昇順でなくても規則（巻番号が Stage 以下で最大）どおりに引く
 *   - 該当が無ければ空配列
 */

import { describe, expect, it } from 'vitest';
import { resolveCharacters } from './characters';
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
