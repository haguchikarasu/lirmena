/*
 * analytics.ts
 * 責務: 読者の表示設定・読書進捗のスナップショットを GA4 カスタムイベント（reader_snapshot）として
 *       window.gtag 経由で送信する（副作用モジュール）。main.ts が本文ページのロード時に1回だけ呼ぶ。
 * export: send(settings, storyStage, read: SecKey[], reached: SecKey[], episodes: EpisodesData): void
 *         buildSecOrderIndex(episodes: EpisodesData): Map<SecKey, number>（テスト用に分離 export）
 *         computeReadRatio(read: SecKey[], order: Map<SecKey, number>): number（テスト用に分離 export）
 *         computeFurthestPosition(keys: SecKey[], order: Map<SecKey, number>): number（テスト用に分離 export）
 * 依存: なし（型のみ。types.ts の SecKey / EpisodesData を import。DOM・localStorage・fetch 非依存）
 *
 * Settings / StoryStage 型を import しない理由：
 *   settings.ts / volumes.ts はともにリーフモジュールで、リーフ同士の import は禁止
 *   （.dependency-cruiser.cjs の leaf-no-src-import ルール）。analytics.ts も main.ts からのみ使われる
 *   リーフとして設計するため、settings.ts の WritingMode ⇔ axis.ts の WritingMode と同じ方針
 *   （settings.ts コメント参照）で、構造的に同値な型をこのファイル内にローカル複製する。
 *   TypeScript の構造的型付けにより、呼び出し側（main.ts）は settings.getSettings() /
 *   computeStoryStage() の戻り値をそのまま渡せる。
 *
 * 送信するイベント：reader_snapshot（GA4 カスタムイベント）。パラメータは snake_case で1回にまとめて送る。
 *   font_size / font_family / line_gap / writing_mode … 表示設定4種
 *   story_stage                                       … 1〜5（呼び出し側が計算済みの値をそのまま渡す）
 *   read_ratio                                         … 0〜100 の整数。読了 sec 数 ÷ 全公開 sec 数を四捨五入。
 *                                                         分子は公開済み sec の通し番号 Map に実在する read キーのみを
 *                                                         数える（非公開化・削除された sec の古い localStorage 残留
 *                                                         キーを除外し、furthest_position と一貫させる）。全公開 sec 数
 *                                                         が 0 のときは 0 を返す（ゼロ除算防止）
 *   furthest_reached_position / furthest_read_position … 物語順（episodes 配列の並び順＝ep→sections id昇順）で
 *                                                         公開済み sec に 0 始まりの通し番号を振り、到達／読了の
 *                                                         各キーで最大値を求める。該当キーが1つも無ければ -1
 *
 * window.gtag の型宣言：TypeScript側にこれまで無かったため当ファイルで declare global する（any不使用）。
 *   実体の有無・?noga 等による無効化判定は本文シェルの gtag.js 導入インラインスクリプトが担う既存機構に
 *   委ね、当ファイルでは再実装しない（blockGA=true でも window.gtag は空撃ちになるだけで実害なし）。
 */

import type { SecKey, EpisodesData } from './types';

type SettingsSnapshot = {
    fontSize: 'large' | 'medium' | 'small';
    fontFamily: 'serif' | 'sans';
    lineGap: 'on' | 'off';
    writingMode: 'vertical' | 'horizontal';
};

type StoryStageValue = 1 | 2 | 3 | 4 | 5;

declare global {
    interface Window {
        gtag?: (...args: unknown[]) => void;
    }
}

const EVENT_NAME = 'reader_snapshot';

// send(settings, storyStage, read, reached, episodes): void
export function send(
    settings: SettingsSnapshot,
    storyStage: StoryStageValue,
    read: SecKey[],
    reached: SecKey[],
    episodes: EpisodesData
): void {
    const order = buildSecOrderIndex(episodes);
    const readRatio = computeReadRatio(read, order);
    const furthestRead = computeFurthestPosition(read, order);
    const furthestReached = computeFurthestPosition(reached, order);

    window.gtag?.('event', EVENT_NAME, {
        font_size: settings.fontSize,
        font_family: settings.fontFamily,
        line_gap: settings.lineGap,
        writing_mode: settings.writingMode,
        story_stage: storyStage,
        read_ratio: readRatio,
        furthest_reached_position: furthestReached,
        furthest_read_position: furthestRead,
    });
}

// episodes の並び順（＝物語順）で ep→sections（id 昇順）を走査し、published===true の sec にのみ
// 0 始まりの通し番号を振る。未公開 sec は番号を消費しない。引数を破壊しない（sort前にコピー）。
// buildSecOrderIndex(episodes: EpisodesData): Map<SecKey, number>
export function buildSecOrderIndex(episodes: EpisodesData): Map<SecKey, number> {
    const order = new Map<SecKey, number>();
    for (const ep of episodes) {
        const sections = [...ep.sections].sort((a, b) => a.id - b.id);
        for (const sec of sections) {
            if (!sec.published) continue;
            order.set(_secKey(ep.id, sec.id), order.size);
        }
    }
    return order;
}

// read のうち order（公開済み sec の通し番号 Map）に実在するキーだけを分子として数える（order に無いキー＝
// 非公開化・削除された sec の古い localStorage 残留キーは無視する。furthest_position と同じ思想）。
// order.size（＝全公開 sec 数）が 0 ならゼロ除算を避けて 0 を返す。
// computeReadRatio(read: SecKey[], order: Map<SecKey, number>): number
export function computeReadRatio(read: SecKey[], order: Map<SecKey, number>): number {
    if (order.size === 0) return 0;
    const validReadCount = read.filter(key => order.has(key)).length;
    return Math.round((validReadCount / order.size) * 100);
}

// computeFurthestPosition(keys: SecKey[], order: Map<SecKey, number>): number
export function computeFurthestPosition(keys: SecKey[], order: Map<SecKey, number>): number {
    let furthest = -1;
    for (const key of keys) {
        const idx = order.get(key);
        if (idx !== undefined && idx > furthest) furthest = idx;
    }
    return furthest;
}

// ep / sec から "01-02" 形式の SecKey を生成する（bookmark.ts の非 export な secKey() 相当を複製。
// bookmark はリーフで export していないため、キー形式のみ独立方針で複製する＝index.tsのwithQuery複製と同パターン）。
function _secKey(ep: number, sec: number): SecKey {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(ep)}-${pad(sec)}`;
}
