/*
 * bookmark.ts
 * 責務: 栞（最大3スロット）・既読 sec の localStorage 保存・復元・クリア
 * export: BookmarkEntry, init(), saveBookmark(), getBookmarks(), markRead(), clearSlots(), clearRead()
 * 依存: なし
 *
 * BookmarkEntry:
 *   { address: SceneAddress; scrollY: number; savedAt: number }
 *
 * localStorage キー:
 *   "bookmarks" : BookmarkEntry[]  最大3件、超過時は最古を削除
 *   "readSet"   : string[]         "ep-sec" 形式（ゼロ埋め2桁）で既読 sec を記録
 */

import type { SceneAddress } from './types';

export type BookmarkEntry = {
    address: SceneAddress;
    scrollY: number;
    savedAt: number;
};

const MAX_SLOTS = 3;
const KEY_BOOKMARKS = 'bookmarks';
const KEY_READ_SET = 'readSet';

let _bookmarks: BookmarkEntry[] = [];
let _readSet: Set<string> = new Set();

// SceneAddress の ep / sec から "01-02" 形式のキーを生成する（既読 sec 記録用）
function toSecKey(address: SceneAddress): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(address.ep)}-${pad(address.sec)}`;
}

// localStorage から栞・既読を復元する。main.ts が起動時に一度だけ呼ぶ。
// init(): void
export function init(): void {
    try {
        const raw = localStorage.getItem(KEY_BOOKMARKS);
        if (raw) _bookmarks = JSON.parse(raw) as BookmarkEntry[];
    } catch {
        _bookmarks = [];
    }

    try {
        const raw = localStorage.getItem(KEY_READ_SET);
        if (raw) _readSet = new Set(JSON.parse(raw) as string[]);
    } catch {
        _readSet = new Set();
    }
}

// 現在の SceneAddress とスクロール位置を栞に保存する（超過時は最古を削除）
// saveBookmark(address: SceneAddress, scrollY: number): void
export function saveBookmark(address: SceneAddress, scrollY: number): void {
    const entry: BookmarkEntry = { address: { ...address }, scrollY, savedAt: Date.now() };
    _bookmarks.push(entry);
    if (_bookmarks.length > MAX_SLOTS) {
        _bookmarks.sort((a, b) => a.savedAt - b.savedAt);
        _bookmarks.shift();
    }
    localStorage.setItem(KEY_BOOKMARKS, JSON.stringify(_bookmarks));
}

// 保存済み栞を全件返す。ジャンプは呼び出し元（menu.ts / index.html）が行う。
// getBookmarks(): BookmarkEntry[]
export function getBookmarks(): BookmarkEntry[] {
    return [..._bookmarks];
}

// 指定 SceneAddress の sec を既読としてマークする（scene 0 は transition.ts が呼ばない）
// markRead(address: SceneAddress): void
export function markRead(address: SceneAddress): void {
    const key = toSecKey(address);
    if (_readSet.has(key)) return;
    _readSet.add(key);
    localStorage.setItem(KEY_READ_SET, JSON.stringify([..._readSet]));
}

// 全栞を削除する
// clearSlots(): void
export function clearSlots(): void {
    _bookmarks = [];
    localStorage.removeItem(KEY_BOOKMARKS);
}

// 既読記録を全削除する
// clearRead(): void
export function clearRead(): void {
    _readSet = new Set();
    localStorage.removeItem(KEY_READ_SET);
}
