/*
 * bookmark.test.ts
 * 対象: bookmark.ts の init() が行う旧データ移行と、栞の固定スロット保存
 *   - 旧 sceneRead（"ep-sec-scene"）→ reached / read（sec 単位）
 *   - 旧 nested 栞（{ address }）→ flat 栞／旧 flat（slot 無し）→ slot 採番
 *   - addBookmark(address, scrollLeft, slot)：固定スロット（1..3）へ上書き保存
 * 方針: 期待値は実装ではなく「IFコメント＋移行ルール（plan）」から導出する（仕様駆動。実装をなぞらない）。
 *   - 完了マーカー "ep-sec-00" → 当 sec を read（＋reached）
 *   - "ep-sec-XX"(XX≥01)      → 当 sec を reached のみ
 *   - 移行は schemaVersion!=='3' のときだけ1回。旧 sceneRead キーは保持。
 *   - 旧 flat 栞の slot 未割当は savedAt 昇順に 1,2,3 を採番。
 * 環境: jsdom（localStorage を使用）。各テストは localStorage.clear() で隔離する
 *   （init() が module 内 state を localStorage から再構築するため、これでクリーンに戻る）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    init, getReached, getRead, getBookmarks,
    setAutoRecordSuppressed, recordReached, recordRead, saveAutoSave, getAutoSave, addBookmark,
} from './bookmark';
import type { SceneAddress } from './types';

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
    it('移行後に schemaVersion=3 を立てる', () => {
        seed('sceneRead', ['01-01-00']);
        init();
        expect(localStorage.getItem('schemaVersion')).toBe('3');
    });

    it('すでに schemaVersion=3 のユーザーには移行を走らせない', () => {
        localStorage.setItem('schemaVersion', '3');
        seed('sceneRead', ['01-01-00']);
        init();
        expect(getReached()).toEqual([]);
        expect(getRead()).toEqual([]);
    });

    it('移行済みなら、後から増えた旧 sceneRead を再移行しない', () => {
        seed('sceneRead', ['01-01-00']);
        init(); // 1回目: 移行して schemaVersion=3
        // 旧キーに後から1件足し、新スキーマ側を空に戻して「再移行されない」ことを観測可能にする
        seed('sceneRead', ['01-01-00', '09-09-09']);
        localStorage.removeItem('reached');
        init(); // 2回目: schemaVersion=3 なので移行はスキップされる
        expect(getReached()).not.toContain('09-09');
    });
});

describe('自動記録の抑止（外部サイト/直接アクセス）', () => {
    // 仕様: setAutoRecordSuppressed(true) の間、到達・読了・オートセーブの自動記録は no-op になる。
    //   栞追加（明示操作）は抑止対象外。init() は抑止を false に戻す。
    const addr: SceneAddress = { ep: 1, sec: 2, scene: 3 };

    it('抑止中は recordReached / recordRead / saveAutoSave が何も記録しない', () => {
        init();
        setAutoRecordSuppressed(true);
        recordReached(1, 1);
        recordRead(2, 1);
        saveAutoSave(3, 1, 100);
        expect(getReached()).toEqual([]);
        expect(getRead()).toEqual([]);
        expect(getAutoSave()).toBeNull();
    });

    it('抑止を解除すると通常どおり記録する', () => {
        init();
        setAutoRecordSuppressed(true);
        recordReached(1, 1);
        setAutoRecordSuppressed(false);
        recordReached(1, 1);
        saveAutoSave(1, 1, 50);
        expect(getReached()).toContain('01-01');
        expect(getAutoSave()).toMatchObject({ ep: 1, sec: 1, scrollLeft: 50 });
    });

    it('抑止中でも栞追加（明示操作）は保存される', () => {
        init();
        setAutoRecordSuppressed(true);
        addBookmark(addr, 200, 1);
        expect(getBookmarks()).toHaveLength(1);
        expect(getBookmarks()[0]).toMatchObject({ slot: 1, ep: 1, sec: 2, scene: 3, scrollLeft: 200 });
    });

    it('init() は抑止フラグを false に戻す（前ページの抑止を持ち越さない）', () => {
        setAutoRecordSuppressed(true);
        init(); // 新しいページのロード相当
        recordReached(5, 5);
        expect(getReached()).toContain('05-05');
    });
});

describe('旧 nested 栞 → flat 正規化', () => {
    it('nested 栞は flat 化し、互換性のない旧 scrollLeft は 0 に落として scene を引き継ぎ、slot 1 を採番する', () => {
        seed('bookmarks', [{ address: { ep: 1, sec: 2, scene: 3 }, scrollLeft: 999, savedAt: 100 }]);
        init();
        expect(getBookmarks()).toEqual([{ slot: 1, ep: 1, sec: 2, scene: 3, scrollLeft: 0, savedAt: 100 }]);
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

describe('旧 flat 栞 → slot 採番（移行）', () => {
    it('slot 無しの複数栞に savedAt 昇順で 1,2,3 を採番する', () => {
        seed('bookmarks', [
            { ep: 1, sec: 1, scene: 0, scrollLeft: 0, savedAt: 300 },
            { ep: 2, sec: 1, scene: 0, scrollLeft: 0, savedAt: 100 },
            { ep: 3, sec: 1, scene: 0, scrollLeft: 0, savedAt: 200 },
        ]);
        init();
        const bySaved = new Map(getBookmarks().map(b => [b.savedAt, b.slot]));
        expect(bySaved.get(100)).toBe(1);
        expect(bySaved.get(200)).toBe(2);
        expect(bySaved.get(300)).toBe(3);
    });

    it('既に有効な slot を持つ栞はその番号を尊重し、未割当はその空きを避けて採番する', () => {
        seed('bookmarks', [
            { slot: 2, ep: 1, sec: 1, scene: 0, scrollLeft: 0, savedAt: 100 },
            { ep: 2, sec: 1, scene: 0, scrollLeft: 0, savedAt: 200 },
        ]);
        init();
        const bySaved = new Map(getBookmarks().map(b => [b.savedAt, b.slot]));
        expect(bySaved.get(100)).toBe(2); // 既存 slot を尊重
        expect(bySaved.get(200)).toBe(1); // 空いている最小スロット
    });
});

describe('固定スロットへの保存（addBookmark）', () => {
    const addr = (ep: number, sec: number): SceneAddress => ({ ep, sec, scene: 0 });

    it('指定スロットに slot 付きで保存する', () => {
        init();
        addBookmark(addr(1, 2), 100, 2);
        expect(getBookmarks()).toEqual([
            { slot: 2, ep: 1, sec: 2, scene: 0, scrollLeft: 100, savedAt: expect.any(Number) },
        ]);
    });

    it('同じスロットへの再保存は上書きする（件数は増えない）', () => {
        init();
        addBookmark(addr(1, 1), 10, 1);
        addBookmark(addr(2, 3), 20, 1);
        const list = getBookmarks();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ slot: 1, ep: 2, sec: 3, scrollLeft: 20 });
    });

    it('別スロットは共存する（最大3件）', () => {
        init();
        addBookmark(addr(1, 1), 10, 1);
        addBookmark(addr(1, 2), 20, 2);
        addBookmark(addr(1, 3), 30, 3);
        expect(getBookmarks().map(b => b.slot).sort()).toEqual([1, 2, 3]);
    });
});
