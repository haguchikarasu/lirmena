/*
 * settings.test.ts
 * 対象: settings.ts の読書点（readingAnchor）ロジック
 *   - 既定値・不正値フォールバック・[0,100] クランプ
 *   - localStorage 保存と CSS 変数 --reading-anchor 反映
 * 方針: 期待値は要件 06-4（連続 % 値・localStorage 保存・リセットで既定へ）と IF コメントから導出する（仕様駆動）。
 * 環境: jsdom（localStorage / documentElement.style を使用）。#settings-popup は無いので _buildPopup は早期 return する。
 *   各テストは localStorage.clear() ＋ init() で module 内 state（_readingAnchor）を再構築して隔離する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, getReadingAnchor, setReadingAnchor, getSettings } from './settings';

const NOOP = { onClearBookmarks: () => {}, onClearReached: () => {}, onClearRead: () => {}, onWritingModeChange: () => {} };
const cssVar = () => document.documentElement.style.getPropertyValue('--reading-anchor');

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-writing-mode');
});

describe('読書点の既定・読み込み', () => {
    it('未設定なら既定値（45）を反映する', () => {
        init(NOOP);
        expect(getReadingAnchor()).toBe(45);
        expect(cssVar()).toBe('45%');
    });

    it('保存済みの有効値を読み込む', () => {
        localStorage.setItem('lirmena.readingAnchor', '30');
        init(NOOP);
        expect(getReadingAnchor()).toBe(30);
        expect(cssVar()).toBe('30%');
    });

    it('不正値は既定値にフォールバックする', () => {
        localStorage.setItem('lirmena.readingAnchor', 'abc');
        init(NOOP);
        expect(getReadingAnchor()).toBe(45);
    });
});

describe('setReadingAnchor（永続化＋CSS 変数反映）', () => {
    beforeEach(() => init(NOOP));

    it('値を保存し CSS 変数へ反映する', () => {
        setReadingAnchor(60);
        expect(getReadingAnchor()).toBe(60);
        expect(localStorage.getItem('lirmena.readingAnchor')).toBe('60');
        expect(cssVar()).toBe('60%');
    });

    it('[0,100] にクランプする', () => {
        setReadingAnchor(150);
        expect(getReadingAnchor()).toBe(100);
        setReadingAnchor(-10);
        expect(getReadingAnchor()).toBe(0);
    });
});

// 仕様（IF コメント）：getSettings() は現在の設定項目のコピーを返し、呼び出し側が書き換えても内部状態に影響しない。
describe('getSettings（現在値のスナップショット取得）', () => {
    it('init 直後はデフォルト値のコピーを返す', () => {
        init(NOOP);
        expect(getSettings()).toEqual({
            fontSize: 'medium',
            fontFamily: 'serif',
            lineGap: 'on',
            writingMode: 'horizontal',
        });
    });

    it('返り値を書き換えても内部状態（getReadingAnchor 等）に影響しない', () => {
        init(NOOP);
        const snapshot = getSettings();
        snapshot.fontSize = 'large';
        snapshot.writingMode = 'vertical';
        expect(getSettings().fontSize).toBe('medium');
        expect(document.documentElement.getAttribute('data-writing-mode')).toBe('horizontal');
    });
});

// 仕様（計画 A-3/A-9・要件 06-4）：writingMode は CSS 変数でなく <html data-writing-mode> 属性へ反映する。
// 既定は横書き、不正値は横書きへフォールバック、リセットで横書きへ戻る。
describe('書字方向（writingMode → <html data-writing-mode> 属性）', () => {
    const mode = () => document.documentElement.getAttribute('data-writing-mode');

    describe('読み込み・反映（init）', () => {
        it('未設定なら既定の横書きを属性へ反映する', () => {
            init(NOOP);
            expect(mode()).toBe('horizontal');
        });

        it('保存済み vertical を復元して属性へ反映する', () => {
            localStorage.setItem('lirmena.writingMode', 'vertical');
            init(NOOP);
            expect(mode()).toBe('vertical');
        });

        it('不正値は横書きへフォールバックする', () => {
            localStorage.setItem('lirmena.writingMode', 'sideways');
            init(NOOP);
            expect(mode()).toBe('horizontal');
        });
    });

    describe('トグル操作・リセット（#settings-popup 経由）', () => {
        beforeEach(() => {
            const popup = document.createElement('section');
            popup.id = 'settings-popup';
            document.body.appendChild(popup);
        });
        afterEach(() => {
            document.getElementById('settings-popup')?.remove();
        });

        const findByText = (selector: string, text: string) =>
            [...document.querySelectorAll<HTMLButtonElement>(selector)].find((b) => b.textContent === text);

        it('「横書き」を選ぶと localStorage 保存＋属性反映する', () => {
            init(NOOP);
            findByText('.settings-opt', '横書き')?.click();
            expect(localStorage.getItem('lirmena.writingMode')).toBe('horizontal');
            expect(mode()).toBe('horizontal');
        });

        it('設定リセットで横書きへ戻る', () => {
            localStorage.setItem('lirmena.writingMode', 'vertical');
            init(NOOP);
            expect(mode()).toBe('vertical');
            findByText('.settings-action', '設定をリセット')?.click();
            expect(mode()).toBe('horizontal');
            expect(localStorage.getItem('lirmena.writingMode')).toBe('horizontal');
        });

        // 仕様（A-4）：書字方向が実際に変わったときだけ onWritingModeChange を呼ぶ（main.ts が切替前位置を新方向へ復元する）。
        it('書字方向を実際に変えたときだけ onWritingModeChange を呼ぶ', () => {
            let calls = 0;
            init({ ...NOOP, onWritingModeChange: () => { calls++; } });
            // 横書き（既定）で「縦書き」を選ぶ＝変化あり → 1回
            findByText('.settings-opt', '縦書き')?.click();
            expect(calls).toBe(1);
            // すでに縦書きで「縦書き」を再選択＝変化なし → 増えない
            findByText('.settings-opt', '縦書き')?.click();
            expect(calls).toBe(1);
            // 「横書き」へ＝変化あり → 2回
            findByText('.settings-opt', '横書き')?.click();
            expect(calls).toBe(2);
        });

        it('書字方向以外の設定変更では onWritingModeChange を呼ばない', () => {
            let calls = 0;
            init({ ...NOOP, onWritingModeChange: () => { calls++; } });
            findByText('.settings-opt', 'ゴシック体')?.click(); // フォント変更
            findByText('.settings-opt', '大')?.click();         // 文字サイズ変更
            expect(calls).toBe(0);
        });
    });
});

// 仕様（要件 06-4）：3クリアボタン（栞・既読・読破状況）はそれぞれ独立の callback を呼ぶ＋実行前に window.confirm() で承認を取る。
// キャンセル（confirm=false）なら callback を呼ばない＝localStorage も再描画も走らない。
describe('クリアボタンの3系統 callback ルーティング＋confirm 承認', () => {
    beforeEach(() => {
        const popup = document.createElement('section');
        popup.id = 'settings-popup';
        document.body.appendChild(popup);
    });
    afterEach(() => {
        document.getElementById('settings-popup')?.remove();
        vi.restoreAllMocks();
    });

    const findByText = (selector: string, text: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(selector)].find((b) => b.textContent === text);

    const setupCallbacks = () => {
        const calls = { bookmarks: 0, reached: 0, read: 0 };
        init({
            onClearBookmarks: () => { calls.bookmarks++; },
            onClearReached: () => { calls.reached++; },
            onClearRead: () => { calls.read++; },
            onWritingModeChange: () => {},
        });
        return calls;
    };

    it('confirm=true のとき「栞をクリア」は onClearBookmarks のみを呼ぶ', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const calls = setupCallbacks();
        findByText('.settings-action', '栞をクリア')?.click();
        expect(calls).toEqual({ bookmarks: 1, reached: 0, read: 0 });
    });

    it('confirm=true のとき「既読をクリア」は onClearReached のみを呼ぶ', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const calls = setupCallbacks();
        findByText('.settings-action', '既読をクリア')?.click();
        expect(calls).toEqual({ bookmarks: 0, reached: 1, read: 0 });
    });

    it('confirm=true のとき「読破状況をクリア」は onClearRead のみを呼ぶ', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const calls = setupCallbacks();
        findByText('.settings-action', '読破状況をクリア')?.click();
        expect(calls).toEqual({ bookmarks: 0, reached: 0, read: 1 });
    });

    it('confirm=false のとき 3ボタンのどれを押しても callback は呼ばれない', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        const calls = setupCallbacks();
        findByText('.settings-action', '栞をクリア')?.click();
        findByText('.settings-action', '既読をクリア')?.click();
        findByText('.settings-action', '読破状況をクリア')?.click();
        expect(calls).toEqual({ bookmarks: 0, reached: 0, read: 0 });
    });
});
