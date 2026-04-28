/*
 * settings.ts
 * 責務: フォントサイズ・フォント・段落間マージンの localStorage 保存・CSS変数反映・ポップアップ開閉
 * export: init(), open()
 * 依存: なし（栞・既読クリアのコールバックは main.ts から注入）
 *
 * 設定項目とデフォルト値（定数で定義）:
 *   fontSize:   "large" | "medium" | "small"   デフォルト "medium"
 *   fontFamily: "serif" | "sans"               デフォルト "serif"
 *   lineGap:    "large" | "medium" | "small"   デフォルト "medium"
 *
 * CSS変数:
 *   --font-size, --line-gap（値は CSS 変数定義ファイルで管理）
 */

// 設定を localStorage から復元し CSS 変数に反映する。
// onClearBookmarks / onClearRead は設定画面のクリアボタンに割り当てるコールバック。
// init(callbacks: { onClearBookmarks: () => void; onClearRead: () => void }): void

// 設定ポップアップを開く
// open(): void