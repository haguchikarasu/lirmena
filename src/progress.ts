/*
 * progress.ts
 * 責務: sec 単位の進捗バーの表示。受動モジュール（自前でスクロールを購読せず、進捗率も自前計算しない dumb 表示）。
 * export: update(progress: number): void
 *         hide(): void
 * 依存: なし
 *
 * 進捗率（sec 単位・ページ＝sec をまたぐとリセット）:
 *   進捗率は bg.ts が本文領域基準で算出した連続値（0〜1・読書点が先頭テキスト→末尾テキストを走る量）を
 *   そのまま受け取って表示する。前後の恒久余白では bg 側で 0/1 に固定されるため、ここでは 0〜1 にクランプするのみ。
 *   素朴な |scrollLeft|÷range は本文前後の空白余白ぶん端で張り付くため使わない（bg.ts.computeProgress に集約）。
 *
 * 駆動は reader.ts（bg.ts のスクロール通知を受けて update(progress) を呼ぶ）。
 * タイトルページには進捗バー DOM が無いため呼ばれない。
 */

// reader.ts がスクロール通知ごとに呼ぶ。bg.ts が算出した進捗率（0〜1）をバーに反映する。
// update(progress: number): void
export function update(progress: number): void {
    const bar = document.getElementById('progress-bar');
    const fill = document.getElementById('progress-fill');
    if (!bar || !fill) return;

    const ratio = Math.min(1, Math.max(0, progress));

    bar.hidden = false;
    fill.style.width = `${(ratio * 100).toFixed(2)}%`;
}

// 進捗バーを隠す。
// hide(): void
export function hide(): void {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.hidden = true;
}
