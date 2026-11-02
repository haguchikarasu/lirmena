// @vitest-environment node
/*
 * core/storage.test.ts
 * core/storage.ts の移行条件・キー名・目次の表示用の読み出しを、DOM の無い環境（node）で確かめる。
 * core は document・要素に触らない層なので、ここが node で緑であること自体が層の約束の確認になる
 * （localStorage は使ってよい＝下の memoryStorage を globalThis に差し込む）。
 * 栞・オートセーブ・既読の細かい挙動は bookmark.test.ts（jsdom・bookmark.ts の再 export 経由）が見ている。
 * ここで固定するのは移行と既読の消去の約束（栞・既読の移行を core へ移したとき、読者のデータが静かに壊れないように）：
 *   - 旧 sceneRead の変換は schemaVersion が無いときだけ走る（版数が古いだけでは走らない）
 *   - キー名（reached / read / sceneRead / schemaVersion / bookmarks）を変えない
 *   - 既読・読破を消したあと再読み込み（init のやり直し）しても復活しない
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as storage from './storage';

// Storage の最小実装（node には localStorage が無い）。
function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() { return map.size; },
        clear: () => map.clear(),
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => { map.delete(k); },
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
    };
}

const json = (k: string): unknown => {
    const raw = localStorage.getItem(k);
    return raw === null ? null : JSON.parse(raw);
};

beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('core/storage — DOM の無い環境で動く', () => {
    it('document が無い（node 環境で走っている）', () => {
        expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    });
});

describe('旧 sceneRead の移行条件', () => {
    it('schemaVersion が無いときだけ sceneRead を reached / read に変換し、版数を 5 にする', () => {
        localStorage.setItem('sceneRead', JSON.stringify(['01-01-00', '01-02-03']));
        storage.init();
        expect(new Set(json('reached') as string[])).toEqual(new Set(['01-01', '01-02']));
        expect(json('read')).toEqual(['01-01']);
        expect(localStorage.getItem('schemaVersion')).toBe('5');
        // sceneRead は変換後も残す（冪等・復旧のため）
        expect(json('sceneRead')).toEqual(['01-01-00', '01-02-03']);
    });

    it('schemaVersion が古い版（4）なら sceneRead は変換しない', () => {
        localStorage.setItem('schemaVersion', '4');
        localStorage.setItem('sceneRead', JSON.stringify(['01-01-00']));
        storage.init();
        expect(localStorage.getItem('reached')).toBeNull();
        expect(localStorage.getItem('read')).toBeNull();
        expect(storage.getReached()).toEqual([]);
        expect(localStorage.getItem('schemaVersion')).toBe('5');
    });

    it('移行済み（5）なら何もしない', () => {
        localStorage.setItem('schemaVersion', '5');
        localStorage.setItem('sceneRead', JSON.stringify(['01-01-00']));
        storage.init();
        expect(localStorage.getItem('reached')).toBeNull();
    });
});

describe('既読・読破を消したあと再読み込みしても復活しない', () => {
    it('clearReached → init のやり直しで、到達はキャッシュにも表示用の読み出しにも戻らない', () => {
        localStorage.setItem('sceneRead', JSON.stringify(['01-01-00', '01-02-03']));
        storage.init();
        storage.clearReached();
        storage.init();
        expect(storage.getReached()).toEqual([]);
        expect(storage.loadReachedKeys()).toEqual(new Set());
        expect(localStorage.getItem('sceneRead')).toBeNull();
    });

    it('clearRead → init のやり直しで、読破もキャッシュにも表示用の読み出しにも戻らない', () => {
        localStorage.setItem('sceneRead', JSON.stringify(['01-01-00']));
        storage.init();
        storage.clearRead();
        storage.init();
        expect(storage.getRead()).toEqual([]);
        expect(storage.loadReadKeys()).toEqual(new Set());
    });
});

describe('キー名を変えない', () => {
    it('到達・読了・栞は reached / read / bookmarks に書く', () => {
        storage.init();
        storage.recordRead(1, 2);
        storage.recordReachedAfterword(1);
        storage.addBookmark({ ep: 1, sec: 2, scene: 0 }, 0.5, 2);
        expect(json('read')).toEqual(['01-02']);
        expect(new Set(json('reached') as string[])).toEqual(new Set(['01-02', 'vol01-af']));
        expect((json('bookmarks') as Array<{ slot: number }>)[0].slot).toBe(2);
    });
});

describe('栞をすべて消す', () => {
    it('clearAllBookmarks は手動の栞とオートセーブ（本編・あとがき）を消し、既読・読破は残す', () => {
        localStorage.setItem('schemaVersion', '5');
        storage.init();
        localStorage.setItem('bookmarks', JSON.stringify([{ slot: 1, ep: 1, sec: 1, scene: 1, ratio: 0.3, savedAt: 100 }]));
        localStorage.setItem('autosave', JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }));
        localStorage.setItem('autosaveAfterword', JSON.stringify({ vol: 1, ratio: 0.2, savedAt: 200 }));
        localStorage.setItem('read', JSON.stringify(['01-01']));
        localStorage.setItem('reached', JSON.stringify(['01-01']));
        storage.clearAllBookmarks();
        expect(localStorage.getItem('bookmarks')).toBeNull();
        expect(storage.getLatestAutoSave()).toBeNull();
        expect(json('read')).toEqual(['01-01']);
        expect(json('reached')).toEqual(['01-01']);
    });

    it('clearSlots は手動の栞だけを消す（オートセーブは残る）', () => {
        localStorage.setItem('bookmarks', JSON.stringify([{ slot: 1, ep: 1, sec: 1, scene: 1, ratio: 0.3, savedAt: 100 }]));
        localStorage.setItem('autosave', JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }));
        storage.clearSlots();
        expect(localStorage.getItem('bookmarks')).toBeNull();
        expect(storage.getLatestAutoSave()).not.toBeNull();
    });
});

describe('目次の表示用の読み出し', () => {
    it('loadReachedKeys / loadReadKeys は毎回 localStorage を読み直し、旧 sceneRead の完了マーカーも足す', () => {
        localStorage.setItem('schemaVersion', '5');
        storage.init();
        localStorage.setItem('read', JSON.stringify(['02-01']));
        localStorage.setItem('sceneRead', JSON.stringify(['01-01-00', '01-02-05']));
        expect(storage.loadReadKeys()).toEqual(new Set(['02-01', '01-01']));
        expect(storage.loadReachedKeys()).toEqual(new Set(['01-01']));
    });

    it('getLatestAutoSave は本編とあとがきのうち新しい方を返す（同時刻は本編）', () => {
        expect(storage.getLatestAutoSave()).toBeNull();
        localStorage.setItem('autosave', JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }));
        localStorage.setItem('autosaveAfterword', JSON.stringify({ vol: 1, ratio: 0.2, savedAt: 200 }));
        expect(storage.getLatestAutoSave()).toEqual({ kind: 'afterword', vol: 1, ratio: 0.2, savedAt: 200 });
        localStorage.setItem('autosaveAfterword', JSON.stringify({ vol: 1, ratio: 0.2, savedAt: 100 }));
        expect(storage.getLatestAutoSave()).toEqual({ kind: 'sec', ep: 1, sec: 2, ratio: 0.4, savedAt: 100 });
    });

    it('getBookmarksWithSlots は未割当の栞に savedAt 昇順で空きスロットを割り当てる（保存はしない）', () => {
        const raw = JSON.stringify([
            { slot: 2, ep: 1, sec: 1, scene: 0, ratio: 0, savedAt: 300 },
            { ep: 1, sec: 2, scene: 0, ratio: 0, savedAt: 200 },
            { ep: 1, sec: 3, scene: 0, ratio: 0, savedAt: 100 },
        ]);
        localStorage.setItem('bookmarks', raw);
        const bySec = Object.fromEntries(storage.getBookmarksWithSlots().map((b) => [b.sec, b.slot]));
        expect(bySec).toEqual({ 1: 2, 3: 1, 2: 3 });
        expect(localStorage.getItem('bookmarks')).toBe(raw);
    });

    it('removeBookmark は指定スロットだけを消し、0 件になったらキーごと消す', () => {
        storage.init();
        storage.addBookmark({ ep: 1, sec: 1, scene: 0 }, 0, 1);
        storage.addBookmark({ ep: 1, sec: 2, scene: 0 }, 0, 3);
        storage.removeBookmark(1);
        expect((json('bookmarks') as Array<{ slot: number }>).map((b) => b.slot)).toEqual([3]);
        storage.removeBookmark(3);
        expect(localStorage.getItem('bookmarks')).toBeNull();
    });

    it('afterwordKey は vol を 2 桁にした "volNN-af"', () => {
        expect(storage.afterwordKey(1)).toBe('vol01-af');
        expect(storage.afterwordKey(12)).toBe('vol12-af');
    });
});
