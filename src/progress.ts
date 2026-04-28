/*
 * progress.ts
 * 責務: 進捗バーの計算・表示・スクロール監視
 * export: initProgress(), updateProgress(), hideProgress()
 * 依存: state.ts
 *
 * 計算式:
 *   シーン進捗率   = 読破済みシーンの合算行数 ÷ 全シーンの合算行数
 *   シーン内進捗率 = scrollTop ÷ (scrollHeight - clientHeight)
 *   進捗率         = シーン進捗率 + シーン内進捗率 × (現シーン行数 ÷ 全シーン合算行数)
 *
 * scene 0（タイトルカード）では hideProgress() と同等の動作をする。
 * 行数は Scene.lineCount（テキストファイル上の改行数）を使用する。
 */

// 全シーンの Scene[] を受け取り行数合計を事前計算・スクロール監視を開始する。
// sec ロード時に呼ぶ。
// initProgress(scenes: Scene[]): void

// 現在 scene インデックス（0 = タイトルカード）を渡して進捗バーを更新する。
// scene === 0 のとき hideProgress() と同等の動作をする。
// updateProgress(currentScene: number): void

// 進捗バーを非表示にする
// hideProgress(): void