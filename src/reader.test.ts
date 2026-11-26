/*
 * reader.test.ts
 * 対象: reader.ts のスクロール通知の fan-out（progress / opening / state）とオートセーブの間引き（500ms）、
 *       止まったときの書き込み（handleScrollEnd）。
 * 方針: 期待値は reader.ts 冒頭の IF コメント（fan-out ①〜⑤）から導く（仕様駆動）。
 *   間引きの境界（499ms と 500ms）、あとがきでは autosave を書かず履歴だけ刻むこと、init で間引きが解けることを固定する。
 *   止まったときは静かな時間（SCROLL_END_QUIET_MS）を待って 1 回書くこと、毎フレーム scrollend が来る移動でも
 *   書き込みが「500ms に 1 回＋止まったときの 1 回」を超えないことを固定する。
 * 環境: jsdom。依存 4 モジュールは vi.mock で差し替え、時刻は fake timers で動かす。
 *   間引きの時刻はモジュール内の変数なので、テストごとに vi.resetModules() して動的 import する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScrollNotification } from './types';

vi.mock('./progress', () => ({ update: vi.fn() }));
vi.mock('./opening', () => ({ update: vi.fn() }));
vi.mock('./bookmark', () => ({ saveAutoSave: vi.fn(), saveScrollToHistory: vi.fn() }));
vi.mock('./state', () => ({ getMode: vi.fn(() => 'sec'), setCurrentScene: vi.fn() }));

type Deps = {
    reader: typeof import('./reader');
    progress: typeof import('./progress');
    opening: typeof import('./opening');
    bookmark: typeof import('./bookmark');
    state: typeof import('./state');
};

async function load(): Promise<Deps> {
    vi.resetModules();
    const reader = await import('./reader');
    const progress = await import('./progress');
    const opening = await import('./opening');
    const bookmark = await import('./bookmark');
    const state = await import('./state');
    // モックの実装はテスト間で持ち越されることがあるので、毎回本文モードに戻す
    vi.mocked(state.getMode).mockReturnValue('sec');
    return { reader, progress, opening, bookmark, state };
}

const note = (over: Partial<ScrollNotification> = {}): ScrollNotification => ({
    scrollLeft: 120, ratio: 0.25, scrollWidth: 1000, clientWidth: 400, currentScene: 3, progress: 0.4, ...over,
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.clearAllMocks();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('オートセーブと履歴への書き込み（間引き 500ms）', () => {
    it('init のあと最初の通知で saveAutoSave と saveScrollToHistory が 1 回ずつ呼ばれる', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 2, sec: 5 });
        reader.handleScroll(note({ ratio: 0.25 }));

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(1);
        expect(bookmark.saveAutoSave).toHaveBeenCalledWith(2, 5, 0.25);
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledTimes(1);
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledWith(0.25);
    });

    it('前の書き込みから 499ms の通知では書かない', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note());
        vi.advanceTimersByTime(499);
        reader.handleScroll(note({ ratio: 0.5 }));

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(1);
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledTimes(1);
    });

    it('前の書き込みからちょうど 500ms の通知では書く', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.1 }));
        vi.advanceTimersByTime(500);
        reader.handleScroll(note({ ratio: 0.5 }));

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(2);
        expect(bookmark.saveAutoSave).toHaveBeenLastCalledWith(1, 1, 0.5);
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledTimes(2);
        expect(bookmark.saveScrollToHistory).toHaveBeenLastCalledWith(0.5);
    });

    it('間引かれた通知は書き込み時刻を進めない（書いた時点から 500ms で次を書く）', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note());          // 0ms：書く
        vi.advanceTimersByTime(300);
        reader.handleScroll(note());          // 300ms：間引かれる
        vi.advanceTimersByTime(200);
        reader.handleScroll(note());          // 500ms：書く（300ms の通知は基準にならない）

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(2);
    });

    it('あとがきでは saveAutoSave を呼ばず、saveScrollToHistory は呼ぶ', async () => {
        const { reader, bookmark, state } = await load();
        vi.mocked(state.getMode).mockReturnValue('afterword');
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.7 }));

        expect(bookmark.saveAutoSave).not.toHaveBeenCalled();
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledTimes(1);
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledWith(0.7);
    });

    it('init し直すと間引きが解け、直後の通知で書く。書き込み先は init に渡した ep/sec', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note());
        reader.init({ ep: 3, sec: 4 });
        reader.handleScroll(note({ ratio: 0.9 }));   // 時刻は進めていない

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(2);
        expect(bookmark.saveAutoSave).toHaveBeenLastCalledWith(3, 4, 0.9);
    });

    it('scrollend の通知が来なければ、間引かれた位置は書かれない（止まったことは handleScrollEnd でだけ知る）', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.1 }));   // 書く
        vi.advanceTimersByTime(100);
        reader.handleScroll(note({ ratio: 0.8 }));   // 間引かれる
        vi.advanceTimersByTime(60_000);

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(1);
        expect(reader.getLastRatio()).toBe(0.8);     // 読書位置としては最新を持っている（書かれないだけ）
    });
});

describe('止まったときの書き込み（handleScrollEnd）', () => {
    it('最後の書き込みから 500ms 以内に止まっても、止まった位置が書かれる', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 2, sec: 3 });
        reader.handleScroll(note({ ratio: 0.1 }));   // 書く
        vi.advanceTimersByTime(100);
        reader.handleScroll(note({ ratio: 0.8 }));   // 間引かれる＝ここで止まった
        reader.handleScrollEnd();
        vi.advanceTimersByTime(reader.SCROLL_END_QUIET_MS);

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(2);
        expect(bookmark.saveAutoSave).toHaveBeenLastCalledWith(2, 3, 0.8);
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledTimes(2);
        expect(bookmark.saveScrollToHistory).toHaveBeenLastCalledWith(0.8);
    });

    it('止まった通知のあと静かな時間が SCROLL_END_QUIET_MS に満たないうちは書かない', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.1 }));
        reader.handleScroll(note({ ratio: 0.8 }));
        reader.handleScrollEnd();
        vi.advanceTimersByTime(reader.SCROLL_END_QUIET_MS - 1);

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(1);
    });

    it('止まった通知が続けて来たら、最後の通知から数え直す（rAF で位置を書き換える移動は毎フレーム scrollend が出る）', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.1 }));
        reader.handleScrollEnd();
        vi.advanceTimersByTime(reader.SCROLL_END_QUIET_MS - 10);
        reader.handleScroll(note({ ratio: 0.2 }));
        reader.handleScrollEnd();                    // 数え直し
        vi.advanceTimersByTime(reader.SCROLL_END_QUIET_MS - 10);

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(10);
        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(2);
        expect(bookmark.saveAutoSave).toHaveBeenLastCalledWith(1, 1, 0.2);
    });

    it('止まった位置が前回書いた値と同じなら書かない', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.4 }));   // 書く
        reader.handleScrollEnd();
        vi.advanceTimersByTime(reader.SCROLL_END_QUIET_MS);

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(1);
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledTimes(1);
    });

    it('あとがきでは止まったときも saveAutoSave を呼ばず、saveScrollToHistory だけ呼ぶ', async () => {
        const { reader, bookmark, state } = await load();
        vi.mocked(state.getMode).mockReturnValue('afterword');
        reader.init({ ep: 0, sec: 0 });
        reader.handleScroll(note({ ratio: 0.1 }));
        reader.handleScroll(note({ ratio: 0.6 }));
        reader.handleScrollEnd();
        vi.advanceTimersByTime(reader.SCROLL_END_QUIET_MS);

        expect(bookmark.saveAutoSave).not.toHaveBeenCalled();
        expect(bookmark.saveScrollToHistory).toHaveBeenCalledTimes(2);
        expect(bookmark.saveScrollToHistory).toHaveBeenLastCalledWith(0.6);
    });

    it('init すると待っている書き込みは捨てる（前のページの位置を次のページへ書かない）', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.1 }));
        reader.handleScroll(note({ ratio: 0.8 }));
        reader.handleScrollEnd();
        reader.init({ ep: 1, sec: 2 });
        vi.advanceTimersByTime(60_000);

        expect(bookmark.saveAutoSave).toHaveBeenCalledTimes(1);
        expect(bookmark.saveAutoSave).toHaveBeenCalledWith(1, 1, 0.1);
    });

    it('rAF ごとに位置を書き換える移動（毎フレーム scroll と scrollend）でも、書き込みは 500ms に 1 回＋止まったときの 1 回まで', async () => {
        const { reader, bookmark } = await load();
        reader.init({ ep: 1, sec: 1 });
        const FRAME = 16;
        const DURATION = 2000;
        for (let t = 0; t <= DURATION; t += FRAME) {
            reader.handleScroll(note({ ratio: t / DURATION / 2 + 0.001 }));
            reader.handleScrollEnd();
            vi.advanceTimersByTime(FRAME);
        }
        const duringMove = vi.mocked(bookmark.saveAutoSave).mock.calls.length;
        expect(duringMove).toBeLessThanOrEqual(Math.floor(DURATION / 500) + 1);
        vi.advanceTimersByTime(reader.SCROLL_END_QUIET_MS);

        const total = vi.mocked(bookmark.saveAutoSave).mock.calls.length;
        expect(total).toBeLessThanOrEqual(duringMove + 1);
        expect(vi.mocked(bookmark.saveScrollToHistory).mock.calls.length).toBe(total);
        // 最後に書かれたのは止まった位置
        expect(bookmark.saveAutoSave).toHaveBeenLastCalledWith(1, 1, reader.getLastRatio());
    });
});

describe('通知ごとの fan-out（間引きに関わらない）', () => {
    it('毎回 progress.update・opening.update・state.setCurrentScene が呼ばれる', async () => {
        const { reader, progress, opening, state } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ progress: 0.1, scrollLeft: 10, currentScene: 1 }));
        reader.handleScroll(note({ progress: 0.6, scrollLeft: 300, currentScene: 4 }));   // 間引かれる通知

        expect(progress.update).toHaveBeenCalledTimes(2);
        expect(progress.update).toHaveBeenNthCalledWith(2, 0.6);
        expect(opening.update).toHaveBeenCalledTimes(2);
        expect(opening.update).toHaveBeenNthCalledWith(2, 300);
        expect(state.setCurrentScene).toHaveBeenCalledTimes(2);
        expect(state.setCurrentScene).toHaveBeenNthCalledWith(2, 4);
    });

    it('あとがきでも fan-out は同じ', async () => {
        const { reader, progress, opening, state } = await load();
        vi.mocked(state.getMode).mockReturnValue('afterword');
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ progress: 0.3, scrollLeft: 50, currentScene: 2 }));

        expect(progress.update).toHaveBeenCalledWith(0.3);
        expect(opening.update).toHaveBeenCalledWith(50);
        expect(state.setCurrentScene).toHaveBeenCalledWith(2);
    });
});

describe('getLastRatio', () => {
    it('間引きに関わらず最新の ratio を返す', async () => {
        const { reader } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.2 }));
        reader.handleScroll(note({ ratio: 0.6 }));   // 間引かれる通知
        expect(reader.getLastRatio()).toBe(0.6);
    });

    it('init で 0 に戻る', async () => {
        const { reader } = await load();
        reader.init({ ep: 1, sec: 1 });
        reader.handleScroll(note({ ratio: 0.4 }));
        reader.init({ ep: 1, sec: 2 });
        expect(reader.getLastRatio()).toBe(0);
    });
});
