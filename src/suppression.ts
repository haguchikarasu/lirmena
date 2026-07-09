/*
 * suppression.ts
 * 【責務】外部流入時に到達・読了・オートセーブの自動記録を抑止するかを判定する純関数群。
 *         DOM・localStorage・時刻・グローバル API を触らない副作用ゼロ設計。呼び出し元（main.ts）が
 *         referrer 判定と bookmark / state からの状態問い合わせをまとめて入力オブジェクトに詰めて渡す。
 * 【IF】
 *   shouldSuppressReachedRead(input: ReachedReadInput): boolean
 *   shouldSuppressAutoSave(input: AutoSaveInput): boolean
 * 【依存】なし（型は自前定義）
 * 【被依存】main.ts（起動時の抑止フラグ設定）／suppression.test.ts
 *
 * ── 判定ルール（要件 06-5-bookmark.html「外部サイト/直接アクセスで開いた本文ページ」節）──
 * 到達・読了 → 以下のいずれかを満たせば記録する（＝抑止しない）：
 *   1. lirmena 内移動である（externalEntry === false）
 *   2. 前 sec を読了している（prevSecRead === true）
 *   3. 当 sec に reached / read / autosave 一致 のいずれかがある
 * オートセーブ → 条件 3 だけが違い、autosave 一致のみを例外とする：
 *   1. lirmena 内移動である
 *   2. 前 sec を読了している
 *   3. autosave 一致（読みかけ再開）
 * 差分の理由：オートセーブは単一スロット・上書き型なので「過去に一度開いただけ（reached のみ）」の sec へ
 * 外部リンクから再訪してスクロールした際に、読者の現在の読みかけ位置を奪わないようにする。
 */

// 到達・読了の抑止判定入力。当 sec の痕跡は reached / read / autosave 一致 の 3 種で判定する。
export type ReachedReadInput = {
    externalEntry: boolean; // 遷移元が外部サイト or 直接アクセス
    prevSecRead: boolean;   // 物語順で一つ前の公開 sec を read 済みか（前 sec が存在しなければ false）
    reachedHere: boolean;   // 当 sec が reached セットに含まれるか
    readHere: boolean;      // 当 sec が read セットに含まれるか
    autoSaveHere: boolean;  // autosave スロットが当 sec を指すか（読みかけ再開）
};

// オートセーブの抑止判定入力。当 sec の痕跡は autosave 一致のみで判定する（reached / read は含めない）。
export type AutoSaveInput = {
    externalEntry: boolean;
    prevSecRead: boolean;
    autoSaveHere: boolean;
};

// 到達・読了の記録を抑止するか。抑止する（true）＝ AND：外部流入 かつ 前 sec 未読 かつ 当 sec 痕跡なし。
// externalEntry === false（lirmena 内移動）なら即 false＝常に記録する。
export function shouldSuppressReachedRead(input: ReachedReadInput): boolean {
    if (!input.externalEntry) return false;
    if (input.prevSecRead) return false;
    if (input.reachedHere || input.readHere || input.autoSaveHere) return false;
    return true;
}

// オートセーブの記録を抑止するか。抑止する（true）＝ AND：外部流入 かつ 前 sec 未読 かつ autosave 不一致。
// externalEntry === false（lirmena 内移動）なら即 false＝常に記録する。
export function shouldSuppressAutoSave(input: AutoSaveInput): boolean {
    if (!input.externalEntry) return false;
    if (input.prevSecRead) return false;
    if (input.autoSaveHere) return false;
    return true;
}
