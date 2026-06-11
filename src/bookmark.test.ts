/*
 * bookmark.test.ts
 * 対象: bookmark.ts の init() が行う旧データ移行
 *   - 旧 sceneRead（"ep-sec-scene"）→ reached / read（sec 単位）
 *   - 旧 nested 栞（{ address }）→ flat 栞
 * 方針: 期待値は実装ではなく「IFコメント＋移行ルール（plan）」から導出する（仕様駆動。実装をなぞらない）。
 *   - 完了マーカー "ep-sec-00" → 当 sec を read（＋reached）
 *   - "ep-sec-XX"(XX≥01)      → 当 sec を reached のみ
 *   - 移行は schemaVersion!=='2' のときだけ1回。旧 sceneRead キーは保持。
 * 環境: jsdom（localStorage を使用）。各テストは localStorage.clear() で隔離する
 *   （init() が module 内 state を localStorage から再構築するため、これでクリーンに戻る）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { init, getReached, getRead, getBookmarks } from './bookmark';

const seed = (key: string, value: unknown) =>
    localStorage.setItem(key, JSON.stringify(value));

beforeEach(() => {
    localStorage.clear();
});

describe('旧 sceneRead → 到達/読了 の移行', () => {
    it('完了マーカー "ep-sec-00" は read と reached の両方に入る', () => {
        seed('sceneRead', ['01-01-00']);
        init();
        expect(getRead()).toContain('01-01');
        expect(getReached()).toContain('01-01');
    });

    it('scene≥01（"ep-sec-XX"）は reached のみで read には入らない', () => {
        seed('sceneRead', ['01-02-03']);
        init();
        expect(getReached()).toContain('01-02');
        expect(getRead()).not.toContain('01-02');
        expect(getRead()).toEqual([]);
    });

    it('完了マーカーと途中到達が混在しても sec 単位で正しく振り分ける', () => {
        seed('sceneRead', ['01-01-00', '01-02-05', '02-01-00']);
        init();
        expect(getReached().sort()).toEqual(['01-01', '01-02', '02-01']);
        expect(getRead().sort()).toEqual(['01-01', '02-01']);
    });

    it('3セグメントでない不正キーは無視する', () => {
        seed('sceneRead', ['01-01', '01-01-02-03', '']);
        init();
        expect(getReached()).toEqual([]);
        expect(getRead()).toEqual([]);
    });

    it('既存の新スキーマ reached に union する（上書きしない）', () => {
        seed('reached', ['03-01']);
        seed('sceneRead', ['01-01-00']);
        init();
        expect(getReached().sort()).toEqual(['01-01', '03-01']);
        expect(getRead()).toEqual(['01-01']);
    });

    it('旧 sceneRead キーは移行後も削除せず保持する', () => {
        seed('sceneRead', ['01-01-00']);
        init();
        expect(localStorage.getItem('sceneRead')).not.toBeNull();
    });
});

describe('移行は一度だけ（schemaVersion 番兵）', () => {
    it('移行後に schemaVersion=2 を立てる', () => {
        seed('sceneRead', ['01-01-00']);
        init();
        expect(localStorage.getItem('schemaVersion')).toBe('2');
    });

    it('すでに schemaVersion=2 のユーザーには移行を走らせない', () => {
        localStorage.setItem('schemaVersion', '2');
        seed('sceneRead', ['01-01-00']);
        init();
        expect(getReached()).toEqual([]);
        expect(getRead()).toEqual([]);
    });

    it('移行済みなら、後から増えた旧 sceneRead を再移行しない', () => {
        seed('sceneRead', ['01-01-00']);
        init(); // 1回目: 移行して schemaVersion=2
        // 旧キーに後から1件足し、新スキーマ側を空に戻して「再移行されない」ことを観測可能にする
        seed('sceneRead', ['01-01-00', '09-09-09']);
        localStorage.removeItem('reached');
        init(); // 2回目: schemaVersion=2 なので移行はスキップされる
        expect(getReached()).not.toContain('09-09');
    });
});

describe('旧 nested 栞 → flat 正規化', () => {
    it('nested 栞は flat 化し、互換性のない旧 scrollLeft は 0 に落として scene を引き継ぐ', () => {
        seed('bookmarks', [{ address: { ep: 1, sec: 2, scene: 3 }, scrollLeft: 999, savedAt: 100 }]);
        init();
        expect(getBookmarks()).toEqual([{ ep: 1, sec: 2, scene: 3, scrollLeft: 0, savedAt: 100 }]);
    });

    it('新 flat 栞は scrollLeft を保持する', () => {
        seed('bookmarks', [{ ep: 1, sec: 2, scene: 3, scrollLeft: 500, savedAt: 100 }]);
        init();
        expect(getBookmarks()[0].scrollLeft).toBe(500);
    });

    it('不正な栞要素（null・ep/sec 欠落）は除外する', () => {
        seed('bookmarks', [null, { foo: 'bar' }, { ep: 1, sec: 1, scene: 0, scrollLeft: 10, savedAt: 5 }]);
        init();
        expect(getBookmarks()).toHaveLength(1);
    });
});
