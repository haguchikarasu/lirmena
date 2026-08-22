/*
 * settings.test.ts
 * 対象: settings.ts の読書点（readingAnchor）ロジック／書字方向／段落の区切り／文字の太さ／設定行の並び／3クリアの callback
 *   - 既定値・不正値フォールバック・[0,100] クランプ
 *   - localStorage 保存と CSS 変数 --reading-anchor / --font-weight 反映
 *   - lineGap は --paragraph-margin と --paragraph-indent を**セットで**駆動する（空行と字下げの排他。
 *     片方だけ書くと両方効いて二重の段落区切りに戻る。3者にまたがり depcruise では守れないのでここで検査する）
 * 方針: 期待値は要件 06-4（連続 % 値・localStorage 保存・リセットで既定へ）と IF コメントから導出する（仕様駆動）。
 * 環境: jsdom（localStorage / documentElement.style を使用）。#settings-popup が無い describe では _buildPopup が
 *   早期 return する（＝init だけを見る）。パネル操作を要する describe は beforeEach で #settings-popup を生成し afterEach で撤去する。
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

// 仕様（要件 06-4）：読書点の値は localStorage に保存し「設定をリセット」でデフォルトへ戻す。
// 読書点は設定パネルに行を持たない（調整は画面上のマーカーのドラッグ）ため、表示設定5項目の
// リセットとは別経路（_saveAll ではなく setReadingAnchor(READING_ANCHOR_DEFAULT)）を通る＝取りこぼしやすい。
describe('設定をリセット（読書点・要件 06-4）', () => {
    beforeEach(() => {
        const popup = document.createElement('section');
        popup.id = 'settings-popup';
        document.body.appendChild(popup);
    });
    afterEach(() => {
        document.getElementById('settings-popup')?.remove();
    });

    it('リセットで読書点が既定（45）へ戻り localStorage と CSS 変数にも反映される', () => {
        localStorage.setItem('lirmena.readingAnchor', '70');
        init(NOOP);
        expect(getReadingAnchor()).toBe(70);
        expect(cssVar()).toBe('70%');

        [...document.querySelectorAll<HTMLButtonElement>('.settings-action')]
            .find((b) => b.textContent === '設定をリセット')
            ?.click();

        expect(getReadingAnchor()).toBe(45);
        expect(cssVar()).toBe('45%');
        expect(localStorage.getItem('lirmena.readingAnchor')).toBe('45');
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
            fontWeight: 'normal',
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
            findByText('.settings-opt', '太字')?.click();       // 文字の太さ変更
            expect(calls).toBe(0);
        });
    });
});

// 仕様（要件 06-4）：文字の太さは CSS 変数 --font-weight へ反映する（通常＝--font-weight-normal / 太字＝--font-weight-bold。
// 実値 400/600 は CSS 側で定義するので、ここでは「どの変数を指すか」だけを検証する）。
// 既定は通常、不正値は通常へフォールバック、リセットで通常へ戻る。
describe('文字の太さ（fontWeight → CSS 変数 --font-weight）', () => {
    const weightVar = () => document.documentElement.style.getPropertyValue('--font-weight');

    describe('読み込み・反映（init）', () => {
        it('未設定なら既定の通常を CSS 変数へ反映する', () => {
            init(NOOP);
            expect(weightVar()).toBe('var(--font-weight-normal)');
        });

        it('保存済み bold を復元して CSS 変数へ反映する', () => {
            localStorage.setItem('lirmena.fontWeight', 'bold');
            init(NOOP);
            expect(weightVar()).toBe('var(--font-weight-bold)');
        });

        it('不正値は通常へフォールバックする', () => {
            localStorage.setItem('lirmena.fontWeight', 'heavy');
            init(NOOP);
            expect(weightVar()).toBe('var(--font-weight-normal)');
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

        // ボタン操作は _applySetting()（単一項目のみ反映）を通る。init 経由の _applyAll() とは別経路なので、
        // 「保存はできるのに本文へ反映されない」取りこぼしをここで捕まえる。
        it('「太字」を選ぶと localStorage 保存＋CSS 変数反映する', () => {
            init(NOOP);
            findByText('.settings-opt', '太字')?.click();
            expect(localStorage.getItem('lirmena.fontWeight')).toBe('bold');
            expect(weightVar()).toBe('var(--font-weight-bold)');
        });

        it('「通常」を選ぶと既定値へ戻して保存・反映する', () => {
            localStorage.setItem('lirmena.fontWeight', 'bold');
            init(NOOP);
            findByText('.settings-opt', '通常')?.click();
            expect(localStorage.getItem('lirmena.fontWeight')).toBe('normal');
            expect(weightVar()).toBe('var(--font-weight-normal)');
        });

        it('設定リセットで通常へ戻る', () => {
            localStorage.setItem('lirmena.fontWeight', 'bold');
            init(NOOP);
            expect(weightVar()).toBe('var(--font-weight-bold)');
            findByText('.settings-action', '設定をリセット')?.click();
            expect(weightVar()).toBe('var(--font-weight-normal)');
            expect(localStorage.getItem('lirmena.fontWeight')).toBe('normal');
        });
    });
});

// 仕様（要件 06-4）：段落の区切りは空行か字下げのどちらか一方で表す。lineGap は CSS 変数を 2 本
// （--paragraph-margin / --paragraph-indent）**セットで**駆動し、片方だけ書くと両方効いて二重の区切りに戻る。
// この排他は settings / renderer / CSS の 3 者にまたがり import 辺が無いため depcruise では原理的に守れない
// （architecture.md「段落の区切りの所在」）。init・ボタン操作・リセットの 3 経路すべてで両方の変数を検証する。
describe('段落の区切り（lineGap → CSS 変数 --paragraph-margin / --paragraph-indent）', () => {
    const pair = () => [
        document.documentElement.style.getPropertyValue('--paragraph-margin'),
        document.documentElement.style.getPropertyValue('--paragraph-indent'),
    ];
    const 空行あり = ['var(--paragraph-margin-on)', 'var(--paragraph-indent-on)'];
    const 空行なし = ['var(--paragraph-margin-off)', 'var(--paragraph-indent-off)'];

    describe('読み込み・反映（init）', () => {
        it('未設定なら既定の「あり」＝空行 1em・字下げ 0 を反映する', () => {
            init(NOOP);
            expect(pair()).toEqual(空行あり);
        });

        it('保存済み off を復元して 空行 0・字下げ 1em を反映する', () => {
            localStorage.setItem('lirmena.lineGap', 'off');
            init(NOOP);
            expect(pair()).toEqual(空行なし);
        });

        it('不正値は「あり」へフォールバックする', () => {
            localStorage.setItem('lirmena.lineGap', 'both');
            init(NOOP);
            expect(pair()).toEqual(空行あり);
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

        // ボタン操作は _applySetting()（単一項目のみ反映）を通る。init 経由の _applyAll() とは別経路なので、
        // 「片方の変数だけ書いた」取りこぼしをここで捕まえる。
        it('「なし」を選ぶと 空行 0・字下げ 1em を保存＋反映する', () => {
            init(NOOP);
            findByText('.settings-opt', 'なし')?.click();
            expect(localStorage.getItem('lirmena.lineGap')).toBe('off');
            expect(pair()).toEqual(空行なし);
        });

        it('「あり」を選ぶと 空行 1em・字下げ 0 へ戻して保存＋反映する', () => {
            localStorage.setItem('lirmena.lineGap', 'off');
            init(NOOP);
            findByText('.settings-opt', 'あり')?.click();
            expect(localStorage.getItem('lirmena.lineGap')).toBe('on');
            expect(pair()).toEqual(空行あり);
        });

        it('設定リセットで「あり」へ戻り、2 本とも書き換わる', () => {
            localStorage.setItem('lirmena.lineGap', 'off');
            init(NOOP);
            expect(pair()).toEqual(空行なし);
            findByText('.settings-action', '設定をリセット')?.click();
            expect(pair()).toEqual(空行あり);
            expect(localStorage.getItem('lirmena.lineGap')).toBe('on');
        });
    });
});

// 仕様（要件 06-4）：表示設定の行は「書字方向 → 段落間の空行 → フォント → 文字サイズ → 文字の太さ」の順に表示する。
// 目次ページ（index.ts）は同じ並びを別実装で持つ。両ページの一致は e2e/settings-order.spec.ts が担保する。
describe('表示設定の行順（要件 06-4）', () => {
    beforeEach(() => {
        const popup = document.createElement('section');
        popup.id = 'settings-popup';
        document.body.appendChild(popup);
    });
    afterEach(() => {
        document.getElementById('settings-popup')?.remove();
    });

    it('書字方向→段落間の空行→フォント→文字サイズ→文字の太さ の順に並ぶ', () => {
        init(NOOP);
        const labels = [...document.querySelectorAll('.settings-row__label')].map((el) => el.textContent);
        expect(labels).toEqual(['書字方向', '段落間の空行', 'フォント', '文字サイズ', '文字の太さ']);
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
