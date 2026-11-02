/*
 * core/schedule.ts
 * 責務: 目次に出す「次回の更新」を story.json の scheduledAt から選び、表示用の文字にする（要件 06-7・03-structure）。
 *       scheduledAt は未公開の sec にだけ書ける ISO 8601・日本時間の文字列（例 "2026-11-02T20:00+09:00"。
 *       公開済みの sec に書くと story-integrity が止める）。
 * export: nextScheduledAt(story: ScheduleStory, now: number): Date | null
 *         formatScheduledAt(at: Date): string   — 例 "11/2（月）20:00"（日本時間）
 * 依存: なし（DOM / localStorage 非依存の純関数）。呼び出し元：目次 index.ts（ヒーローの下の行・右カラムの「最新」）。
 */

// ScheduleStory: 判定に要るフィールドだけ（types.ts の StoryData と構造的に互換）
export type ScheduleStory = ReadonlyArray<{
    episodes: ReadonlyArray<{ sections: ReadonlyArray<{ published: boolean; scheduledAt?: string }> }>;
}>;

// nextScheduledAt(story: ScheduleStory, now: number): Date | null
// 未公開の sec の scheduledAt のうち、now（ミリ秒）より後でいちばん早いもの。無ければ null（＝時計ごと出さない）。
// 過ぎた予定は選ばない＝予定の時刻を過ぎてもまだ公開していないときは、その次の予定を出す（古い予定を出し続けない）。
// 読めない値（形式違反）は飛ばす（形式は story-integrity がビルドで見る）。
export function nextScheduledAt(story: ScheduleStory, now: number): Date | null {
    let best: number | null = null;
    for (const vol of story) {
        for (const ep of vol.episodes) {
            for (const sec of ep.sections) {
                if (sec.published || typeof sec.scheduledAt !== 'string') continue;
                const t = Date.parse(sec.scheduledAt);
                if (Number.isNaN(t) || t <= now) continue;
                if (best === null || t < best) best = t;
            }
        }
    }
    return best === null ? null : new Date(best);
}

const _FMT = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// formatScheduledAt(at: Date): string — "M/D（曜）HH:MM"。読者の端末の時間帯ではなく日本時間で書く
// （scheduledAt を日本時間で書く運用なので、海外の端末でも作者の告知と同じ時刻に見せる）
export function formatScheduledAt(at: Date): string {
    const p = Object.fromEntries(_FMT.formatToParts(at).map((x) => [x.type, x.value]));
    return `${p.month}/${p.day}（${p.weekday}）${p.hour}:${p.minute}`;
}
