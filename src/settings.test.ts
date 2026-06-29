/*
 * settings.test.ts
 * 対象: settings.ts の読書点（readingAnchor）ロジック
 *   - 既定値・不正値フォールバック・[0,100] クランプ
 *   - localStorage 保存と CSS 変数 --reading-anchor 反映
 * 方針: 期待値は要件 06-4（連続 % 値・localStorage 保存・リセットで既定へ）と IF コメントから導出する（仕様駆動）。
 * 環境: jsdom（localStorage / documentElement.style を使用）。#settings-popup は無いので _buildPopup は早期 return する。
 *   各テストは localStorage.clear() ＋ init() で module 内 state（_readingAnchor）を再構築して隔離する。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { init, getReadingAnchor, setReadingAnchor } from './settings';

const NOOP = { onClearBookmarks: () => {}, onClearRead: () => {} };
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

// 仕様（計画 A-3/A-9・要件 06-4）：writingMode は CSS 変数でなく <html data-writing-mode> 属性へ反映する。
// 既定は縦書き（既存読者の体験維持）、不正値は縦書きへフォールバック、リセットで縦書きへ戻る。
describe('書字方向（writingMode → <html data-writing-mode> 属性）', () => {
    const mode = () => document.documentElement.getAttribute('data-writing-mode');

    describe('読み込み・反映（init）', () => {
        it('未設定なら既定の縦書きを属性へ反映する', () => {
            init(NOOP);
            expect(mode()).toBe('vertical');
        });

        it('保存済み horizontal を復元して属性へ反映する', () => {
            localStorage.setItem('lirmena.writingMode', 'horizontal');
            init(NOOP);
            expect(mode()).toBe('horizontal');
        });

        it('不正値は縦書きへフォールバックする', () => {
            localStorage.setItem('lirmena.writingMode', 'sideways');
            init(NOOP);
            expect(mode()).toBe('vertical');
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

        it('設定リセットで縦書きへ戻る', () => {
            localStorage.setItem('lirmena.writingMode', 'horizontal');
            init(NOOP);
            expect(mode()).toBe('horizontal');
            findByText('.settings-action', '設定をリセット')?.click();
            expect(mode()).toBe('vertical');
            expect(localStorage.getItem('lirmena.writingMode')).toBe('vertical');
        });
    });
});
