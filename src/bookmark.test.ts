/*
 * bookmark.test.ts
 * 対象: bookmark.ts の init() が行う旧データ移行と、栞の固定スロット保存（schemaVersion 5・単一スロット・割合）
 *   - 旧 sceneRead（"ep-sec-scene"）→ reached / read（sec 単位）
 *   - 旧 nested 栞（{ address }）→ flat 栞／旧 flat（slot 無し）→ slot 採番
 *   - addBookmark(address, ratio, slot)：固定スロット（1..3）へ上書き保存（ratio＝スクロール範囲比 0〜1）
 *   - schemaVersion →5：栞/オートセーブを単一スロット化＋位置を割合（ratio）化。旧位置（px）は割合化できないため ratio=0 に落とす
 *   - 単一スロット：書字方向に依存せず "bookmarks" / "autosave" を読み書きする（割合は方向非依存）
 * 方針: 期待値は実装ではなく「IFコメント＋移行ルール（plan）」から導出する（仕様駆動。実装をなぞらない）。
 *   - 完了マーカー "ep-sec-00" → 当 sec を read（＋reached）
 *   - "ep-sec-XX"(XX≥01)      → 当 sec を reached のみ
 *   - 移行は schemaVersion!=='5' のときだけ1回。旧 sceneRead キーは保持（冪等・復旧）。
 *   - 旧 flat 栞の slot 未割当は savedAt 昇順に 1,2,3 を採番。旧 px scrollLeft は割合化できないため ratio=0。
 * 環境: jsdom（localStorage を使用）。各テストは localStorage.clear() で隔離する
 *   （init() が module 内 state を localStorage から再構築するため、これでクリーンに戻る）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    init, getReached, getRead, getBookmarks,
    setAutoRecordSuppressed, recordReached, recordRead, saveAutoSave, getAutoSave, addBookmark,
    nextHistoryState, readHistoryRatio,
} from './bookmark';
import type { SceneAddress } from './types';

const seed = (key: string, value: unknown) =>
    localStorage.setItem(key, JSON.stringify(value));

beforeEach(() => {
    localStorage.clear();
});

describe('旧 sceneRead → 到達/読了 の移行', () => {
    it('完了マーカー "ep-sec-00" は read と reached の両方に入る', () => {
        seed('sceneRead', ['01-01-00']);
        init();
        expect(getRead()).toContain('01-01');
        expect(getReached()).toContain('01-01');
    });

    it('scene≥01（"ep-sec-XX"）は reached のみで read には入らない', () => {
        seed('sceneRead', ['01-02-03']);
        init();
        expect(getReached()).toContain('01-02');
        expect(getRead()).not.toContain('01-02');
        expect(getRead()).toEqual([]);
    });

    it('完了マーカーと途中到達が混在しても sec 単位で正しく振り分ける', () => {
        seed('sceneRead', ['01-01-00', '01-02-05', '02-01-00']);
        init();
        expect(getReached().sort()).toEqual(['01-01', '01-02', '02-01']);
        expect(getRead().sort()).toEqual(['01-01', '02-01']);
    });

    it('3セグメントでない不正キーは無視する', () => {
        seed('sceneRead', ['01-01', '01-01-02-03', '']);
        init();
        expect(getReached()).toEqual([]);
        expect(getRead()).toEqual([]);
    });

    it('既存の新スキーマ reached に union する（上書きしない）', () => {
        seed('reached', ['03-01']);
        seed('sceneRead', ['01-01-00']);
        init();
        expect(getReached().sort()).toEqual(['01-01', '03-01']);
        expect(getRead()).toEqual(['01-01']);
    });

    it('旧 sceneRead キーは移行後も削除せず保持する', () => {
        seed('sceneRead', ['01-01-00']);
        init();
        expect(localStorage.getItem('sceneRead')).not.toBeNull();
    });
});

describe('移行は一度だけ（schemaVersion 番兵）', () => {
    it('移行後に schemaVersion=5 を立てる', () => {
        seed('sceneRead', ['01-01-00']);
        init();
        expect(localStorage.getItem('schemaVersion')).toBe('5');
    });

    it('すでに schemaVersion=5 のユーザーには移行を走らせない', () => {
        localStorage.setItem('schemaVersion', '5');
        seed('sceneRead', ['01-01-00']);
        init();
        expect(getReached()).toEqual([]);
        expect(getRead()).toEqual([]);
    });

    it('旧番兵（schemaVersion=3）のユーザーには v5 移行が走る', () => {
        localStorage.setItem('schemaVersion', '3');
        seed('autosave', { ep: 1, sec: 1, scrollLeft: -300, savedAt: 100 });
        init();
        // 旧 px は割合化できないため ratio=0（ep/sec のみ引き継ぎ）
        expect(getAutoSave()).toMatchObject({ ep: 1, sec: 1, ratio: 0 });
    });

    it('移行済みなら、後から増えた旧 sceneRead を再移行しない', () => {
        seed('sceneRead', ['01-01-00']);
        init(); // 1回目: 移行して schemaVersion=5
        // 旧キーに後から1件足し、新スキーマ側を空に戻して「再移行されない」ことを観測可能にする
        seed('sceneRead', ['01-01-00', '09-09-09']);
        localStorage.removeItem('reached');
        init(); // 2回目: schemaVersion=5 なので移行はスキップされる
        expect(getReached()).not.toContain('09-09');
    });

    // 仕様（Codex 指摘・回帰）：sceneRead 変換は schemaVersion 未設定（pre-multipage）のときだけ。
    //   既に移行済み（schemaVersion あり）のユーザーが「既読/読破をクリア」した後で版数が上がっても、
    //   保持された sceneRead からクリア済みの reached/read を書き戻さない（クリア状態の復活を防ぐ）。
    it('移行済み（schemaVersion あり）ユーザーのクリア済み既読を、版数バンプの再移行で復活させない', () => {
        // 旧 v3 ユーザー相当：sceneRead は残存、reached/read はクリア済み（キー無し）、schemaVersion は旧版
        localStorage.setItem('schemaVersion', '3');
        seed('sceneRead', ['01-01-00', '02-03-05']); // 完了マーカー＋途中到達
        init(); // schemaVersion 3→5 で _migrate が走るが、sceneRead 変換は schemaVersion!=null なのでスキップ
        expect(getReached()).toEqual([]); // 復活しない
        expect(getRead()).toEqual([]);
        expect(localStorage.getItem('schemaVersion')).toBe('5'); // 版数は更新される
    });

    it('pre-multipage（schemaVersion 未設定）ユーザーは sceneRead を初回変換する', () => {
        // schemaVersion 無し＝旧 v1。sceneRead 変換と schemaVersion キーは同時導入のため null が「未変換」の印
        seed('sceneRead', ['01-01-00']);
        init();
        expect(getRead()).toContain('01-01');
        expect(getReached()).toContain('01-01');
    });
});

describe('自動記録の抑止（外部サイト/直接アクセス）', () => {
    // 仕様: setAutoRecordSuppressed(true) の間、到達・読了・オートセーブの自動記録は no-op になる。
    //   栞追加（明示操作）は抑止対象外。init() は抑止を false に戻す。
    const addr: SceneAddress = { ep: 1, sec: 2, scene: 3 };

    it('抑止中は recordReached / recordRead / saveAutoSave が何も記録しない', () => {
        init();
        setAutoRecordSuppressed(true);
        recordReached(1, 1);
        recordRead(2, 1);
        saveAutoSave(3, 1, 0.5);
        expect(getReached()).toEqual([]);
        expect(getRead()).toEqual([]);
        expect(getAutoSave()).toBeNull();
    });

    it('抑止を解除すると通常どおり記録する', () => {
        init();
        setAutoRecordSuppressed(true);
        recordReached(1, 1);
        setAutoRecordSuppressed(false);
        recordReached(1, 1);
        saveAutoSave(1, 1, 0.5);
        expect(getReached()).toContain('01-01');
        expect(getAutoSave()).toMatchObject({ ep: 1, sec: 1, ratio: 0.5 });
    });

    it('抑止中でも栞追加（明示操作）は保存される', () => {
        init();
        setAutoRecordSuppressed(true);
        addBookmark(addr, 0.4, 1);
        expect(getBookmarks()).toHaveLength(1);
        expect(getBookmarks()[0]).toMatchObject({ slot: 1, ep: 1, sec: 2, scene: 3, ratio: 0.4 });
    });

    it('init() は抑止フラグを false に戻す（前ページの抑止を持ち越さない）', () => {
        setAutoRecordSuppressed(true);
        init(); // 新しいページのロード相当
        recordReached(5, 5);
        expect(getReached()).toContain('05-05');
    });
});

describe('オートセーブ（割合・単一スロット）', () => {
    it('ratio は 0〜1 にクランプして保存する', () => {
        init();
        saveAutoSave(1, 1, 1.5);
        expect(getAutoSave()).toMatchObject({ ep: 1, sec: 1, ratio: 1 });
        saveAutoSave(1, 1, -0.5);
        expect(getAutoSave()).toMatchObject({ ep: 1, sec: 1, ratio: 0 });
    });

    it('単一キー "autosave" に保存し、書字方向に依存しない', () => {
        document.documentElement.setAttribute('data-writing-mode', 'horizontal');
        init();
        saveAutoSave(1, 1, 0.6);
        expect(localStorage.getItem('autosave')).not.toBeNull();
        document.documentElement.setAttribute('data-writing-mode', 'vertical');
        init();
        // 割合は方向非依存＝縦書きでも同じオートセーブが見える
        expect(getAutoSave()).toMatchObject({ ep: 1, sec: 1, ratio: 0.6 });
        document.documentElement.removeAttribute('data-writing-mode');
    });
});

describe('旧 nested 栞 → flat 正規化（位置は割合化できないため ratio=0）', () => {
    it('nested 栞は flat 化し、旧 px scrollLeft は捨てて ratio=0・scene を引き継ぎ slot 1 を採番する', () => {
        seed('bookmarks', [{ address: { ep: 1, sec: 2, scene: 3 }, scrollLeft: 999, savedAt: 100 }]);
        init();
        expect(getBookmarks()).toEqual([{ slot: 1, ep: 1, sec: 2, scene: 3, ratio: 0, savedAt: 100 }]);
    });

    it('新 flat 栞は ratio を保持する', () => {
        seed('bookmarks', [{ slot: 1, ep: 1, sec: 2, scene: 3, ratio: 0.7, savedAt: 100 }]);
        init();
        expect(getBookmarks()[0].ratio).toBeCloseTo(0.7);
    });

    it('不正な栞要素（null・ep/sec 欠落）は除外する', () => {
        seed('bookmarks', [null, { foo: 'bar' }, { slot: 1, ep: 1, sec: 1, scene: 0, ratio: 0.1, savedAt: 5 }]);
        init();
        expect(getBookmarks()).toHaveLength(1);
    });
});

describe('旧 flat 栞 → slot 採番（移行）', () => {
    it('slot 無しの複数栞に savedAt 昇順で 1,2,3 を採番する', () => {
        seed('bookmarks', [
            { ep: 1, sec: 1, scene: 0, ratio: 0, savedAt: 300 },
            { ep: 2, sec: 1, scene: 0, ratio: 0, savedAt: 100 },
            { ep: 3, sec: 1, scene: 0, ratio: 0, savedAt: 200 },
        ]);
        init();
        const bySaved = new Map(getBookmarks().map(b => [b.savedAt, b.slot]));
        expect(bySaved.get(100)).toBe(1);
        expect(bySaved.get(200)).toBe(2);
        expect(bySaved.get(300)).toBe(3);
    });

    it('既に有効な slot を持つ栞はその番号を尊重し、未割当はその空きを避けて採番する', () => {
        seed('bookmarks', [
            { slot: 2, ep: 1, sec: 1, scene: 0, ratio: 0, savedAt: 100 },
            { ep: 2, sec: 1, scene: 0, ratio: 0, savedAt: 200 },
        ]);
        init();
        const bySaved = new Map(getBookmarks().map(b => [b.savedAt, b.slot]));
        expect(bySaved.get(100)).toBe(2); // 既存 slot を尊重
        expect(bySaved.get(200)).toBe(1); // 空いている最小スロット
    });
});

describe('固定スロットへの保存（addBookmark・割合）', () => {
    const addr = (ep: number, sec: number): SceneAddress => ({ ep, sec, scene: 0 });

    it('指定スロットに slot 付きで保存する（ratio はクランプ）', () => {
        init();
        addBookmark(addr(1, 2), 0.3, 2);
        expect(getBookmarks()).toEqual([
            { slot: 2, ep: 1, sec: 2, scene: 0, ratio: 0.3, savedAt: expect.any(Number) },
        ]);
    });

    it('同じスロットへの再保存は上書きする（件数は増えない）', () => {
        init();
        addBookmark(addr(1, 1), 0.1, 1);
        addBookmark(addr(2, 3), 0.2, 1);
        const list = getBookmarks();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ slot: 1, ep: 2, sec: 3, ratio: 0.2 });
    });

    it('別スロットは共存する（最大3件）', () => {
        init();
        addBookmark(addr(1, 1), 0.1, 1);
        addBookmark(addr(1, 2), 0.2, 2);
        addBookmark(addr(1, 3), 0.3, 3);
        expect(getBookmarks().map(b => b.slot).sort()).toEqual([1, 2, 3]);
    });

    it('単一キー "bookmarks" に保存し、書字方向に依存しない（横書きの栞は縦書きでも見える）', () => {
        document.documentElement.setAttribute('data-writing-mode', 'horizontal');
        init();
        addBookmark({ ep: 1, sec: 2, scene: 0 }, 0.5, 1);
        expect(localStorage.getItem('bookmarks')).not.toBeNull();
        document.documentElement.setAttribute('data-writing-mode', 'vertical');
        init();
        expect(getBookmarks()[0]).toMatchObject({ ep: 1, sec: 2, ratio: 0.5 });
        document.documentElement.removeAttribute('data-writing-mode');
    });
});

describe('history.state の per-entry スクロール位置（純関数・割合）', () => {
    // 仕様: 履歴エントリごとにスクロール範囲比を lirmenaRatio キーで持つ。autosave の単一スロットと違い
    //   戻る/進むで前ページに移動して autosave が上書きされても、戻り先ページの位置を保てる。割合なので方向非依存。
    //   nextHistoryState は既存 state を温存して上書き、readHistoryRatio は [0,1] の有限数のみ受理（0 は有効）。
    describe('nextHistoryState', () => {
        it('prev=null なら lirmenaRatio だけを持つ', () => {
            expect(nextHistoryState(null, 0.5)).toEqual({ lirmenaRatio: 0.5 });
        });

        it('既存オブジェクトのキーは温存して lirmenaRatio を付与する', () => {
            expect(nextHistoryState({ foo: 1 }, 0.25)).toEqual({ foo: 1, lirmenaRatio: 0.25 });
        });

        it('既存の lirmenaRatio は新しい値で上書きする', () => {
            expect(nextHistoryState({ lirmenaRatio: 0.1 }, 0.9)).toEqual({ lirmenaRatio: 0.9 });
        });

        it('prev が非オブジェクト（文字列・数値）なら空オブジェクト扱い', () => {
            expect(nextHistoryState('x', 0.3)).toEqual({ lirmenaRatio: 0.3 });
            expect(nextHistoryState(7, 0.3)).toEqual({ lirmenaRatio: 0.3 });
        });

        it('ratio=0 も有効値として記録する', () => {
            expect(nextHistoryState(null, 0)).toEqual({ lirmenaRatio: 0 });
        });
    });

    describe('readHistoryRatio', () => {
        it('lirmenaRatio が [0,1] の有限数なら返す', () => {
            expect(readHistoryRatio({ lirmenaRatio: 0.25 })).toBe(0.25);
        });

        it('0 / 1 は有効値として返す（先頭・末尾の位置を null と区別する）', () => {
            expect(readHistoryRatio({ lirmenaRatio: 0 })).toBe(0);
            expect(readHistoryRatio({ lirmenaRatio: 1 })).toBe(1);
        });

        it('範囲外（負値・1超）は null（割合は 0〜1）', () => {
            expect(readHistoryRatio({ lirmenaRatio: -0.1 })).toBeNull();
            expect(readHistoryRatio({ lirmenaRatio: 1.5 })).toBeNull();
        });

        it('旧 px キー lirmenaScrollLeft は無視する（null）', () => {
            expect(readHistoryRatio({ lirmenaScrollLeft: 250 })).toBeNull();
        });

        it('キー無し・null・非オブジェクト・非数・NaN は null', () => {
            expect(readHistoryRatio({})).toBeNull();
            expect(readHistoryRatio(null)).toBeNull();
            expect(readHistoryRatio('0.5')).toBeNull();
            expect(readHistoryRatio({ lirmenaRatio: '0.5' })).toBeNull();
            expect(readHistoryRatio({ lirmenaRatio: NaN })).toBeNull();
        });

        it('nextHistoryState の出力を読み戻せる（往復）', () => {
            expect(readHistoryRatio(nextHistoryState(null, 0.33))).toBeCloseTo(0.33);
        });
    });
});

describe('schemaVersion →5：単一スロット化＋割合化（旧位置は ratio=0 に落とす）', () => {
    // 仕様: 旧単一キー "bookmarks"/"autosave"（生 scrollLeft・縦書き vertical-rl では負値）／旧方向別キー
    //   "bookmarks.vertical"/"autosave.vertical"（v4・未デプロイ）を、単一キー "bookmarks"/"autosave" の割合エントリへ統合する。
    //   旧位置は保存時の可動域が不明で割合化できないため ratio=0（ep/sec/scene のみ引き継ぐ）。方向別キーは掃除する。
    it('旧 autosave（生 scrollLeft）→ 単一 "autosave"（ratio=0・ep/sec 引き継ぎ）', () => {
        seed('autosave', { ep: 2, sec: 3, scrollLeft: -1234, savedAt: 100 });
        init();
        expect(getAutoSave()).toMatchObject({ ep: 2, sec: 3, ratio: 0 });
    });

    it('旧 bookmarks（生 scrollLeft）→ 単一 "bookmarks"（ratio=0・slot 採番）', () => {
        seed('bookmarks', [{ ep: 1, sec: 2, scene: 0, scrollLeft: -800, savedAt: 100 }]);
        init();
        expect(getBookmarks()[0]).toMatchObject({ slot: 1, ep: 1, sec: 2, ratio: 0 });
    });

    it('v4 方向別キーのみ存在する場合は vertical スロットを源に移行し、方向別キーを掃除する', () => {
        seed('bookmarks.vertical', [{ slot: 1, ep: 9, sec: 9, scene: 0, scrollLeft: 50, savedAt: 1 }]);
        seed('autosave.vertical', { ep: 9, sec: 9, scrollLeft: 70, savedAt: 1 });
        init();
        expect(getBookmarks()[0]).toMatchObject({ ep: 9, sec: 9, ratio: 0 });
        expect(getAutoSave()).toMatchObject({ ep: 9, sec: 9, ratio: 0 });
        // 方向別キー（孤児）は掃除される
        expect(localStorage.getItem('bookmarks.vertical')).toBeNull();
        expect(localStorage.getItem('bookmarks.horizontal')).toBeNull();
        expect(localStorage.getItem('autosave.vertical')).toBeNull();
        expect(localStorage.getItem('autosave.horizontal')).toBeNull();
    });

    it('単一キーを優先する（v4 vertical より v3 単一キーが残っていればそちらを源にする）', () => {
        seed('bookmarks', [{ ep: 1, sec: 1, scene: 0, scrollLeft: -800, savedAt: 100 }]);
        seed('bookmarks.vertical', [{ slot: 1, ep: 9, sec: 9, scene: 0, scrollLeft: 50, savedAt: 1 }]);
        init();
        expect(getBookmarks()[0]).toMatchObject({ ep: 1, sec: 1 });
    });
});
