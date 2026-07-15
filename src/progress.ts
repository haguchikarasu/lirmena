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
 * 塗り色:
 *   進捗バーの塗り色は CSS 側で解決する（当モジュールは触らない）。update() は #progress-fill の width（%）のみ書き込む。
 *   実際の色は _base.css の --progress-fill-color = hsl(var(--stage-hue) var(--stage-saturation) var(--stage-lightness))。
 *   --stage-hue は _base.css 末尾の html[data-story-stage="N"] { --stage-hue: var(--stage-N-hue); } で切り替わり、
 *   同じ --stage-hue が toc.css の --idx-accent／_tutorial.css の --tut-accent 等にも波及する（一元化）。
 *   stage の算出は volumes.ts の computeStoryStage、DOM 属性 <html data-story-stage> の付与は main.ts / src/index.ts、
 *   次回ロード時の FOUC 回避は本文シェル雛形の <head> 早期スクリプトが localStorage 'lirmena.storyStage' から先付ける。
 *   当モジュールは stage も色も知らない（受動表示の徹底）。
 *
 * 駆動は reader.ts（bg.ts のスクロール通知を受けて update(progress) を呼ぶ）。
 * タイトルページには進捗バー DOM が無いため呼ばれない。
 *
 * 【運用注記】現行の物語構成は 4vol＋読破の 5 段階固定。将来 vol5 以降が追加される場合は _base.css に
 * --stage-6-hue と末尾セレクタ html[data-story-stage="6"] { --stage-hue: var(--stage-6-hue); } を追加、
 * volumes.ts の StoryStage 型・判定関数調整が同時に必要（当ファイルは変更不要）。
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
