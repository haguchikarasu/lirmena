/*
 * suppression.test.ts
 * 対象: suppression.ts の isFrontier（最前線か）。
 * 期待は要件 06-5「外部サイト/直接アクセスで開いた本文ページは記録しない（最前線を除く）」から書く：
 *   最前線＝「続きから読む」の地点、または最大読破の次の公開 sec。
 *   読破がなければ「最大読破の次」はなく、読破もオートセーブもない読者の最前線は最初の公開 sec。
 *   読破がなくオートセーブがある読者の最前線は地点だけ。
 * 環境: jsdom 不要（純関数）。
 */
import { describe, expect, it } from 'vitest';
import { isFrontier } from './suppression';
import { resolveResumePoint } from './volumes';
import type { StoryData } from './types';

// 第 1 巻 01-01・01-02・02-01・02-02・02-03（巻末）／第 2 巻 05-01・05-02。05-03 は未公開。
const STORY: StoryData = [
    {
        volume: 1,
        epRange: [1, 2],
        afterword: { published: true },
        episodes: [
            { id: 1, title: 'a', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
            { id: 2, title: 'b', sections: [{ id: 1, published: true }, { id: 2, published: true }, { id: 3, published: true }] },
        ],
    },
    {
        volume: 2,
        epRange: [5, 5],
        afterword: { published: false },
        episodes: [
            { id: 5, title: 'c', sections: [{ id: 1, published: true }, { id: 2, published: true }, { id: 3, published: false }] },
        ],
    },
];
const KEYS = ['01-01', '01-02', '02-01', '02-02', '02-03', '05-01', '05-02'];
const parse = (k: string) => { const [ep, sec] = k.split('-').map(Number); return { ep, sec }; };
const at = (k: string, ratio = 0.4) => ({ ...parse(k), ratio });
const front = (key: string, read: string[], auto: ReturnType<typeof at> | null) => isFrontier(parse(key).ep, parse(key).sec, read, auto, STORY);
// どのページが最前線かを列挙する（判定表を読みやすくする）
const frontier = (read: string[], auto: ReturnType<typeof at> | null) => KEYS.filter((k) => front(k, read, auto));

describe('isFrontier（最前線か）', () => {
    it('読破もオートセーブもない：最初の公開 sec だけ', () => {
        expect(frontier([], null)).toEqual(['01-01']);
    });

    it('読破がありオートセーブが地点より前か無い：最大読破の節（地点）とその次', () => {
        expect(frontier(['01-01'], null)).toEqual(['01-01', '01-02']);
        expect(frontier(['02-01'], at('01-01'))).toEqual(['02-01', '02-02']);
    });

    it('読破があり先の節に読みかけ：読みかけ（地点）と最大読破の次', () => {
        expect(frontier(['01-01'], at('02-02'))).toEqual(['01-02', '02-02']);
    });

    it('読みかけが最大読破の次：その 1 つ', () => {
        expect(frontier(['01-01'], at('01-02'))).toEqual(['01-02']);
    });

    it('読破がなくオートセーブがある：地点だけ（最大読破の次はない）', () => {
        expect(frontier([], at('02-02'))).toEqual(['02-02']);
    });

    it('次巻の冒頭も「最大読破の次」になる（巻・話をまたぐ）', () => {
        expect(front('05-01', ['02-03'], null)).toBe(true);
        expect(front('02-01', ['01-02'], null)).toBe(true);
    });

    it('最新まで読了：最後の節だけ', () => {
        expect(frontier(['05-02'], null)).toEqual(['05-02']);
    });

    it('未公開の節は最前線にならず、読破の次は公開済みの節を数える', () => {
        expect(isFrontier(5, 3, ['05-02'], null, STORY)).toBe(false);
        expect(isFrontier(5, 3, [], at('05-03'), STORY)).toBe(false);
    });

    it('未公開を指すオートセーブは無視する（読破もなければ最初の公開 sec）', () => {
        expect(frontier([], at('05-03'))).toEqual(['01-01']);
    });

    it('あとがきのキーは最大読破に数えない', () => {
        expect(frontier(['vol01-af'], null)).toEqual(['01-01']);
    });

    it('全組み合わせ：地点と最大読破の次は必ず最前線で、それ以外は最前線でない', () => {
        const subsets = KEYS.reduce<string[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
        const autos = [null, ...KEYS.map((k) => at(k))];
        for (const read of subsets) {
            for (const auto of autos) {
                const point = resolveResumePoint(read, auto, STORY)!;
                const pointKey = KEYS.find((k) => parse(k).ep === point.ep && parse(k).sec === point.sec)!;
                const max = Math.max(-1, ...read.map((k) => KEYS.indexOf(k)));
                const expected = new Set([pointKey]);
                if (max >= 0 && max + 1 < KEYS.length) expected.add(KEYS[max + 1]);
                expect(new Set(frontier(read, auto))).toEqual(expected);
            }
        }
    });

    it('あとがきは無関係：全組み合わせであとがきのキーを足しても変わらない', () => {
        const subsets = KEYS.reduce<string[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
        for (const read of subsets) {
            expect(frontier([...read, 'vol01-af'], at('02-02'))).toEqual(frontier(read, at('02-02')));
        }
    });
});
