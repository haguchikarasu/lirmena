/*
 * suppression.ts
 * 【責務】記録の保留（要件 06-5）で使う「このページは最前線か」の判定。純関数。
 *         保留の記憶は core/record-hold.ts、組み合わせ（保留を付ける・解除する・抑止を設定する）は main.ts が持つ。
 * 【IF】
 *   isFrontier(ep, sec, read, autosave, story): boolean
 * 【依存】volumes.ts（「続きから読む」の地点と最大読破の次。stage と同じ順序を使うため）
 * 【被依存】main.ts／suppression.test.ts
 *
 * ── 最前線 ──
 * 最前線＝「続きから読む」の地点、または最大読破の次の公開 sec。
 * 読破がなければ「最大読破の次」はないので、読破もオートセーブもない読者は最初の公開 sec（地点）、
 * 読破がなくオートセーブがある読者は地点だけになる（読みかけの位置を守るため）。
 * 読破済みの範囲を外部リンクで開いた既読者は最前線でなく、札が出る（許容。要件 06-5）。
 */

import { nextSecAfterMaxRead, resolveResumePoint } from './volumes';
import type { SecKey, StoryData } from './types';

// このページ（ep/sec）が最前線か。
// isFrontier(ep: number, sec: number, read: SecKey[], autosave: { ep: number; sec: number; ratio: number } | null, story: StoryData): boolean
export function isFrontier(
    ep: number,
    sec: number,
    read: SecKey[],
    autosave: { ep: number; sec: number; ratio: number } | null,
    story: StoryData,
): boolean {
    const point = resolveResumePoint(read, autosave, story);
    if (point && point.ep === ep && point.sec === sec) return true;
    const next = nextSecAfterMaxRead(read, story);
    return next !== null && next.ep === ep && next.sec === sec;
}
