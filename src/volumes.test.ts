/*
 * volumes.test.ts
 * volumes.ts の仕様駆動テスト。
 * IF: type StoryStage = 1|2|3|4|5
 *     computeStoryStage(read: SecKey[], story: StoryData): StoryStage
 * 期待値は IF コメント／要件 06-5-bookmark「進捗バーの色（物語進行段階：5段階）」から導出する（実装をなぞらない）。
 *
 * 網羅する観点：
 *   - 最大読破位置ベースの判定：vol の最終公開 sec 到達 & 次巻冒頭 sec 公開で移行
 *   - 順読要求撤廃：vol1 未 read でも vol3 巻末 read で stage 4 に上がる
 *   - 次巻冒頭 sec 未公開ゲート：貴巻末 read でも次巻冒頭が未公開なら stage 上がらない
 *   - あとがきキー "vol01-af" は判定に影響しない
 *   - 未公開 sec の残 read キー（過去データ）で maxReadPos が公開範囲を超えない
 *   - 4vol 完読で stage 5（次巻無し・動的クランプ）
 *   - 純関数の非破壊性
 *   - 不正入力・境界の耐性
 */

import { describe, expect, it } from 'vitest';
import { computeStoryStage } from './volumes';
import type { StoryData } from './types';

// 本番相当の 4vol 構成（全 sec published=true にして最大読破位置の計算をシンプルにする）
// vol1: ep1[1,2], ep2[1], ep3[1], ep4[1,2]  ← 末尾 "04-02"
// vol2: ep5[1], ep6[1], ep7[1,2]            ← 末尾 "07-02"
// vol3: ep8[1], ep9[1], ep10[1,2]           ← 末尾 "10-02"
// vol4: ep11[1], ep12[1], ep13[1], ep14[1,2] ← 末尾 "14-02"
const STORY: StoryData = [
    {
        volume: 1,
        epRange: [1, 4],
        heroCard: { file: 'vol01.avif' },
        afterword: { published: false },
        episodes: [
            { id: 1, title: 'ep1', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
            { id: 2, title: 'ep2', sections: [{ id: 1, published: true }] },
            { id: 3, title: 'ep3', sections: [{ id: 1, published: true }] },
            { id: 4, title: 'ep4', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
        ],
    },
    {
        volume: 2,
        epRange: [5, 7],
        heroCard: { file: 'vol01.avif' },
        afterword: { published: false },
        episodes: [
            { id: 5, title: 'ep5', sections: [{ id: 1, published: true }] },
            { id: 6, title: 'ep6', sections: [{ id: 1, published: true }] },
            { id: 7, title: 'ep7', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
        ],
    },
    {
        volume: 3,
        epRange: [8, 10],
        heroCard: { file: 'vol01.avif' },
        afterword: { published: false },
        episodes: [
            { id: 8, title: 'ep8', sections: [{ id: 1, published: true }] },
            { id: 9, title: 'ep9', sections: [{ id: 1, published: true }] },
            { id: 10, title: 'ep10', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
        ],
    },
    {
        volume: 4,
        epRange: [11, 14],
        heroCard: { file: 'vol01.avif' },
        heroCardCompleted: { file: 'vol01.avif' },
        afterword: { published: false },
        episodes: [
            { id: 11, title: 'ep11', sections: [{ id: 1, published: true }] },
            { id: 12, title: 'ep12', sections: [{ id: 1, published: true }] },
            { id: 13, title: 'ep13', sections: [{ id: 1, published: true }] },
            { id: 14, title: 'ep14', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
        ],
    },
];

const VOL1_LAST = '04-02';
const VOL2_LAST = '07-02';
const VOL3_LAST = '10-02';
const VOL4_LAST = '14-02';

describe('computeStoryStage — 最大読破位置＋次巻冒頭公開の判定', () => {
    describe('基本の段階遷移（全 vol 公開状態）', () => {
        it('read が空 → stage 1', () => {
            expect(computeStoryStage([], STORY)).toBe(1);
        });

        it('vol1 末尾 read → stage 2（vol2 冒頭 sec 公開済み）', () => {
            expect(computeStoryStage([VOL1_LAST], STORY)).toBe(2);
        });

        it('vol2 末尾 read → stage 3（vol3 冒頭 sec 公開済み）', () => {
            expect(computeStoryStage([VOL2_LAST], STORY)).toBe(3);
        });

        it('vol3 末尾 read → stage 4（vol4 冒頭 sec 公開済み）', () => {
            expect(computeStoryStage([VOL3_LAST], STORY)).toBe(4);
        });

        it('vol4（最終）末尾 read → stage 5（次巻なし＝物語完結）', () => {
            expect(computeStoryStage([VOL4_LAST], STORY)).toBe(5);
        });

        it('全 vol 末尾 read → stage 5', () => {
            expect(computeStoryStage([VOL1_LAST, VOL2_LAST, VOL3_LAST, VOL4_LAST], STORY)).toBe(5);
        });
    });

    describe('順読要求は撤廃（最大位置で判定）', () => {
        it('vol1 未 read で vol3 末尾のみ read → stage 4（旧仕様なら stage 1）', () => {
            expect(computeStoryStage([VOL3_LAST], STORY)).toBe(4);
        });

        it('vol1/vol2 未 read で vol4 末尾のみ read → stage 5', () => {
            expect(computeStoryStage([VOL4_LAST], STORY)).toBe(5);
        });

        it('localStorage クリア後に vol3 巻末を再 read しただけで stage 4 に復元される', () => {
            // 旧順読要求では stage 1 のまま（vol1/vol2 完読痕跡なし）→ 新仕様は stage 4
            expect(computeStoryStage([VOL3_LAST], STORY)).toBe(4);
        });
    });

    describe('次巻冒頭 sec1 未公開ゲート', () => {
        // vol2 冒頭 ep5 sec1 が未公開のバリアント
        const NEXT_CLOSED: StoryData = [
            STORY[0],
            {
                ...STORY[1],
                episodes: [
                    { id: 5, title: 'ep5', sections: [{ id: 1, published: false }] }, // 冒頭未公開
                    STORY[1].episodes[1],
                    STORY[1].episodes[2],
                ],
            },
            STORY[2],
            STORY[3],
        ];

        it('vol1 末尾 read でも vol2 冒頭 sec1 未公開なら stage 1 のまま', () => {
            expect(computeStoryStage([VOL1_LAST], NEXT_CLOSED)).toBe(1);
        });

        it('次巻冒頭未公開の状況では、たとえ後続 vol の sec を先取り read しても stage 上がらない', () => {
            // vol1 末尾も vol3 末尾も read。vol2 冒頭が未公開なので stage 1 で頭打ち
            expect(computeStoryStage([VOL1_LAST, VOL3_LAST], NEXT_CLOSED)).toBe(1);
        });
    });

    describe('最終 vol の扱い（次巻ゲート適用外）', () => {
        it('vol4（最終）末尾 read → 次巻がないので stage 5 になる', () => {
            expect(computeStoryStage([VOL4_LAST], STORY)).toBe(5);
        });

        it('story.length + 1 で動的クランプ（現状 4vol → stage 上限 5）', () => {
            // stage が計算上 6 以上になっても 5 に張り付く（現状の 4vol 前提）
            expect(computeStoryStage([VOL1_LAST, VOL2_LAST, VOL3_LAST, VOL4_LAST], STORY)).toBe(5);
        });
    });

    describe('あとがきキーの除外', () => {
        it('あとがきキー "vol01-af" 単独 → stage 1（stage 判定に影響しない）', () => {
            expect(computeStoryStage(['vol01-af'], STORY)).toBe(1);
        });

        it('本文 sec read＋あとがきキー混在 → 本文 sec のみで判定', () => {
            expect(computeStoryStage([VOL1_LAST, 'vol01-af'], STORY)).toBe(2);
        });

        it('あとがきキー "vol04-af" 単独 → stage 1（最終 vol あとがきでも stage 上げない）', () => {
            expect(computeStoryStage(['vol04-af'], STORY)).toBe(1);
        });
    });

    describe('未公開 sec の残 read キー（過去データ）耐性', () => {
        // vol1 の ep2 sec4 を未公開にしたバリアント。read セットに "02-04" が残っていても
        // order Map に載らないため maxReadPos が公開範囲を超えない。
        const WITH_UNPUBLISHED: StoryData = [
            {
                ...STORY[0],
                episodes: [
                    STORY[0].episodes[0],
                    { id: 2, title: 'ep2', sections: [{ id: 1, published: true }, { id: 4, published: false }] },
                    STORY[0].episodes[2],
                    STORY[0].episodes[3],
                ],
            },
            STORY[1],
            STORY[2],
            STORY[3],
        ];

        it('未公開 sec の read キー "02-04" は無視される → stage 上げない', () => {
            expect(computeStoryStage(['02-04'], WITH_UNPUBLISHED)).toBe(1);
        });

        it('公開 sec の read と未公開 sec の残 read が混在 → 公開 sec のみで判定', () => {
            // vol1 末尾 "04-02" は read されているので stage 2、"02-04" は無視される
            expect(computeStoryStage([VOL1_LAST, '02-04'], WITH_UNPUBLISHED)).toBe(2);
        });
    });

    describe('未執筆 vol / 途中 vol 未公開の境界', () => {
        // vol1 と vol2 まで定義、vol3・vol4 は episodes=[]（未執筆）
        const PARTIAL: StoryData = [
            STORY[0],
            STORY[1],
            { ...STORY[2], episodes: [] },
            { ...STORY[3], episodes: [] },
        ];

        it('vol1 末尾 read → stage 2（vol2 は公開済み）', () => {
            expect(computeStoryStage([VOL1_LAST], PARTIAL)).toBe(2);
        });

        it('vol2 末尾 read → stage 3 にはならず 2 で止まる（vol3 冒頭 sec 未公開＝episodes=[]）', () => {
            expect(computeStoryStage([VOL2_LAST], PARTIAL)).toBe(2);
        });
    });

    describe('不正入力・境界の耐性', () => {
        it('story が空 → stage 1', () => {
            expect(computeStoryStage([VOL1_LAST], [])).toBe(1);
        });

        it('不正キー（空文字・"abc"・"01-"・"vol01"）が混じっても stage 上げに影響しない', () => {
            expect(computeStoryStage(['', 'abc', '01-', 'vol01'], STORY)).toBe(1);
        });

        it('不正キーと正常な末尾 read が混在 → 正常キーで判定される', () => {
            expect(computeStoryStage([VOL1_LAST, 'bad', 'vol01'], STORY)).toBe(2);
        });

        it('volume 順不同の story を渡しても volume 昇順で判定される（引数順序に非依存）', () => {
            const shuffled: StoryData = [STORY[3], STORY[0], STORY[2], STORY[1]];
            expect(computeStoryStage([VOL1_LAST], shuffled)).toBe(2);
        });
    });
});

describe('computeStoryStage — 純関数の非破壊性', () => {
    it('呼び出し後に read 配列の内容と長さが変わらない', () => {
        const read = [VOL1_LAST, VOL2_LAST];
        const before = [...read];
        computeStoryStage(read, STORY);
        expect(read).toEqual(before);
    });

    it('呼び出し後に story 配列の順序と内容が変わらない（[...story].sort の非破壊性）', () => {
        const shuffled: StoryData = [STORY[3], STORY[0], STORY[2], STORY[1]];
        const beforeVolumes = shuffled.map(v => v.volume);
        const beforeSnapshot = JSON.parse(JSON.stringify(shuffled));
        computeStoryStage([VOL1_LAST], shuffled);
        expect(shuffled.map(v => v.volume)).toEqual(beforeVolumes);
        expect(shuffled).toEqual(beforeSnapshot);
    });

    it('vol.episodes / ep.sections も破壊されない', () => {
        const snapshot = JSON.parse(JSON.stringify(STORY));
        computeStoryStage([VOL1_LAST, VOL2_LAST, VOL3_LAST, VOL4_LAST], STORY);
        expect(STORY).toEqual(snapshot);
    });
});
