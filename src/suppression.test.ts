/*
 * suppression.test.ts
 * 対象: suppression.ts の 2 純関数（到達・読了／オートセーブの抑止判定）
 * 方針: 期待値は要件 06-5-bookmark.html「外部サイト/直接アクセスで開いた本文ページは記録しない」note と
 *   計画ファイルの判定表から導出する（実装をなぞらない）。両関数は副作用ゼロ・入力プリミティブのみ。
 *   到達・読了 → 抑止：外部流入 かつ 前 sec 未読 かつ 当 sec 痕跡（reached/read/autosave 一致）なし
 *   オートセーブ → 抑止：外部流入 かつ 前 sec 未読 かつ autosave 不一致
 * 環境: jsdom 不要（純関数）。
 */
import { describe, expect, it } from 'vitest';
import { shouldSuppressReachedRead, shouldSuppressAutoSave } from './suppression';

describe('shouldSuppressReachedRead（到達・読了の抑止判定）', () => {
    it('lirmena 内移動なら常に false（記録する）', () => {
        expect(shouldSuppressReachedRead({
            externalEntry: false, prevSecRead: false,
            reachedHere: false, readHere: false, autoSaveHere: false,
        })).toBe(false);
    });

    it('外部流入 かつ 前 sec 未読 かつ 当 sec 痕跡なし → true（抑止）', () => {
        expect(shouldSuppressReachedRead({
            externalEntry: true, prevSecRead: false,
            reachedHere: false, readHere: false, autoSaveHere: false,
        })).toBe(true);
    });

    it('外部流入でも 前 sec 読了 なら false（順に読み進めての続き sec）', () => {
        expect(shouldSuppressReachedRead({
            externalEntry: true, prevSecRead: true,
            reachedHere: false, readHere: false, autoSaveHere: false,
        })).toBe(false);
    });

    it('外部流入でも 当 sec が reached にあれば false（過去に開いたことがある）', () => {
        expect(shouldSuppressReachedRead({
            externalEntry: true, prevSecRead: false,
            reachedHere: true, readHere: false, autoSaveHere: false,
        })).toBe(false);
    });

    it('外部流入でも 当 sec が read にあれば false（過去に読了したことがある）', () => {
        expect(shouldSuppressReachedRead({
            externalEntry: true, prevSecRead: false,
            reachedHere: false, readHere: true, autoSaveHere: false,
        })).toBe(false);
    });

    it('外部流入でも autosave 一致なら false（読みかけ再開・現行維持）', () => {
        expect(shouldSuppressReachedRead({
            externalEntry: true, prevSecRead: false,
            reachedHere: false, readHere: false, autoSaveHere: true,
        })).toBe(false);
    });

    it('内部移動で前 sec 未読・痕跡なしでも false（内部は常に記録）', () => {
        expect(shouldSuppressReachedRead({
            externalEntry: false, prevSecRead: false,
            reachedHere: false, readHere: false, autoSaveHere: false,
        })).toBe(false);
    });
});

describe('shouldSuppressAutoSave（オートセーブの抑止判定）', () => {
    it('lirmena 内移動なら常に false（記録する）', () => {
        expect(shouldSuppressAutoSave({
            externalEntry: false, prevSecRead: false, autoSaveHere: false,
        })).toBe(false);
    });

    it('外部流入 かつ 前 sec 未読 かつ autosave 不一致 → true（抑止）', () => {
        expect(shouldSuppressAutoSave({
            externalEntry: true, prevSecRead: false, autoSaveHere: false,
        })).toBe(true);
    });

    it('外部流入でも 前 sec 読了 なら false（順に読み進めての続き sec）', () => {
        expect(shouldSuppressAutoSave({
            externalEntry: true, prevSecRead: true, autoSaveHere: false,
        })).toBe(false);
    });

    it('外部流入でも autosave 一致なら false（読みかけ再開）', () => {
        expect(shouldSuppressAutoSave({
            externalEntry: true, prevSecRead: false, autoSaveHere: true,
        })).toBe(false);
    });
});

describe('到達・読了 と オートセーブ の差分（過去 reached だけの sec に外部から再訪）', () => {
    // 仕様：外部流入・前 sec 未読・当 sec に reached あり・autosave は別 sec を指す（不一致）
    // → 到達・読了は記録される（reachedHere で有効化）／オートセーブは抑止される（過去 reached は autoSave 側の例外にしない）
    // これにより現在の読みかけ位置（autosave）が過去 reached の sec に上書きされない。
    it('reached あり／autosave 不一致：到達・読了は記録、オートセーブは抑止', () => {
        const shared = { externalEntry: true, prevSecRead: false } as const;
        expect(shouldSuppressReachedRead({
            ...shared, reachedHere: true, readHere: false, autoSaveHere: false,
        })).toBe(false);
        expect(shouldSuppressAutoSave({
            ...shared, autoSaveHere: false,
        })).toBe(true);
    });

    it('read あり／autosave 不一致：同上（read の含意）', () => {
        const shared = { externalEntry: true, prevSecRead: false } as const;
        expect(shouldSuppressReachedRead({
            ...shared, reachedHere: false, readHere: true, autoSaveHere: false,
        })).toBe(false);
        expect(shouldSuppressAutoSave({
            ...shared, autoSaveHere: false,
        })).toBe(true);
    });
});
