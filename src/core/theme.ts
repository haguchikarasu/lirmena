/*
 * core/theme.ts
 * 責務: 巻ごとの素材（目次のヒーローの絵・ロゴ・ページ背景の風景）の置き場所をファイル名の規約で決める。
 *       story.json には書かない（番号から URL を組むだけ＝story.json を待たずに早期スクリプトでも引ける）。
 *       規約：public/vol[NN]/theme/{hero-wide.avif, logo.webp, page-bg.avif}
 *             物語完結（stage = 巻数 + 1）だけは public/final/theme/ の同じ 3 ファイル
 * export: THEME_FILES: readonly ThemeFile[]                   — 1 組の素材のファイル名（並びは検査メッセージの順）
 *         themeDir(key: ThemeKey): string                      — public からの相対ディレクトリ（末尾 / なし）
 *         themePath(key: ThemeKey, file: ThemeFile): string    — public からの相対パス
 *         themeKeyForStage(stage: number, volCount: number): ThemeKey — 読者の stage がどの組の素材を使うか
 * 依存: なし（DOM / localStorage / fs 非依存の純関数）。
 *       呼び出し元：story-integrity（素材の実在検査＝(q)）、目次 index.ts（ヒーロー・ロゴ・背景・表紙ギャラリー）。
 *       **index.html の早期スクリプトに同じ規約の複製がある**（stage 1〜4 → vol0N/theme、5 → final/theme。
 *       story.json を待たずに絵を出すため）。規約を変えたら両方を直す（照合は e2e/toc-hero.spec.ts）。
 *       URL にするときは呼び出し側が base（import.meta.env.BASE_URL 等）を前に付ける。
 */

/** ThemeFile: 1 組の素材のファイル名。色（hue・地の色）とスマホの切り出し位置は CSS が持つ（ここには無い）。 */
export type ThemeFile = 'hero-wide.avif' | 'logo.webp' | 'page-bg.avif';

/** ThemeKey: 巻番号（1 始まり）か、物語完結の 'final'。 */
export type ThemeKey = number | 'final';

export const THEME_FILES: readonly ThemeFile[] = ['hero-wide.avif', 'logo.webp', 'page-bg.avif'];

// themeDir(key: ThemeKey): string — 例 1 → "vol01/theme"、'final' → "final/theme"
export function themeDir(key: ThemeKey): string {
    if (key === 'final') return 'final/theme';
    return `vol${String(key).padStart(2, '0')}/theme`;
}

// themePath(key: ThemeKey, file: ThemeFile): string — 例 (2, 'logo.webp') → "vol02/theme/logo.webp"
export function themePath(key: ThemeKey, file: ThemeFile): string {
    return `${themeDir(key)}/${file}`;
}

// themeKeyForStage(stage: number, volCount: number): ThemeKey
// stage 1..volCount → その巻、stage volCount+1（物語完結）→ 'final'。stage の算出は volumes.ts の computeStoryStage。
// 例 (2, 4) → 2、(5, 4) → 'final'
export function themeKeyForStage(stage: number, volCount: number): ThemeKey {
    return stage > volCount ? 'final' : stage;
}
