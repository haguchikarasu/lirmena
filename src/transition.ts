/*
 * transition.ts
 * 責務: 進む／戻るトリガーを受けて暗転→差し替え→背景切替→ボタン更新→進捗更新→フェードインを順次実行。多重起動防止
 * export: goForward(), goBack()
 * 依存: state.ts, renderer.ts, bg.ts, progress.ts, nav.ts, bookmark.ts
 */
