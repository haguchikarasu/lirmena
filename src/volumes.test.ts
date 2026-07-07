/*
 * volumes.test.ts
 * volumes.ts の仕様駆動テスト。
 * IF: type StoryStage = 1|2|3|4|5
 *     computeStoryStage(read, volumes, episodes): StoryStage
 * 期待値は IF コメント／要件 06-5-bookmark「進捗バーの色（物語進行段階：5段階）」から導出する（実装をなぞらない）。
 *
 * 網羅する観点：
 *   - A 案の判定：各 vol の end sec を read で移行（stage 1〜5）
 *   - 順読要求：後ろの vol の end sec だけ read されていても前段が未読なら stage 上がらない
 *   - 防御的複数 end：仕様外だが実装が誤り耐性を持つこと
 *   - 境界と不正入力：空データ・不正キー・範囲外 ep
 *   - **純関数の非破壊性**：呼び出し後に引数の内容が変わらないこと（Codex design レビュー #5）
 *   - **実データ schema 検証**：public/episodes.json の全 sec が end: boolean を持ち、
 *     1 vol につき end: true が 0 or 1 個であること（Codex design レビュー #2・#3）
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeStoryStage } from './volumes';
import type { VolumesData, EpisodesData } from './types';

// 本番 volumes.json と同じ 4vol 構成
const VOLUMES: VolumesData = [
    { volume: 1, epRange: [1, 4] },
    { volume: 2, epRange: [5, 7] },
    { volume: 3, epRange: [8, 10] },
    { volume: 4, epRange: [11, 14] },
];

// 各 vol の最終 sec に end: true を付けたモック episodes（仕様通り 1 vol につき 1 sec）
// vol1 end: "04-02"、vol2 end: "07-02"、vol3 end: "10-02"、vol4 end: "14-02"
const EPISODES: EpisodesData = [
    { id: 1, title: 'ep1', sections: [{ id: 1, published: true, end: false }, { id: 2, published: true, end: false }] },
    { id: 2, title: 'ep2', sections: [{ id: 1, published: true, end: false }, { id: 2, published: true, end: false }] },
    { id: 3, title: 'ep3', sections: [{ id: 1, published: false, end: false }] },
    { id: 4, title: 'ep4', sections: [{ id: 1, published: false, end: false }, { id: 2, published: false, end: true }] },
    { id: 5, title: 'ep5', sections: [{ id: 1, published: false, end: false }] },
    { id: 6, title: 'ep6', sections: [{ id: 1, published: false, end: false }] },
    { id: 7, title: 'ep7', sections: [{ id: 1, published: false, end: false }, { id: 2, published: false, end: true }] },
    { id: 8, title: 'ep8', sections: [{ id: 1, published: false, end: false }] },
    { id: 9, title: 'ep9', sections: [{ id: 1, published: false, end: false }] },
    { id: 10, title: 'ep10', sections: [{ id: 1, published: false, end: false }, { id: 2, published: false, end: true }] },
    { id: 11, title: 'ep11', sections: [{ id: 1, published: false, end: false }] },
    { id: 12, title: 'ep12', sections: [{ id: 1, published: false, end: false }] },
    { id: 13, title: 'ep13', sections: [{ id: 1, published: false, end: false }] },
    { id: 14, title: 'ep14', sections: [{ id: 1, published: false, end: false }, { id: 2, published: false, end: true }] },
];
const VOL1_END = '04-02';
const VOL2_END = '07-02';
const VOL3_END = '10-02';
const VOL4_END = '14-02';

describe('computeStoryStage — A 案の判定', () => {
    describe('各 vol の end sec を read で stage 移行', () => {
        it('read が空 → stage 1（初期・未完読）', () => {
            expect(computeStoryStage([], VOLUMES, EPISODES)).toBe(1);
        });

        it('vol1 end sec のみ read → stage 2', () => {
            expect(computeStoryStage([VOL1_END], VOLUMES, EPISODES)).toBe(2);
        });

        it('vol1 + vol2 end sec read → stage 3', () => {
            expect(computeStoryStage([VOL1_END, VOL2_END], VOLUMES, EPISODES)).toBe(3);
        });

        it('vol1-3 end sec read → stage 4', () => {
            expect(computeStoryStage([VOL1_END, VOL2_END, VOL3_END], VOLUMES, EPISODES)).toBe(4);
        });

        it('vol1-4 全 end sec read → stage 5（物語完結）', () => {
            expect(
                computeStoryStage([VOL1_END, VOL2_END, VOL3_END, VOL4_END], VOLUMES, EPISODES)
            ).toBe(5);
        });

        it('vol1-4 に加えて他の sec も read されていても stage 5 は変わらない', () => {
            expect(
                computeStoryStage(
                    [VOL1_END, VOL2_END, VOL3_END, VOL4_END, '01-01', '02-02'],
                    VOLUMES,
                    EPISODES
                )
            ).toBe(5);
        });
    });

    describe('順読要求（vol の順序で連続的に完読）', () => {
        it('vol3 end のみ read（vol1/vol2 未完読）→ stage 1 のまま（先取り移行を防ぐ）', () => {
            expect(computeStoryStage([VOL3_END], VOLUMES, EPISODES)).toBe(1);
        });

        it('vol1 + vol3 end read（vol2 未完読）→ stage 2 のまま（vol2 で止まる）', () => {
            expect(computeStoryStage([VOL1_END, VOL3_END], VOLUMES, EPISODES)).toBe(2);
        });

        it('vol1 + vol2 + vol4 end read（vol3 未完読）→ stage 3 のまま', () => {
            expect(
                computeStoryStage([VOL1_END, VOL2_END, VOL4_END], VOLUMES, EPISODES)
            ).toBe(3);
        });

        it('vol4 end のみ read（vol1-3 全部未完読）→ stage 1 のまま', () => {
            expect(computeStoryStage([VOL4_END], VOLUMES, EPISODES)).toBe(1);
        });

        it('volumes が volume 昇順以外に並んでいても順読要求は変わらない（引数順序に非依存）', () => {
            const shuffled: VolumesData = [VOLUMES[2], VOLUMES[0], VOLUMES[3], VOLUMES[1]];
            expect(computeStoryStage([VOL1_END, VOL3_END], shuffled, EPISODES)).toBe(2);
        });
    });

    describe('end フラグが無い vol は判定境界（未確定として break）', () => {
        it('どの vol にも end sec が無い（現行データ相当）→ stage 1', () => {
            const noEndEpisodes: EpisodesData = EPISODES.map(e => ({
                ...e,
                sections: e.sections.map(s => ({ ...s, end: false })),
            }));
            expect(computeStoryStage([VOL1_END, VOL2_END], VOLUMES, noEndEpisodes)).toBe(1);
        });

        it('vol1 のみ end が定義され read されている、vol2 は end 未宣言 → stage 2 で止まる', () => {
            const partialEndEpisodes: EpisodesData = EPISODES.map(e => {
                if (e.id === 7) {
                    return { ...e, sections: e.sections.map(s => ({ ...s, end: false })) };
                }
                return e;
            });
            expect(
                computeStoryStage([VOL1_END, VOL2_END], VOLUMES, partialEndEpisodes)
            ).toBe(2);
        });
    });

    describe('防御的複数 end（仕様外だが安全側に倒す）', () => {
        it('1 vol に end が 2 個定義され、一部だけ read → その vol は未完読扱いで stage 上がらない', () => {
            const doubleEndEpisodes: EpisodesData = EPISODES.map(e => {
                if (e.id === 4) {
                    return {
                        ...e,
                        sections: [
                            { id: 1, published: false, end: true },
                            { id: 2, published: false, end: true },
                        ],
                    };
                }
                return e;
            });
            expect(computeStoryStage(['04-02'], VOLUMES, doubleEndEpisodes)).toBe(1);
        });

        it('1 vol に end が 2 個定義され、全部 read → その vol は完読扱いで stage 上がる', () => {
            const doubleEndEpisodes: EpisodesData = EPISODES.map(e => {
                if (e.id === 4) {
                    return {
                        ...e,
                        sections: [
                            { id: 1, published: false, end: true },
                            { id: 2, published: false, end: true },
                        ],
                    };
                }
                return e;
            });
            expect(
                computeStoryStage(['04-01', '04-02'], VOLUMES, doubleEndEpisodes)
            ).toBe(2);
        });
    });

    describe('不正入力の耐性', () => {
        it('不正キー（空文字・"abc"・"01-"・"-01"）が read に混じっても stage 1', () => {
            expect(
                computeStoryStage(['', 'abc', '01-', '-01'], VOLUMES, EPISODES)
            ).toBe(1);
        });

        it('read に不正キーが混じっていても正常な end キーが揃えば stage は上がる', () => {
            expect(
                computeStoryStage([VOL1_END, 'bad', '01-'], VOLUMES, EPISODES)
            ).toBe(2);
        });
    });

    describe('データ形状の境界', () => {
        it('volumes が空 → stage 1', () => {
            expect(computeStoryStage([VOL1_END], [], EPISODES)).toBe(1);
        });

        it('episodes が空 → どの vol の end sec も見つからず stage 1', () => {
            expect(computeStoryStage([VOL1_END], VOLUMES, [])).toBe(1);
        });

        it('volumes と episodes 両方空 → stage 1', () => {
            expect(computeStoryStage([VOL1_END], [], [])).toBe(1);
        });
    });

    describe('キー形式（2桁ゼロ埋め "EP-SEC"）', () => {
        it('ep が 2 桁（"14-02"）で正しく vol4 end と判定される', () => {
            expect(
                computeStoryStage([VOL1_END, VOL2_END, VOL3_END, VOL4_END], VOLUMES, EPISODES)
            ).toBe(5);
        });
    });
});

describe('computeStoryStage — 純関数の非破壊性（引数を破壊しない）', () => {
    it('呼び出し後に read 配列の内容と長さが変わらない', () => {
        const read = [VOL1_END, VOL2_END];
        const before = [...read];
        computeStoryStage(read, VOLUMES, EPISODES);
        expect(read).toEqual(before);
    });

    it('呼び出し後に volumes 配列の順序が変わらない（[...volumes].sort() の非破壊性を担保）', () => {
        // 昇順ではない順序を渡し、呼び出し後も元の順序が保たれることを確認
        const volumes: VolumesData = [VOLUMES[3], VOLUMES[0], VOLUMES[2], VOLUMES[1]];
        const before = volumes.map(v => v.volume);
        computeStoryStage([VOL1_END, VOL2_END], volumes, EPISODES);
        expect(volumes.map(v => v.volume)).toEqual(before);
    });

    it('呼び出し後に episodes 配列とその sections が変わらない', () => {
        const episodesCopy = JSON.parse(JSON.stringify(EPISODES));
        computeStoryStage([VOL1_END, VOL2_END], VOLUMES, EPISODES);
        expect(EPISODES).toEqual(episodesCopy);
    });
});

/**
 * 実データ（public/episodes.json）の runtime schema 検証（Codex design レビュー #2・#3）。
 * TypeScript の型は tsc 時点でしかチェックされず、実 JSON は runtime fetch で読まれる。
 * このテストは fs で実 JSON を読んで:
 *   - 全 sec が end: boolean を required で持つこと（欠落があれば落ちる）
 *   - 各 vol につき end: true は 0 or 1 個であること（仕様「1 vol につき 1 sec」を担保）
 * を検証する。将来 sec 追加時に end 欠落や多重 end が npm test で自動検出される。
 */
describe('public/episodes.json の runtime schema 検証', () => {
    const EPISODES_JSON_PATH = resolve(__dirname, '../public/episodes.json');
    const raw = readFileSync(EPISODES_JSON_PATH, 'utf-8');
    const data = JSON.parse(raw) as EpisodesData;

    // 本番の volumes.json も併せて読み込む（volume→epRange の対応を得る）
    const VOLUMES_JSON_PATH = resolve(__dirname, '../public/volumes.json');
    const volumesRaw = readFileSync(VOLUMES_JSON_PATH, 'utf-8');
    const volumesData = JSON.parse(volumesRaw) as VolumesData;

    it('全 sec が end: boolean を required で持つ（欠落なし）', () => {
        for (const ep of data) {
            for (const sec of ep.sections) {
                expect(
                    typeof sec.end,
                    `ep${ep.id} sec${sec.id} の end フィールドが boolean でない（欠落または不正型）`
                ).toBe('boolean');
            }
        }
    });

    it('各 vol につき end: true は 0 or 1 個（仕様「1 vol の最終 sec のみ」を担保）', () => {
        for (const vol of volumesData) {
            let endCount = 0;
            for (const ep of data) {
                if (ep.id < vol.epRange[0] || ep.id > vol.epRange[1]) continue;
                for (const sec of ep.sections) {
                    if (sec.end) endCount += 1;
                }
            }
            expect(
                endCount,
                `vol${vol.volume}（epRange ${vol.epRange.join('-')}）に end: true が ${endCount} 個ある（0 or 1 でなければ仕様違反）`
            ).toBeLessThanOrEqual(1);
        }
    });
});
