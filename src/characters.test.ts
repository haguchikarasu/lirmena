/*
 * characters.test.ts
 * characters.ts の仕様駆動テスト（純関数と、render の巻の選択。シートの開閉は e2e/characters-popup.spec.ts）。
 * 巻の選択を e2e でなくここで見るのは、本番のデータが 1 巻だけで e2e では選択が出ないため。
 * IF: resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[]
 *     availableVolumes(data: CharactersData, stage: StoryStage): number[]
 *     faceImage(image: string): string
 *     render(el: HTMLElement, data: CharactersData, stage: StoryStage): void
 *
 * 網羅する観点：
 *   - Stage 1〜4 は同じ番号の巻の登録を返す
 *   - Stage 5（物語完結）は最終巻（vol4）の登録を返す
 *   - 登録が昇順でなくても規則（巻番号が Stage 以下で最大）どおりに引く
 *   - 該当が無ければ空配列
 *   - 「何巻時点の紹介か」の選択肢は Stage までの登録のある巻を小さい順に（最後が resolveCharacters の巻）
 *   - 顔の画像名は全身の画像名の拡張子の前に -face を足したもの（tool/chara-crop と同じ決まり）
 *   - 巻の選択：巻が 1 つなら出さない／最初は最新の巻／切り替えても選んでいた人がその巻にいれば同じ人のまま、
 *     いなければ先頭の人／押した巻のボタンにフォーカスが残る（ボタンを作り直さない）
 */

import { describe, expect, it } from 'vitest';
import { availableVolumes, faceImage, render, resolveCharacters } from './characters';
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

describe('render — 巻の選択', () => {
    const _who = (el: HTMLElement): string => el.querySelector('.cv-name')!.textContent ?? '';
    const _vol = (el: HTMLElement, v: number): HTMLButtonElement =>
        [...el.querySelectorAll<HTMLButtonElement>('.cv-vol')].find(b => b.textContent === `${v}巻`)!;
    // 1 巻は 甲・乙、2 巻は 丙・乙・丁（乙は両方の巻にいる。並びの位置は違う）
    const _data = (): CharactersData => [
        { volume: 1, characters: ['甲', '乙'].map(name => ({ name, description: '', image: '' })) },
        { volume: 2, characters: ['丙', '乙', '丁'].map(name => ({ name, description: '', image: '' })) },
    ];

    it('巻が 1 つなら選択を出さない', () => {
        const el = document.createElement('section');
        render(el, _data(), 1);
        expect(el.querySelector<HTMLElement>('.cv-vols')!.hidden).toBe(true);
    });

    it('最初は最新の巻で、そのボタンだけが押された状態', () => {
        const el = document.createElement('section');
        render(el, _data(), 2);
        expect(_vol(el, 2).getAttribute('aria-pressed')).toBe('true');
        expect(_vol(el, 1).getAttribute('aria-pressed')).toBe('false');
        expect(el.querySelectorAll('.cv-face')).toHaveLength(3);
    });

    it('切り替えても、選んでいた人がその巻にいれば同じ人のまま', () => {
        const el = document.createElement('section');
        render(el, _data(), 2);
        el.querySelectorAll<HTMLButtonElement>('.cv-face')[1].click();   // 2 巻の乙
        expect(_who(el)).toBe('乙');
        _vol(el, 1).click();
        expect(_who(el)).toBe('乙');
        expect(el.querySelectorAll('.cv-face')[1].getAttribute('aria-pressed')).toBe('true');   // 1 巻では 2 人目
    });

    it('選んでいた人がその巻にいなければ先頭の人', () => {
        const el = document.createElement('section');
        render(el, _data(), 2);
        el.querySelectorAll<HTMLButtonElement>('.cv-face')[2].click();   // 丁（2 巻だけ）
        _vol(el, 1).click();
        expect(_who(el)).toBe('甲');
    });

    it('押した巻のボタンにフォーカスが残る', () => {
        const el = document.createElement('section');
        document.body.appendChild(el);
        render(el, _data(), 2);
        const b = _vol(el, 1);
        b.focus();
        b.click();
        expect(document.activeElement).toBe(b);
        expect(b.getAttribute('aria-pressed')).toBe('true');
        el.remove();
    });
});
