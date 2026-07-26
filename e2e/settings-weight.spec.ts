/*
 * 骨格 E2E：読者設定「文字の太さ」（要件 06-4）。
 * - reader で「太字」「通常」を選ぶと本文段落の computed font-weight が 700 / 400 になる。
 *   settings.ts は CSS 変数へ var(--font-weight-bold) を書くだけなので、二層（--font-weight →
 *   --font-weight-bold: 700）が実際に解決されるところまで見られるのは実ブラウザのここだけ。
 *   ボタン操作は _applySetting()（単一項目のみ反映）を通る経路で、init 経由の _applyAll() とは別。
 * - 本文ページ（settings.ts）と目次ページ（index.ts）は別実装で同じ localStorage キーを共有する。
 *   目次→本文の反映と、本文→目次の選択状態（index.ts の refreshRows/初期 active）の両方向を押さえる。
 */

import { test, expect } from './_fixtures';

const openSettingsFromReader = async (page: import('@playwright/test').Page) => {
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
};

const openSettingsFromToc = async (page: import('@playwright/test').Page) => {
    await page.locator('#fab-toggle').click();
    await page.getByRole('menuitem', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
};

test('reader で「太字」「通常」を選ぶと本文段落の font-weight が 700 / 400 になる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    // 既定は「通常」＝400
    const para = page.locator('#scene-content p').first();
    await expect(para).toHaveCSS('font-weight', '400');

    await openSettingsFromReader(page);
    await page.getByRole('button', { name: '太字', exact: true }).click();
    await expect(para).toHaveCSS('font-weight', '700');

    await page.getByRole('button', { name: '通常', exact: true }).click();
    await expect(para).toHaveCSS('font-weight', '400');
});

test('目次で選んだ「太字」が本文ページに反映される', async ({ page }) => {
    await page.goto('/lirmena/');
    await openSettingsFromToc(page);
    await page.getByRole('button', { name: '太字', exact: true }).click();

    // 目次ページ自身の表示には反映しない（保存のみ。要件 06-4）＝ CSS 変数は書かれない
    expect(await page.evaluate(() => localStorage.getItem('lirmena.fontWeight'))).toBe('bold');
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--font-weight'))).toBe('');

    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#scene-content p').first()).toHaveCSS('font-weight', '700');
});

// 目次側の「設定をリセット」は index.ts の removeItem 列挙と refreshRows() の defs を通る。
// この2箇所は本文側と違って手動列挙（Object.keys 走査ではない）ため、追従漏れを検出できるのはここだけ。
// 初期状態の .active は DEFAULTS.fontWeight の存在も兼ねて見る。
test('目次の「設定をリセット」で文字の太さが既定へ戻る', async ({ page }) => {
    await page.goto('/lirmena/');
    await openSettingsFromToc(page);
    await expect(page.getByRole('button', { name: '通常', exact: true })).toHaveClass(/active/);

    await page.getByRole('button', { name: '太字', exact: true }).click();
    await expect(page.getByRole('button', { name: '太字', exact: true })).toHaveClass(/active/);

    await page.locator('.settings-action', { hasText: '設定をリセット' }).click();

    expect(await page.evaluate(() => localStorage.getItem('lirmena.fontWeight'))).toBeNull();
    await expect(page.getByRole('button', { name: '通常', exact: true })).toHaveClass(/active/);
    await expect(page.getByRole('button', { name: '太字', exact: true })).not.toHaveClass(/active/);
});

test('本文で選んだ「太字」が目次の設定パネルで選択状態として出る', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await openSettingsFromReader(page);
    await page.getByRole('button', { name: '太字', exact: true }).click();

    // 目次側は保存値を読んで .active を付ける（index.ts の buildRow / refreshRows の追従漏れを検出する）
    await page.goto('/lirmena/');
    await openSettingsFromToc(page);
    await expect(page.getByRole('button', { name: '太字', exact: true })).toHaveClass(/active/);
    await expect(page.getByRole('button', { name: '通常', exact: true })).not.toHaveClass(/active/);
});
