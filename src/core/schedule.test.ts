// @vitest-environment node
/*
 * core/schedule.test.ts
 * core/schedule.ts（目次の「次回の更新」）の仕様駆動テスト。
 * IF: nextScheduledAt(story: ScheduleStory, now: number): Date | null / formatScheduledAt(at: Date): string
 */

import { describe, expect, it } from 'vitest';
import { nextScheduledAt, formatScheduledAt, type ScheduleStory } from './schedule';

const STORY: ScheduleStory = [{
    episodes: [
        { sections: [{ published: true }, { published: false, scheduledAt: '2026-11-02T20:00+09:00' }] },
        { sections: [{ published: false, scheduledAt: '2026-11-09T20:00+09:00' }, { published: false }] },
    ],
}];
const at = (iso: string) => Date.parse(iso);

describe('nextScheduledAt — いまより後でいちばん早い予定', () => {
    it('いまより後の予定のうち最も早いもの', () => {
        expect(nextScheduledAt(STORY, at('2026-11-01T00:00+09:00'))?.toISOString()).toBe('2026-11-02T11:00:00.000Z');
    });

    it('予定を過ぎても未公開なら次の予定へ進む（古い予定を出し続けない）', () => {
        expect(nextScheduledAt(STORY, at('2026-11-02T20:00+09:00'))?.toISOString()).toBe('2026-11-09T11:00:00.000Z');
    });

    it('予定が一つも残っていなければ null（時計ごと出さない）', () => {
        expect(nextScheduledAt(STORY, at('2026-12-01T00:00+09:00'))).toBeNull();
        expect(nextScheduledAt([{ episodes: [{ sections: [{ published: true }] }] }], 0)).toBeNull();
    });

    it('公開済みの sec と読めない値は見ない', () => {
        const story: ScheduleStory = [{ episodes: [{ sections: [
            { published: true, scheduledAt: '2026-11-02T20:00+09:00' },
            { published: false, scheduledAt: 'あした' },
            { published: false, scheduledAt: '2026-11-03T20:00+09:00' },
        ] }] }];
        expect(nextScheduledAt(story, at('2026-11-01T00:00+09:00'))?.toISOString()).toBe('2026-11-03T11:00:00.000Z');
    });
});

describe('formatScheduledAt — 日本時間の「M/D（曜）HH:MM」', () => {
    it('日本時間で書く（UTC では前日でも日本の日付・曜日）', () => {
        expect(formatScheduledAt(new Date('2026-11-02T20:00+09:00'))).toBe('11/2（月）20:00');
        expect(formatScheduledAt(new Date('2026-11-01T23:30:00Z'))).toBe('11/2（月）08:30');
    });
});
