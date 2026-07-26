/*
 * 骨格 E2E：表示設定の行順（要件 06-4）。
 * 本文ページ（settings.ts の _buildPopup）と目次ページ（index.ts の buildSettingsPopup）は
 * import で結ばない二重実装で、同じ並びを手で揃えている。片方だけ直した状態＝同期漏れを
 * 機械的に検出するのがこの spec の役目（本文側の並びだけなら src/settings.test.ts が見ている）。
 */

import { test, expect } from './_fixtures';

const EXPECTED = ['書字方向', '段落間の空行', 'フォント', '文字サイズ', '文字の太さ'];

test('本文ページの表示設定が要件どおりの並びで表示される', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();

    expect(await page.locator('#settings-popup .settings-row__label').allTextContents()).toEqual(EXPECTED);
});

test('目次ページの表示設定が本文ページと同じ並びで表示される', async ({ page }) => {
    await page.goto('/lirmena/');
    await page.locator('#fab-toggle').click();
    await page.getByRole('menuitem', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();

    expect(await page.locator('#settings-popup .settings-row__label').allTextContents()).toEqual(EXPECTED);
});
