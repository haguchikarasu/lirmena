/*
 * bookmark.ts
 * 責務: 栞（最大3スロット）・既読の localStorage 保存・復元・クリア
 * export: BookmarkEntry, init(), saveBookmark(), loadBookmarks(), markRead(), clearSlots(), clearRead()
 * 依存: state.ts
 *
 * BookmarkEntry:
 *   { address: SceneAddress; scrollY: number; savedAt: number }
 *
 * localStorage キー:
 *   "bookmarks" : BookmarkEntry[]  最大3件、超過時は最古を削除
 *   "readSet"   : string[]         "ep-sec-scene" 形式
 */

// localStorage から栞・既読を復元する。main.ts が起動時に一度だけ呼ぶ。
// init(): void

// 現在の SceneAddress とスクロール位置を栞に保存する（超過時は最古を削除）
// saveBookmark(address: SceneAddress, scrollY: number): void

// 保存済み栞を全件返す
// loadBookmarks(): BookmarkEntry[]

// 指定 SceneAddress を既読としてマークする（scene 0 は transition.ts が呼ばない）
// markRead(address: SceneAddress): void

// 全栞を削除する
// clearSlots(): void

// 既読記録を全削除する
// clearRead(): void