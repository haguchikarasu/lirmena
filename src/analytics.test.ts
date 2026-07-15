/*
 * analytics.test.ts
 * analytics.ts の仕様駆動テスト。
 * IF: send(settings, storyStage, read: SecKey[], reached: SecKey[], episodes: EpisodesData): void
 *     buildSecOrderIndex(episodes: EpisodesData): Map<SecKey, number>
 *     computeReadRatio(read: SecKey[], totalPublished: number): number
 *     computeFurthestPosition(keys: SecKey[], order: Map<SecKey, number>): number
 * 期待値は analytics.ts 冒頭の IF コメントから導出する（実装をなぞらない）。
 *
 * 網羅する観点：
 *   - buildSecOrderIndex: 空 episodes・未公開 sec の非採番・id 昇順の物語順・非破壊性・ep をまたぐ連番
 *   - computeReadRatio: ゼロ除算防止・端数の丸め・境界（0 / 100）
 *   - computeFurthestPosition: 空配列・不正キー無視・最大値のみ拾う
 *   - send: window.gtag への結線（呼び出し回数・パラメータ形状）・gtag 未定義時の安全性
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { send, buildSecOrderIndex, computeReadRatio, computeFurthestPosition } from './analytics';
import type { EpisodesData } from './types';

const EPISODES: EpisodesData = [
    {
        id: 1, title: 'ep1', sections: [
            { id: 1, published: true },
            { id: 2, published: true },
        ],
    },
    {
        id: 2, title: 'ep2', sections: [
            { id: 1, published: true },
            { id: 2, published: false }, // 未公開＝採番されない
        ],
    },
];

describe('buildSecOrderIndex', () => {
    it('空 episodes → 空 Map', () => {
        expect(buildSecOrderIndex([]).size).toBe(0);
    });

    it('未公開 sec は番号を消費しない', () => {
        const order = buildSecOrderIndex(EPISODES);
        expect(order.has('02-02')).toBe(false);
        expect(order.size).toBe(3); // 01-01, 01-02, 02-01 のみ
    });

    it('ep→sections（id 昇順）で 0 始まりの通し番号を振る', () => {
        const order = buildSecOrderIndex(EPISODES);
        expect(order.get('01-01')).toBe(0);
        expect(order.get('01-02')).toBe(1);
        expect(order.get('02-01')).toBe(2);
    });

    it('sections が id 降順で渡されても id 昇順で採番する', () => {
        const reversed: EpisodesData = [
            {
                id: 1, title: 'ep1', sections: [
                    { id: 2, published: true },
                    { id: 1, published: true },
                ],
            },
        ];
        const order = buildSecOrderIndex(reversed);
        expect(order.get('01-01')).toBe(0);
        expect(order.get('01-02')).toBe(1);
    });

    it('非破壊性：呼び出し後も元の episodes/sections 配列の順序が変わらない', () => {
        const reversed: EpisodesData = [
            {
                id: 1, title: 'ep1', sections: [
                    { id: 2, published: true },
                    { id: 1, published: true },
                ],
            },
        ];
        const before = JSON.parse(JSON.stringify(reversed));
        buildSecOrderIndex(reversed);
        expect(reversed).toEqual(before);
    });

    it('複数 ep にまたがって連番が続く（ep2 の最初の公開 sec が ep1 の公開 sec 数と一致）', () => {
        const order = buildSecOrderIndex(EPISODES);
        expect(order.get('02-01')).toBe(2);
    });
});

describe('computeReadRatio', () => {
    it('order が空（全公開 sec 数 0）→ 0（ゼロ除算防止）', () => {
        expect(computeReadRatio(['01-01'], new Map())).toBe(0);
    });

    it('read が空 → 0', () => {
        const order = buildSecOrderIndex(EPISODES); // 公開 sec 3件
        expect(computeReadRatio([], order)).toBe(0);
    });

    it('端数は四捨五入する（1/3 → 33）', () => {
        const order = buildSecOrderIndex(EPISODES); // 公開 sec 3件（01-01, 01-02, 02-01）
        expect(computeReadRatio(['01-01'], order)).toBe(33);
    });

    it('全公開 sec が read 済み → 100', () => {
        const order = buildSecOrderIndex(EPISODES);
        expect(computeReadRatio(['01-01', '01-02', '02-01'], order)).toBe(100);
    });

    it('order に無いキー（非公開化・削除された sec の古い残留キー）は分子から除外する', () => {
        const order = buildSecOrderIndex(EPISODES); // 公開 sec 3件
        // '02-02' は EPISODES 上は未公開なので order に無い＝旧データ由来の不正キーとして扱われる
        expect(computeReadRatio(['01-01', '02-02'], order)).toBe(33);
    });
});

describe('computeFurthestPosition', () => {
    it('空配列 → -1', () => {
        const order = buildSecOrderIndex(EPISODES);
        expect(computeFurthestPosition([], order)).toBe(-1);
    });

    it('存在しないキーのみ → -1（無視される）', () => {
        const order = buildSecOrderIndex(EPISODES);
        expect(computeFurthestPosition(['99-99'], order)).toBe(-1);
    });

    it('有効・無効混在で最大値のみ拾う', () => {
        const order = buildSecOrderIndex(EPISODES);
        expect(computeFurthestPosition(['01-01', '99-99', '02-01'], order)).toBe(2);
    });
});

describe('send（window.gtag への結線）', () => {
    const SETTINGS = { fontSize: 'medium' as const, fontFamily: 'serif' as const, lineGap: 'on' as const, writingMode: 'horizontal' as const };

    beforeEach(() => {
        window.gtag = undefined;
    });
    afterEach(() => {
        vi.restoreAllMocks();
        window.gtag = undefined;
    });

    it('reader_snapshot イベントとして1回呼ぶ（パラメータ形状）', () => {
        const gtag = vi.fn();
        window.gtag = gtag;
        send(SETTINGS, 2, ['01-01'], ['01-01', '01-02'], EPISODES);

        expect(gtag).toHaveBeenCalledTimes(1);
        expect(gtag).toHaveBeenCalledWith('event', 'reader_snapshot', {
            font_size: 'medium',
            font_family: 'serif',
            line_gap: 'on',
            writing_mode: 'horizontal',
            story_stage: 2,
            read_ratio: 33, // 1/3 の四捨五入
            furthest_reached_position: 1, // '01-02' の通し番号
            furthest_read_position: 0, // '01-01' の通し番号
        });
    });

    it('window.gtag が未定義でも例外を投げない', () => {
        expect(() => send(SETTINGS, 1, [], [], EPISODES)).not.toThrow();
    });
});
