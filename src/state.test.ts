/*
 * state.test.ts
 * 対象: state.ts の戻る系ナビゲーション URL ヘルパー（getPrevUrl / getPrevAddress）
 * 方針: 期待値は要件 06-1 / 06-6・IF コメントから導出する（仕様駆動。実装ミラー禁止）。
 *   - getPrevUrl: 前の公開 sec があればその本文ページ／先頭公開 sec なら当 ep タイトルページ
 *   - getPrevAddress: 戻る遷移先が前 sec 本文のときの { ep, sec }（本文末着地フラグ書込用）／先頭 sec（＝タイトル遷移）は null
 * 環境: jsdom 不要（純粋なデータ計算）。各テストは init() で _data/_current を再構築して隔離する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { init, getPrevUrl, getPrevAddress } from './state';
import type { EpisodesData } from './types';

// ep1: sec1,2,3 公開／sec4 未公開（末尾）。ep2: sec1 公開
const DATA: EpisodesData = [
    {
        id: 1,
        title: '太陽の行く先',
        sections: [
            { id: 1, published: true },
            { id: 2, published: true },
            { id: 3, published: true },
            { id: 4, published: false },
        ],
    },
    {
        id: 2,
        title: '丘の上の影',
        sections: [{ id: 1, published: true }],
    },
];

beforeEach(() => {
    init(DATA, { ep: 1, sec: 1 });
});

describe('getPrevUrl（戻るボタンの遷移先 URL）', () => {
    it('前の公開 sec がある → その本文ページ', () => {
        init(DATA, { ep: 1, sec: 3 });
        expect(getPrevUrl()).toBe('01-02.html');
    });

    it('当 ep 先頭 sec → 当 ep のタイトルページ', () => {
        init(DATA, { ep: 1, sec: 1 });
        expect(getPrevUrl()).toBe('01-00.html');
    });

    it('別 ep の先頭 sec → 当 ep のタイトルページ（前 ep には戻らない）', () => {
        init(DATA, { ep: 2, sec: 1 });
        expect(getPrevUrl()).toBe('02-00.html');
    });
});

describe('getPrevAddress（前 sec 本文末へ着地させる pendingScrollEnd 用）', () => {
    it('前の公開 sec がある → その { ep, sec } を返す', () => {
        init(DATA, { ep: 1, sec: 3 });
        expect(getPrevAddress()).toEqual({ ep: 1, sec: 2 });
    });

    it('当 ep 先頭 sec → null（遷移先はタイトルで本文末が無い）', () => {
        init(DATA, { ep: 1, sec: 1 });
        expect(getPrevAddress()).toBeNull();
    });

    it('別 ep の先頭 sec → null（前 ep へはまたがず、本文末着地もしない）', () => {
        init(DATA, { ep: 2, sec: 1 });
        expect(getPrevAddress()).toBeNull();
    });

    it('getPrevUrl が本文ページを返す sec では getPrevAddress も非 null（両者が一致した本文末着地になる）', () => {
        init(DATA, { ep: 1, sec: 2 });
        expect(getPrevUrl()).toBe('01-01.html');
        expect(getPrevAddress()).toEqual({ ep: 1, sec: 1 });
    });
});
