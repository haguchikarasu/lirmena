/*
 * volumes.ts
 * 責務: 読者の read セットと story.json 定義から、物語進行段階（stage 1〜5）を算出する純関数を提供する。
 * export: type StoryStage = 1 | 2 | 3 | 4 | 5
 *         computeStoryStage(read: SecKey[], story: StoryData): StoryStage
 * 依存: 型のみ（StoryData / Volume / SecKey）。DOM・localStorage・fetch 非依存。純関数（引数を破壊しない）。
 *
 * 物語進行段階（stage 1〜5）— 最大読破位置ベース：
 *   1: 初期。vol1 の最終公開 sec に達していない
 *   2: vol1 の最終公開 sec に達している かつ vol2 冒頭 sec が公開済み
 *   3: vol2 の最終公開 sec に達している かつ vol3 冒頭 sec が公開済み
 *   4: vol3 の最終公開 sec に達している かつ vol4 冒頭 sec が公開済み
 *   5: vol4（＝最終 vol）の最終公開 sec に達している（次巻がないため自動的に stage 5＝物語完結）
 *
 * 判定アルゴリズム：
 *   1. 全 vol を volume 昇順で走査し、公開済み本文 sec に「物語順の通し番号」を振る（あとがきキーは除外）。
 *      未公開 sec は通し番号を消費しない＝maxReadPos が公開範囲を超えて過大評価されない。
 *   2. read セット内の各キーを通し番号 Map で解決し、最大値 maxReadPos を得る。
 *      本文 sec 用 regex /^\d{2}-\d{2}$/ にマッチするキーだけを扱う＝あとがきキー "vol01-af" 等は無視する。
 *   3. 各 vol について「最終公開 sec の通し番号」と「次巻冒頭 ep の sec1 が公開済みか」を判定：
 *      ・当 vol の最終公開 sec が存在しない or maxReadPos がそれ未満 → break（未到達）
 *      ・次巻がある場合、次巻の epRange[0] の sec1 が未公開 → break（次巻公開待ち）
 *      ・次巻がない（最終 vol）→ stage は volume + 1
 *   4. 上限 Math.min(stage, story.length + 1) as StoryStage で 4vol → 5, 5vol → 6 のように動的化する。
 *
 * 順読要求は撤廃：
 *   maxReadPos は read セット内の最大 index。手動 localStorage 編集や内部遷移で先取り read された sec の
 *   分だけ stage が動的に上がる。これは「localStorage クリア後に vol3 巻末 sec のみ再読で stage 4 に復元」
 *   したい要望（ユーザー明示・要件 06-5）を優先した仕様。外部流入（迷い込み）は main.ts の
 *   suppression.ts ゲートで recordRead が抑止されるため、通常の読者操作では過大な先取り移行は起きない。
 *
 * SNS 迷い込み等の意図せぬ移行は当関数では扱わない：
 *   前段の main.ts が _isExternalEntry() && !_isResuming() → bookmark.setAutoRecordSuppressed(true) で
 *   recordRead を抑止するため、当関数は read セットを素直に見る（責務分離・要件 06-5）。
 *
 * 型の運用：
 *   StoryStage = 1 | 2 | 3 | 4 | 5 は現行 4vol 固定前提の型。将来 vol5 追加時は story.length + 1 = 6 が
 *   返り得るため、型の 6 追加＋_base.css の --stage-6-hue 定数追加＋末尾セレクタ html[data-story-stage="6"]
 *   { --stage-hue: var(--stage-6-hue); } 追加＋設計正典（design/module-responsibilities.md /
 *   design/requirements/06-5-bookmark.html）の追記が同時に必要。
 */

import type { StoryData, Volume, SecKey } from './types';

// 物語進行段階の型。1〜5 の有限値のみ返る（CLAUDE.md §3 汎用型回避）。
export type StoryStage = 1 | 2 | 3 | 4 | 5;

// 本文 sec キーの正規表現。あとがきキー "vol01-af"（^vol\d{2}-af$）と区別する。
const SEC_KEY_RE = /^\d{2}-\d{2}$/;

// 読者の read セットと story.json から stage を算出する純関数。
// computeStoryStage(read: SecKey[], story: StoryData): StoryStage
export function computeStoryStage(read: SecKey[], story: StoryData): StoryStage {
    if (story.length === 0) return 1;

    // 本文 sec キーのみを残す（あとがきキー "vol01-af" 等を除外）
    const readSet = new Set(read.filter(k => SEC_KEY_RE.test(k)));

    // 引数破壊禁止＝コピーしてから volume 昇順ソート
    const vols = [...story].sort((a, b) => a.volume - b.volume);

    // 公開済み本文 sec に物語順の通し番号を振る（未公開 sec は消費しない）
    const order = new Map<string, number>();
    let pos = 0;
    for (const vol of vols) {
        const eps = [...vol.episodes].sort((a, b) => a.id - b.id);
        for (const ep of eps) {
            const secs = [...ep.sections].sort((a, b) => a.id - b.id);
            for (const sec of secs) {
                if (!sec.published) continue;
                order.set(_secKey(ep.id, sec.id), pos++);
            }
        }
    }

    // read セット内の最大通し番号
    let maxReadPos = -1;
    for (const k of readSet) {
        const idx = order.get(k);
        if (idx !== undefined && idx > maxReadPos) maxReadPos = idx;
    }

    // 各 vol の最終公開 sec の通し番号（無ければ null）
    const volLastPos = vols.map(v => _findVolLastPublishedPos(v, order));

    let stage = 1;
    for (let i = 0; i < vols.length; i++) {
        const last = volLastPos[i];
        if (last === null) break;              // この vol に公開 sec なし → 未確定で打ち切り
        if (maxReadPos < last) break;          // この vol の最終公開 sec に達していない
        const nextVol = vols[i + 1];
        if (nextVol && !_isNextVolFirstSecPublished(nextVol)) break; // 次巻冒頭 sec1 未公開
        stage = vols[i].volume + 1;
    }

    // vol 数から動的に上限クランプ（4vol → 5, 5vol → 6）
    return Math.min(stage, story.length + 1) as StoryStage;
}

// vol 内で最後の公開 sec の通し番号を返す。無ければ null。
function _findVolLastPublishedPos(vol: Volume, order: Map<string, number>): number | null {
    const eps = [...vol.episodes].sort((a, b) => b.id - a.id); // ep 降順
    for (const ep of eps) {
        const secs = [...ep.sections].sort((a, b) => b.id - a.id); // sec 降順
        for (const sec of secs) {
            const idx = order.get(_secKey(ep.id, sec.id));
            if (idx !== undefined) return idx;
        }
    }
    return null;
}

// 次巻の冒頭 ep（epRange[0] の ep）の sec1 が公開済みかを返す。
// 次巻冒頭 ep 自体が episodes に定義されていない（未執筆 vol）or sec1 が未公開 → false。
function _isNextVolFirstSecPublished(nextVol: Volume): boolean {
    const firstEpId = nextVol.epRange[0];
    const ep = nextVol.episodes.find(e => e.id === firstEpId);
    if (!ep) return false;
    const sec1 = ep.sections.find(s => s.id === 1);
    return sec1?.published === true;
}

function _secKey(ep: number, sec: number): string {
    return `${String(ep).padStart(2, '0')}-${String(sec).padStart(2, '0')}`;
}
