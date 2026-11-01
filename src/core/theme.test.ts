// @vitest-environment node
/*
 * core/theme.test.ts
 * core/theme.ts（巻の素材のファイル名規約）の仕様駆動テスト。
 * IF: themeDir(key: ThemeKey): string / themePath(key: ThemeKey, file: ThemeFile): string / THEME_FILES
 */

import { describe, expect, it } from 'vitest';
import { THEME_FILES, themeDir, themePath } from './theme';

describe('core/theme — 素材の置き場所の規約', () => {
    it('巻番号は 2 桁ゼロ埋めの volNN/theme', () => {
        expect(themeDir(1)).toBe('vol01/theme');
        expect(themeDir(12)).toBe('vol12/theme');
    });

    it("物語完結は final/theme", () => {
        expect(themeDir('final')).toBe('final/theme');
    });

    it('themePath はディレクトリとファイル名をつなぐ（先頭・末尾に / を付けない）', () => {
        expect(themePath(2, 'logo.webp')).toBe('vol02/theme/logo.webp');
        expect(themePath('final', 'page-bg.avif')).toBe('final/theme/page-bg.avif');
    });

    it('1 組は 3 ファイル（スマホ用の縦長の絵は持たない）', () => {
        expect(THEME_FILES).toEqual(['hero-wide.avif', 'logo.webp', 'page-bg.avif']);
    });
});
