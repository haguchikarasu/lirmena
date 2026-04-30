/*
 * bookmark.ts
 * 責務: 栞（最大3スロット）・既読シーンの localStorage 保存・復元・クリア
 * export: BookmarkEntry, init(), addBookmark(), getBookmarks(),
 *         recordSceneRead(), clearSlots(), clearRead()
 * 依存: なし
 *
 * BookmarkEntry:
 *   { address: SceneAddress; scrollY: number; savedAt: number }
 *
 * localStorage キー:
 *   "bookmarks"  : BookmarkEntry[]  最大3件、超過時は最古を削除
 *   "sceneRead"  : string[]         "ep-sec-scene" 形式（ゼロ埋め2桁）で既読シーンを記録
 *
 * セクション既読の判定は bookmark.ts の責務外。
 * 判定は index.html（目次ページ）のロード時に sceneRead データをもとに行う。
 */

import type { SceneAddress } from './types';

export type BookmarkEntry = {
    address: SceneAddress;
    scrollY: number;
    savedAt: number;
};

const MAX_SLOTS = 3;
const KEY_BOOKMARKS = 'bookmarks';
const KEY_SCENE_READ = 'sceneRead';

let _bookmarks: BookmarkEntry[] = [];
let _sceneRead: Set<string> = new Set();

// ep / sec / scene から "01-02-03" 形式のキーを生成する（既読シーン記録用）
function toSceneKey(ep: number, sec: number, scene: number): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(ep)}-${pad(sec)}-${pad(scene)}`;
}

// localStorage から栞・既読シーンを復元する。main.ts が起動時に一度だけ呼ぶ。
// init(): void
export function init(): void {
    try {
        const raw = localStorage.getItem(KEY_BOOKMARKS);
        if (raw) _bookmarks = JSON.parse(raw) as BookmarkEntry[];
    } catch {
        _bookmarks = [];
    }

    try {
        const raw = localStorage.getItem(KEY_SCENE_READ);
        if (raw) _sceneRead = new Set(JSON.parse(raw) as string[]);
    } catch {
        _sceneRead = new Set();
    }
}

// 現在の SceneAddress を栞に保存する。スクロール位置は window.scrollY から取得する（超過時は最古を削除）
// addBookmark(address: SceneAddress): void
export function addBookmark(address: SceneAddress): void {
    const scrollY = window.scrollY;
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

// forward 遷移が成立したシーンを即座に既読として localStorage に保存する。
// transition.ts が遷移先確定後に呼ぶ（scene 0 への遷移は除く）。
// recordSceneRead(ep: number, sec: number, scene: number): void
export function recordSceneRead(ep: number, sec: number, scene: number): void {
    const key = toSceneKey(ep, sec, scene);
    if (_sceneRead.has(key)) return;
    _sceneRead.add(key);
    localStorage.setItem(KEY_SCENE_READ, JSON.stringify([..._sceneRead]));
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
    _sceneRead = new Set();
    localStorage.removeItem(KEY_SCENE_READ);
}
