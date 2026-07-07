/*
 * volumes.ts
 * 責務: 読者の read セットと volumes/episodes 定義から、物語進行段階（stage 1〜5）を算出する純関数を提供する。
 * export: type StoryStage = 1 | 2 | 3 | 4 | 5
 *         computeStoryStage(read: string[], volumes: VolumesData, episodes: EpisodesData): StoryStage
 * 依存: 型のみ（VolumesData / EpisodesData）。DOM・localStorage・fetch 非依存。純関数（引数を破壊しない）。
 *
 * 物語進行段階（stage）— A 案：各 vol の end sec を read で移行：
 *   1: 初期・何も完読していない（vol1 の end sec 未 read）
 *   2: vol1 の end sec を read（vol1 完読・vol2 開始）
 *   3: vol2 の end sec を read（vol2 完読）
 *   4: vol3 の end sec を read（vol3 完読）
 *   5: vol4 の end sec を read（vol4 完読・物語完結・エンディング色）
 *
 * end フィールド：
 *   episodes.json の各 sec は EpisodeSection.end: boolean を required で持つ（省略不可）。
 *   仕様は「1 vol につき end: true は 1 sec のみ」（各 vol の最終 sec）。
 *   実装は防御的に「その vol の全 end sec が read」で判定する（誤って複数付いても安全側で全部 read されるまで stage 上げない）。
 *   誤配置の runtime 検出は volumes.test.ts の schema 検証テストが担う。
 *
 * read キー形式：
 *   "EP-SEC" の2桁ゼロ埋め文字列（例 "01-02"）。types.ts の SecKey 型・bookmark.getRead() が返す形式と一致。
 *   不正キー（空文字・非形式）、volumes 定義に含まれない ep（範囲外）は無視する（防御的）。
 *
 * 順読要求：
 *   volumes を volume 昇順で走査し、途中で end sec 未 read の vol に当たったら break（それより後の vol は判定しない）。
 *   これにより「vol3 の end sec だけ read されて vol1/vol2 未完読」の場合 stage 1 のまま＝先取り移行を防ぐ。
 *
 * SNS 迷い込みの区別は当関数では扱わない：
 *   「順に読んでいる読者」と「SNS で end sec に迷い込んだ読者」の区別は main.ts の外部流入抑止ロジック
 *   （_isExternalEntry() && !_isResuming() → bookmark.setAutoRecordSuppressed(true) で recordRead が抑止される）
 *   が前段でゲートするため、当関数は read セットを素直に見るだけ（責務分離・要件 06-5）。
 *
 * 4vol＋読破の 5 段階固定：
 *   将来 vol5 以降が構想変更で追加された場合、当関数は volumes 昇順走査で自動対応する（コード変更不要）。
 *   ただし _base.css の --stage-6-color 追加、_progress.css の html[data-story-stage="6"] セレクタ追加、
 *   design/module-responsibilities.md / design/requirements/06-5-bookmark.html の追記が同時に必要。
 */

import type { VolumesData, EpisodesData } from './types';

// 物語進行段階の型。1〜5 の有限値のみ返る（number より狭い）。CLAUDE.md §3 汎用型回避。
export type StoryStage = 1 | 2 | 3 | 4 | 5;

// 各 vol の end sec を全 read で stage 移行する A 案の純関数。
// - volumes を volume 昇順で走査（引数は破壊せずコピー：[...volumes].sort(...)）
// - 各 vol について epRange 内で end: true の sec を集める
// - end sec が 0 個 → 未確定として break（それより後の vol も判定しない）
// - 全 end sec が read セットに含まれる → stage = vol.volume + 1、そうでなければ break
// - Math.min(stage, 5) で 5 を上限にクランプ
// computeStoryStage(read: string[], volumes: VolumesData, episodes: EpisodesData): StoryStage
export function computeStoryStage(
    read: string[],
    volumes: VolumesData,
    episodes: EpisodesData
): StoryStage {
    const readSet = new Set(read);

    // volumes をコピーしてから volume 昇順ソート（引数破壊禁止＝純関数保証）
    const sortedVols = [...volumes].sort((a, b) => a.volume - b.volume);

    let stage = 1;
    for (const vol of sortedVols) {
        // この vol の epRange 内で end: true の sec を集める（仕様は 1 個・実装は防御的に配列）
        const endSecKeys: string[] = [];
        for (const ep of episodes) {
            if (ep.id < vol.epRange[0] || ep.id > vol.epRange[1]) continue;
            for (const sec of ep.sections) {
                if (sec.end) endSecKeys.push(`${_pad2(ep.id)}-${_pad2(sec.id)}`);
            }
        }

        // end sec が 0 個 → 物語構造未確定 → break（それより後の vol も判定しない）
        if (endSecKeys.length === 0) break;

        // 全部が read されていなければ break（それより後の vol は未読とみなす＝順読要求）
        if (!endSecKeys.every(k => readSet.has(k))) break;

        // この vol は完読 → 次の stage へ進む
        stage = vol.volume + 1;
    }

    // 5 を上限にクランプ（4vol＋読破の 5 段階固定）
    return Math.min(stage, 5) as StoryStage;
}

function _pad2(n: number): string {
    return String(n).padStart(2, '0');
}
