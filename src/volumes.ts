/*
 * volumes.ts
 * 責務: 読者の read セットと story.json 定義から、物語順で決まるものを算出する純関数を提供する
 *       （物語進行段階 stage 1〜5、「続きから読む」の地点、オートセーブを書いてよいページか）。
 * export: type StoryStage = 1 | 2 | 3 | 4 | 5
 *         type ResumePoint                                               … 「続きから読む」の地点
 *         MAX_STORY_STAGE: StoryStage                                    … stage の上限値（型の最大値と同値）
 *         computeStoryStage(read: SecKey[], story: StoryData): StoryStage
 *         resolveResumePoint(read, autosave, story): ResumePoint | null
 *         canWriteAutoSave(ep, sec, read, story): boolean
 *         nextSecAfterMaxRead(read, story): { ep: number; sec: number } | null
 *         buildStageTable(story): Record<string, number>                 … 読破キー → 到達する stage（2 以上だけ）
 *         embedStageTable(html: string, story: StoryData): string        … 目次の HTML の印を上の表に置き換える（vite.config.ts が呼ぶ）
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
 *   4. 上限 Math.min(stage, story.length + 1, MAX_STORY_STAGE) as StoryStage でクランプする。
 *      vol 数から動的化しつつ（4vol → 5）、型 StoryStage の範囲外へは出ない。
 *
 * 順読要求は撤廃：
 *   maxReadPos は read セット内の最大 index。手動 localStorage 編集や内部遷移で先取り read された sec の
 *   分だけ stage が動的に上がる。これは「localStorage クリア後に vol3 巻末 sec のみ再読で stage 4 に復元」
 *   したい要望（ユーザー明示・要件 06-5）を優先した仕様。外部流入（迷い込み）は main.ts の
 *   保留の判定（要件 06-5）で recordRead が抑止されるため、通常の読者操作では過大な先取り移行は起きない。
 *
 * SNS 迷い込み等の意図せぬ移行は当関数では扱わない：
 *   前段の main.ts が保留中の recordRead を抑止するため、当関数は read セットを素直に見る（責務分離・要件 06-5）。
 *
 * 型の運用：
 *   StoryStage = 1 | 2 | 3 | 4 | 5 は現行 4vol 前提の型。MAX_STORY_STAGE はその最大値を値として持つ定数で、
 *   `MAX_STORY_STAGE: StoryStage` の型注釈により**型を広げずに定数だけ上げると tsc が落ちる**（片側更新の検出）。
 *   computeStoryStage は MAX_STORY_STAGE でもクランプするので、型範囲外の値は実行時にも返らない＝末尾の
 *   as StoryStage が嘘にならない。代わりに vol を増やすと stage が頭打ちになる（＝静かに 1 段低い色で止まる）ため、
 *   その検出は story-integrity の (m) が build / dev / preview の全経路で止める。
 *   vol5 を足すときに手で直す一覧は design/modules/volumes.md「vol5 以降を追加するときの手順」。
 */

import type { StoryData, Volume, SecKey } from './types';

// 「続きから読む」の地点（要件 06-5「オートセーブ」）。
//   autosave … オートセーブの位置（最大読破位置より先の公開 sec）。ratio へ復元する
//   read-end … 最大読破の節の末尾
//   first    … 最初の公開 sec の先頭（読破も有効なオートセーブもない）
export type ResumePoint =
    | { kind: 'autosave'; ep: number; sec: number; ratio: number }
    | { kind: 'read-end'; ep: number; sec: number }
    | { kind: 'first'; ep: number; sec: number };

// 物語進行段階の型。1〜5 の有限値のみ返る（CLAUDE.md「汎用型（any など）を避ける」）。
export type StoryStage = 1 | 2 | 3 | 4 | 5;

// stage の上限。型 StoryStage の最大値と同値であることを型注釈が保証する
// （型に 6 を足さずにここだけ 6 にすると tsc が落ちる）。story-integrity (m) が vol 数との整合を検査する。
export const MAX_STORY_STAGE: StoryStage = 5;

// 本文 sec キーの正規表現。あとがきキー "vol01-af"（^vol\d{2}-af$）と区別する。
const SEC_KEY_RE = /^\d{2}-\d{2}$/;

// 読者の read セットと story.json から stage を算出する純関数。
// computeStoryStage(read: SecKey[], story: StoryData): StoryStage
export function computeStoryStage(read: SecKey[], story: StoryData): StoryStage {
    if (story.length === 0) return 1;

    // 引数破壊禁止＝コピーしてから volume 昇順ソート
    const vols = [...story].sort((a, b) => a.volume - b.volume);

    const order = _publishedOrder(story);
    const maxReadPos = _maxReadPos(read, order);

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

    // vol 数から動的に上限クランプ（4vol → 5）。MAX_STORY_STAGE も掛けることで型範囲外の値を返さない
    return Math.min(stage, story.length + 1, MAX_STORY_STAGE) as StoryStage;
}

// 「続きから読む」の地点を決める（要件 06-5）。公開済みの節が無ければ null。
// 未公開へ戻した節や存在しない節を指す値は、通し番号に無いので無視される。
// read は呼び出し側の読み方のまま渡す（目次は loadReadKeys、本文は getRead）。
// resolveResumePoint(read: SecKey[], autosave: { ep: number; sec: number; ratio: number } | null, story: StoryData): ResumePoint | null
export function resolveResumePoint(
    read: SecKey[],
    autosave: { ep: number; sec: number; ratio: number } | null,
    story: StoryData,
): ResumePoint | null {
    const order = _publishedOrder(story);
    const keys = [...order.keys()];
    if (keys.length === 0) return null;
    const maxReadPos = _maxReadPos(read, order);

    if (autosave) {
        const pos = order.get(_secKey(autosave.ep, autosave.sec));
        if (pos !== undefined && pos > maxReadPos) {
            return { kind: 'autosave', ep: autosave.ep, sec: autosave.sec, ratio: autosave.ratio };
        }
    }
    if (maxReadPos >= 0) return { kind: 'read-end', ..._parseSecKey(keys[maxReadPos]) };
    return { kind: 'first', ..._parseSecKey(keys[0]) };
}

// このページでオートセーブを書いてよいか＝最大読破位置より先の公開 sec か（要件 06-5）。
// 読み返しと、飛ばした節を後から埋める場合は書かない。ページを開いたときの 1 回だけ判定すればよい
// （開いたまま読了して以降に書いても、読む側 resolveResumePoint が無視する）。
// canWriteAutoSave(ep: number, sec: number, read: SecKey[], story: StoryData): boolean
export function canWriteAutoSave(ep: number, sec: number, read: SecKey[], story: StoryData): boolean {
    const order = _publishedOrder(story);
    const pos = order.get(_secKey(ep, sec));
    return pos !== undefined && pos > _maxReadPos(read, order);
}

// 最大読破の次の公開 sec。読破が無い、または最新まで読了なら null。最前線の判定（suppression.ts）が使う。
// nextSecAfterMaxRead(read: SecKey[], story: StoryData): { ep: number; sec: number } | null
export function nextSecAfterMaxRead(read: SecKey[], story: StoryData): { ep: number; sec: number } | null {
    const order = _publishedOrder(story);
    const maxReadPos = _maxReadPos(read, order);
    if (maxReadPos < 0) return null;
    const next = [...order.keys()][maxReadPos + 1];
    return next === undefined ? null : _parseSecKey(next);
}

// 「読破キー → 到達する stage」の表。stage 2 以上に届くキーだけを持つ（要件 06-7「次巻の公開直後」）。
// 判定は複製せず computeStoryStage をキーごとに呼ぶ。stage は最大読破位置に対して単調なので、
// 読破キーの表引きの最大値は computeStoryStage(read, story) と一致する。
// buildStageTable(story: StoryData): Record<string, number>
export function buildStageTable(story: StoryData): Record<string, number> {
    const table: Record<string, number> = {};
    for (const key of _publishedOrder(story).keys()) {
        const stage = computeStoryStage([key], story);
        if (stage >= 2) table[key] = stage;
    }
    return table;
}

// 目次の HTML の印 {/*stage-table*/} を表に置き換える。印は未変換のままでも空の表として正しい JavaScript。
// embedStageTable(html: string, story: StoryData): string
export function embedStageTable(html: string, story: StoryData): string {
    return html.replace('{/*stage-table*/}', JSON.stringify(buildStageTable(story)));
}

// 公開済み本文 sec に物語順の通し番号を振る（未公開 sec は消費しない）。Map は挿入順＝物語順。
function _publishedOrder(story: StoryData): Map<string, number> {
    const order = new Map<string, number>();
    let pos = 0;
    for (const vol of [...story].sort((a, b) => a.volume - b.volume)) {
        for (const ep of [...vol.episodes].sort((a, b) => a.id - b.id)) {
            for (const sec of [...ep.sections].sort((a, b) => a.id - b.id)) {
                if (sec.published) order.set(_secKey(ep.id, sec.id), pos++);
            }
        }
    }
    return order;
}

// read 内の最大通し番号。読破が無ければ -1。本文 sec キーだけを見る（あとがきキー "vol01-af" 等を除外）。
function _maxReadPos(read: SecKey[], order: Map<string, number>): number {
    let max = -1;
    for (const k of read) {
        if (!SEC_KEY_RE.test(k)) continue;
        const idx = order.get(k);
        if (idx !== undefined && idx > max) max = idx;
    }
    return max;
}

function _parseSecKey(key: string): { ep: number; sec: number } {
    const [ep, sec] = key.split('-').map(Number);
    return { ep, sec };
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
