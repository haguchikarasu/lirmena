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

describe('記録の消去の範囲（要件 06-4）', () => {
    const seedAll = () => {
        localStorage.setItem('schemaVersion', '5');
        storage.init();
        localStorage.setItem('bookmarks', JSON.stringify([{ slot: 1, ep: 1, sec: 1, scene: 1, ratio: 0.3, savedAt: 100 }]));
        localStorage.setItem('autosave', JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }));
        localStorage.setItem('read', JSON.stringify(['01-01']));
        localStorage.setItem('reached', JSON.stringify(['01-01']));
    };

    it('「栞をすべて消す」は手動の栞だけを消す（オートセーブ・既読・読破は残る）', () => {
        seedAll();
        storage.clearAllBookmarks();
        expect(localStorage.getItem('bookmarks')).toBeNull();
        expect(storage.getAutoSave()).not.toBeNull();
        expect(json('read')).toEqual(['01-01']);
        expect(json('reached')).toEqual(['01-01']);
    });

    it('「読破を消す」は読破とオートセーブを消す（手動の栞・既読は残る）', () => {
        seedAll();
        storage.clearRead();
        expect(localStorage.getItem('read')).toBeNull();
        expect(storage.getAutoSave()).toBeNull();
        expect(localStorage.getItem('bookmarks')).not.toBeNull();
        expect(json('reached')).toEqual(['01-01']);
    });

    it('「既読を消す」は既読だけを消す', () => {
        seedAll();
        storage.clearReached();
        expect(localStorage.getItem('reached')).toBeNull();
        expect(storage.getAutoSave()).not.toBeNull();
        expect(json('read')).toEqual(['01-01']);
        expect(localStorage.getItem('bookmarks')).not.toBeNull();
    });
});

describe('あとがきの位置の廃止（要件 06-5）', () => {
    const list = [1, 2, 3].map((slot) => ({ slot, ep: 1, sec: 1, scene: 1, ratio: slot / 10, savedAt: 100 + slot }));

    it('旧キーは init() で版数に関係なく消える', () => {
        localStorage.setItem('schemaVersion', '5');
        localStorage.setItem('autosaveAfterword', JSON.stringify({ vol: 1, ratio: 0.2, savedAt: 200 }));
        localStorage.setItem('pendingJumpAfterword', JSON.stringify({ vol: 1, ratio: 0.2 }));
        storage.init();
        expect(localStorage.getItem('autosaveAfterword')).toBeNull();
        expect(localStorage.getItem('pendingJumpAfterword')).toBeNull();
    });

    it('版数を上げない：版数 5 の読者の栞とオートセーブの位置（ratio）を保つ', () => {
        // 版数を上げると _migrate が再実行され、栞とオートセーブの位置が ratio=0 に落ちる
        localStorage.setItem('schemaVersion', '5');
        localStorage.setItem('bookmarks', JSON.stringify(list));
        localStorage.setItem('autosave', JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }));
        storage.init();
        expect(localStorage.getItem('schemaVersion')).toBe('5');
        expect(json('bookmarks')).toEqual(list);
        expect(storage.getAutoSave()).toMatchObject({ ep: 1, sec: 2, ratio: 0.4 });
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
