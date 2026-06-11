/*
 * settings.test.ts
 * 対象: settings.ts の読書点（readingAnchor）ロジック
 *   - 既定値・不正値フォールバック・[0,100] クランプ
 *   - localStorage 保存と CSS 変数 --reading-anchor 反映
 * 方針: 期待値は要件 06-4（連続 % 値・localStorage 保存・リセットで既定へ）と IF コメントから導出する（仕様駆動）。
 * 環境: jsdom（localStorage / documentElement.style を使用）。#settings-popup は無いので _buildPopup は早期 return する。
 *   各テストは localStorage.clear() ＋ init() で module 内 state（_readingAnchor）を再構築して隔離する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { init, getReadingAnchor, setReadingAnchor } from './settings';

const NOOP = { onClearBookmarks: () => {}, onClearRead: () => {} };
const cssVar = () => document.documentElement.style.getPropertyValue('--reading-anchor');

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
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
