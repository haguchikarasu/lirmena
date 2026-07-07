/*
 * 骨格 E2E ②：reader で書字方向を縦横切替すると <html data-writing-mode> が反映される。
 * plan Phase 3 の導線 2 に対応。位置維持は割合ベース（module-responsibilities.md：settings.ts→
 * main.ts の onWritingModeChange 導線）で自動保証されるため、ここでは属性反映を骨格として押さえる。
 * FOUC 対策で <head> のインラインスクリプトも属性を先付けするので、初回は既定値の horizontal で入る。
 */

import { test, expect } from './_fixtures';

test('reader で書字方向 縦↔横 の切替が <html data-writing-mode> に反映される', async ({ page }) => {
    // 既定は横書き（localStorage 未設定＝FOUC スクリプトが horizontal を先付ける）
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'horizontal');

    // メニュー → 設定 → 縦書き
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
    await page.getByRole('button', { name: '縦書き', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'vertical');

    // 続けて横書きに戻す
    await page.getByRole('button', { name: '横書き', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'horizontal');
});
