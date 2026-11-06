/*
 * volumes.test.ts
 * volumes.ts の仕様駆動テスト。
 * IF: type StoryStage = 1|2|3|4|5
 *     MAX_STORY_STAGE: StoryStage
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
 *   - vol5 を足しても MAX_STORY_STAGE を超えない（型範囲外の値を返さない）
 *   - 純関数の非破壊性
 *   - 不正入力・境界の耐性
 */

import { describe, expect, it } from 'vitest';
import { buildStageTable, canWriteAutoSave, computeStoryStage, embedStageTable, MAX_STORY_STAGE, resolveResumePoint } from './volumes';
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

    // 型 StoryStage を広げる前に vol5 を足してしまった状態を再現する。実行時に型範囲外の値
    // （as StoryStage が嘘になる 6）を返さないことが要点で、代わりに stage が頭打ちになる。
    // 「頭打ちのまま気付かない」ほうは story-integrity の (m) が build で止める（責務分離）。
    describe('stage 上限 MAX_STORY_STAGE でのクランプ', () => {
        const VOL5_LAST = '15-01';
        const FIVE_VOLS: StoryData = [
            ...STORY,
            {
                volume: 5,
                epRange: [15, 15],
                afterword: { published: false },
                episodes: [
                    { id: 15, title: 'ep15', sections: [{ id: 1, published: true }] },
                ],
            },
        ];

        it('vol4 末尾 read → stage 5（vol5 冒頭が公開済みなので通常どおり上がる）', () => {
            expect(computeStoryStage([VOL4_LAST], FIVE_VOLS)).toBe(5);
        });

        it('vol5（最終）末尾 read → 本来 stage 6 だが MAX_STORY_STAGE でクランプされる', () => {
            expect(computeStoryStage([VOL5_LAST], FIVE_VOLS)).toBe(MAX_STORY_STAGE);
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

// ── オートセーブと「続きから読む」の地点（要件 06-5「オートセーブ」）──────────────────
// fixture：第 1 巻 01-01・01-02・02-01・02-02・02-03（巻末）／第 2 巻 05-01・05-02。05-03 は未公開。
const RESUME_STORY: StoryData = [
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
const PUBLISHED_KEYS = ['01-01', '01-02', '02-01', '02-02', '02-03', '05-01', '05-02'];
const parseKey = (k: string) => { const [ep, sec] = k.split('-').map(Number); return { ep, sec }; };
const at = (key: string, ratio = 0.4) => ({ ...parseKey(key), ratio });

describe('resolveResumePoint（「続きから読む」の地点）', () => {
    it('読破もオートセーブもない → 最初の公開 sec の先頭', () => {
        expect(resolveResumePoint([], null, RESUME_STORY)).toEqual({ kind: 'first', ep: 1, sec: 1 });
    });

    it('オートセーブが最大読破位置より先の公開 sec を指す → その位置', () => {
        expect(resolveResumePoint(['01-01'], at('01-02', 0.4), RESUME_STORY)).toEqual({ kind: 'autosave', ep: 1, sec: 2, ratio: 0.4 });
    });

    it('読破がなくオートセーブがある → オートセーブの位置（ratio 0 でも）', () => {
        expect(resolveResumePoint([], at('02-02', 0), RESUME_STORY)).toEqual({ kind: 'autosave', ep: 2, sec: 2, ratio: 0 });
    });

    it('読破があってオートセーブがない → 最大読破の節の末尾', () => {
        expect(resolveResumePoint(['01-01', '02-01'], null, RESUME_STORY)).toEqual({ kind: 'read-end', ep: 2, sec: 1 });
    });

    it('オートセーブが最大読破位置と同じ節 → 最大読破の節の末尾（読み終えた節の位置は使わない）', () => {
        expect(resolveResumePoint(['01-01'], at('01-01', 0.3), RESUME_STORY)).toEqual({ kind: 'read-end', ep: 1, sec: 1 });
    });

    it('オートセーブが最大読破位置より前 → 無視して最大読破の節の末尾（旧版の読み返しの値）', () => {
        expect(resolveResumePoint(['02-01'], at('01-01'), RESUME_STORY)).toEqual({ kind: 'read-end', ep: 2, sec: 1 });
    });

    it('未公開 sec を指すオートセーブは無視する', () => {
        expect(resolveResumePoint(['01-01'], at('05-03'), RESUME_STORY)).toEqual({ kind: 'read-end', ep: 1, sec: 1 });
        expect(resolveResumePoint([], at('05-03'), RESUME_STORY)).toEqual({ kind: 'first', ep: 1, sec: 1 });
    });

    it('未公開 sec の読破は無視する（残る最大読破の節の末尾／残らなければ最初の節）', () => {
        expect(resolveResumePoint(['01-02', '05-03'], null, RESUME_STORY)).toEqual({ kind: 'read-end', ep: 1, sec: 2 });
        expect(resolveResumePoint(['05-03'], null, RESUME_STORY)).toEqual({ kind: 'first', ep: 1, sec: 1 });
    });

    it('存在しない節を指す値も無視する', () => {
        expect(resolveResumePoint(['99-01'], at('99-02'), RESUME_STORY)).toEqual({ kind: 'first', ep: 1, sec: 1 });
    });

    it('読破を飛ばして読んでも最大読破位置で決まる（順読は要求しない）', () => {
        expect(resolveResumePoint(['02-02'], null, RESUME_STORY)).toEqual({ kind: 'read-end', ep: 2, sec: 2 });
    });

    it('最新まで読了 → 最後の節の末尾', () => {
        expect(resolveResumePoint(['05-02'], at('05-02', 0.9), RESUME_STORY)).toEqual({ kind: 'read-end', ep: 5, sec: 2 });
    });

    it('公開済みの節がない → null', () => {
        const none: StoryData = [{ volume: 1, epRange: [1, 1], afterword: { published: false }, episodes: [{ id: 1, title: 'a', sections: [{ id: 1, published: false }] }] }];
        expect(resolveResumePoint([], null, none)).toBeNull();
        expect(resolveResumePoint(['01-01'], at('01-01'), none)).toBeNull();
    });

    it('引数を破壊しない', () => {
        const read = ['01-02', '01-01'];
        const snapshot = JSON.stringify(RESUME_STORY);
        resolveResumePoint(read, at('02-01'), RESUME_STORY);
        expect(read).toEqual(['01-02', '01-01']);
        expect(JSON.stringify(RESUME_STORY)).toBe(snapshot);
    });
});

describe('canWriteAutoSave（オートセーブを書いてよいページか）', () => {
    it('読破がなければどの公開 sec でも書く', () => {
        for (const k of PUBLISHED_KEYS) expect(canWriteAutoSave(parseKey(k).ep, parseKey(k).sec, [], RESUME_STORY)).toBe(true);
    });

    it('最大読破位置より先だけ書く（飛ばした節を後から埋める・読み返しでは書かない）', () => {
        const read = ['01-01', '02-01'];
        expect(canWriteAutoSave(1, 1, read, RESUME_STORY)).toBe(false);
        expect(canWriteAutoSave(1, 2, read, RESUME_STORY)).toBe(false);
        expect(canWriteAutoSave(2, 1, read, RESUME_STORY)).toBe(false);
        expect(canWriteAutoSave(2, 2, read, RESUME_STORY)).toBe(true);
        expect(canWriteAutoSave(5, 2, read, RESUME_STORY)).toBe(true);
    });

    it('未公開・存在しない節には書かない', () => {
        expect(canWriteAutoSave(5, 3, [], RESUME_STORY)).toBe(false);
        expect(canWriteAutoSave(99, 1, [], RESUME_STORY)).toBe(false);
    });

    it('あとがきのキーは最大読破位置に数えない', () => {
        expect(canWriteAutoSave(1, 1, ['vol01-af'], RESUME_STORY)).toBe(true);
    });
});

// 小さい fixture の全組み合わせ（読破の部分集合 × オートセーブの位置 × 開くページ）で不変条件を確かめる。
describe('記録の不変条件（全組み合わせ）', () => {
    const subsets = (xs: string[]): string[][] => xs.reduce<string[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
    const READS = subsets(PUBLISHED_KEYS);
    const AUTOS = [null, ...[...PUBLISHED_KEYS, '05-03', '99-01'].map((k) => at(k, 0.5))];
    const each = (fn: (read: string[], auto: ReturnType<typeof at> | null) => void) => {
        for (const read of READS) for (const auto of AUTOS) fn(read, auto);
    };
    const maxRead = (read: string[]) => Math.max(-1, ...read.map((k) => PUBLISHED_KEYS.indexOf(k)));
    const keyOf = (p: { ep: number; sec: number }) => `${String(p.ep).padStart(2, '0')}-${String(p.sec).padStart(2, '0')}`;

    it('地点はどの記録でも公開済みの節', () => {
        each((read, auto) => {
            const p = resolveResumePoint(read, auto, RESUME_STORY);
            expect(p).not.toBeNull();
            expect(PUBLISHED_KEYS).toContain(keyOf(p!));
        });
    });

    it('読み返しで動かない：最大読破以前のページは「書いてよい」にならない', () => {
        for (const read of READS) {
            PUBLISHED_KEYS.forEach((k, i) => {
                expect(canWriteAutoSave(parseKey(k).ep, parseKey(k).sec, read, RESUME_STORY)).toBe(i > maxRead(read));
            });
        }
    });

    it('書けば地点になる：書いてよいページに書いた直後、地点はそのページ', () => {
        for (const read of READS) {
            for (const k of PUBLISHED_KEYS) {
                if (!canWriteAutoSave(parseKey(k).ep, parseKey(k).sec, read, RESUME_STORY)) continue;
                expect(resolveResumePoint(read, at(k, 0.2), RESUME_STORY)).toEqual({ kind: 'autosave', ...at(k, 0.2) });
            }
        }
    });

    it('読破で後退しない：読破を足しても地点は前へ戻らない', () => {
        each((read, auto) => {
            const before = PUBLISHED_KEYS.indexOf(keyOf(resolveResumePoint(read, auto, RESUME_STORY)!));
            for (const k of PUBLISHED_KEYS) {
                if (read.includes(k)) continue;
                const after = PUBLISHED_KEYS.indexOf(keyOf(resolveResumePoint([...read, k], auto, RESUME_STORY)!));
                expect(after).toBeGreaterThanOrEqual(before);
            }
        });
    });

    it('あとがきは無関係：あとがきのキーを足しても地点は変わらない', () => {
        each((read, auto) => {
            expect(resolveResumePoint([...read, 'vol01-af'], auto, RESUME_STORY)).toEqual(resolveResumePoint(read, auto, RESUME_STORY));
        });
    });
});

// ── 読破キー → 到達する stage の表（要件 06-7「次巻の公開直後」）──────────────────
describe('buildStageTable / embedStageTable', () => {
    it('stage 2 以上に届くキーだけを持つ', () => {
        expect(buildStageTable(RESUME_STORY)).toEqual({ '02-03': 2, '05-01': 2, '05-02': 3 });
    });

    it('次巻の冒頭が未公開なら空（読者の stage は上がらない）', () => {
        const story: StoryData = [
            RESUME_STORY[0],
            { ...RESUME_STORY[1], episodes: [{ id: 5, title: 'c', sections: [{ id: 1, published: false }] }] },
        ];
        expect(buildStageTable(story)).toEqual({});
    });

    it('表と計算の一致：全組み合わせで、読破キーの表引きの最大値が computeStoryStage と同じ', () => {
        const table = buildStageTable(RESUME_STORY);
        const subsets = PUBLISHED_KEYS.reduce<string[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
        for (const read of subsets) {
            const lifted = Math.max(1, ...read.map((k) => table[k] ?? 1));
            expect(lifted).toBe(computeStoryStage(read, RESUME_STORY));
        }
    });

    it('未公開の節・あとがきのキーは表に載らない', () => {
        const table = buildStageTable(RESUME_STORY);
        expect(table['05-03']).toBeUndefined();
        expect(table['vol01-af']).toBeUndefined();
    });

    it('印を表に置き換える。印が無い HTML は変えない', () => {
        const html = '<script>var table = {/*stage-table*/};</script>';
        expect(embedStageTable(html, RESUME_STORY)).toBe('<script>var table = {"02-03":2,"05-01":2,"05-02":3};</script>');
        expect(embedStageTable('<p>x</p>', RESUME_STORY)).toBe('<p>x</p>');
    });

    it('印は未変換のままでも空の表として正しい JavaScript（変換を通らない配信でも動く）', () => {
        const table = new Function('return {/*stage-table*/};')();
        expect(table).toEqual({});
    });
});
