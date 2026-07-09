/*
 * state.test.ts
 * 対象: state.ts の戻る系ナビゲーション URL ヘルパー（getPrevUrl / getPrevAddress）＋ URL へのクエリ引き継ぎ（indexUrl ほか）
 * 方針: 期待値は要件 06-1 / 06-6・IF コメントから導出する（仕様駆動。実装ミラー禁止）。
 *   - getPrevUrl: 前の公開 sec があればその本文ページ／先頭公開 sec なら当 ep タイトルページ
 *   - getPrevAddress: 戻る遷移先が前 sec 本文のときの { ep, sec }（本文末着地フラグ書込用）／先頭 sec（＝タイトル遷移）は null
 * 環境: 戻る系は jsdom 不要（純粋なデータ計算）。クエリ引き継ぎテストは history.replaceState で location.search を設定し afterEach で空へ戻す。各テストは init() で _data/_current を再構築して隔離する。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { init, getPrevUrl, getPrevAddress, getPrevPublishedSec, indexUrl } from './state';
import type { EpisodesData } from './types';

// ep1: sec1,2,3 公開／sec4 未公開（末尾）。ep2: sec1 公開
const DATA: EpisodesData = [
    {
        id: 1,
        title: '太陽の行く先',
        sections: [
            { id: 1, published: true, end: false },
            { id: 2, published: true, end: false },
            { id: 3, published: true, end: false },
            { id: 4, published: false, end: false },
        ],
    },
    {
        id: 2,
        title: '丘の上の影',
        sections: [{ id: 1, published: true, end: false }],
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

// 仕様（計画・要件 06-5）：物語順で一つ前の公開 sec を返す。ep 境界を跨ぐ（先頭 sec は前 ep の最終公開 sec）。
// 未公開 sec はスキップ。外部流入抑止判定で「前 sec を読了しているか」の材料になる。
// 戻るナビ用の getPrevAddress とは責務が違う（getPrevAddress は ep 境界を跨がない）。
describe('getPrevPublishedSec（物語順の前 sec・ep 境界跨ぎ）', () => {
    it('同 ep 内に前公開 sec があればそれを返す', () => {
        init(DATA, { ep: 1, sec: 3 });
        expect(getPrevPublishedSec()).toEqual({ ep: 1, sec: 2 });
    });

    it('当 ep 先頭 sec なら前 ep の最終公開 sec を返す（ep 境界を跨ぐ）', () => {
        // ep2 の先頭 sec (sec1) の前は ep1 の最終公開 sec (sec3、sec4 は未公開でスキップ)
        init(DATA, { ep: 2, sec: 1 });
        expect(getPrevPublishedSec()).toEqual({ ep: 1, sec: 3 });
    });

    it('ep1 の先頭 sec は前が無いので null', () => {
        init(DATA, { ep: 1, sec: 1 });
        expect(getPrevPublishedSec()).toBeNull();
    });

    it('前 ep に公開 sec が無ければスキップして更に前を探す', () => {
        const data: EpisodesData = [
            { id: 1, title: 'a', sections: [{ id: 1, published: true, end: false }] },
            { id: 2, title: 'b', sections: [{ id: 1, published: false, end: false }] },
            { id: 3, title: 'c', sections: [{ id: 1, published: true, end: false }] },
        ];
        init(data, { ep: 3, sec: 1 });
        expect(getPrevPublishedSec()).toEqual({ ep: 1, sec: 1 });
    });

    it('getPrevAddress が null（当 ep 先頭 sec）でも getPrevPublishedSec は ep を跨いで返す', () => {
        init(DATA, { ep: 2, sec: 1 });
        expect(getPrevAddress()).toBeNull(); // 戻るナビは前 ep へまたがない
        expect(getPrevPublishedSec()).toEqual({ ep: 1, sec: 3 }); // 物語順は跨ぐ
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

// 仕様（計画 Context）：返す遷移先 URL は現在ページのクエリ文字列（例 ?noga＝GA 無効化フラグ）を
// そのまま末尾に引き継ぐ。マルチページ間でクエリを維持し、遷移先で GA が復活しないようにするため。
describe('クエリ引き継ぎ（_withQuery 経由・?noga 等を遷移先 URL に維持）', () => {
    afterEach(() => {
        // location.search を空へ戻し、他テスト（クエリ無し前提）へ波及させない
        window.history.replaceState(null, '', '/');
    });

    it('?noga 付きなら本文ページ URL にクエリを引き継ぐ', () => {
        window.history.replaceState(null, '', '/?noga');
        init(DATA, { ep: 1, sec: 3 });
        expect(getPrevUrl()).toBe('01-02.html?noga');
    });

    it('?noga 付きならタイトルページ URL にもクエリを引き継ぐ', () => {
        window.history.replaceState(null, '', '/?noga');
        init(DATA, { ep: 1, sec: 1 });
        expect(getPrevUrl()).toBe('01-00.html?noga');
    });

    it('?noga 付きなら目次 URL にもクエリを引き継ぐ', () => {
        window.history.replaceState(null, '', '/?noga');
        expect(indexUrl()).toBe('../index.html?noga');
    });

    it('クエリが無ければ URL は素のまま（従来挙動）', () => {
        window.history.replaceState(null, '', '/');
        init(DATA, { ep: 1, sec: 3 });
        expect(getPrevUrl()).toBe('01-02.html');
    });
});
