/*
 * 骨格 E2E ①：目次 → タイトル(ep1) → reader(ep1 sec1) の遷移が成立するか。
 * plan Phase 3 の導線 1 に対応（module-responsibilities.md：index.ts の「sec01 は ep の扉を経由」ルール）。
 * base=/lirmena/。目次では ep1 が「太陽の行く先」というタイトルで表示される（episodes.json）。
 */

import { test, expect } from './_fixtures';

test('目次 → タイトル(01-00) → reader(01-01)', async ({ page }) => {
    // 目次
    await page.goto('/lirmena/');
    await expect(page.locator('#episodes-area')).toBeVisible();
    // ep1 の第1リンク（sec1）= タイトルページへ
    const ep1Sec1 = page.locator('a[href*="contents/01-00.html"]').first();
    await expect(ep1Sec1).toBeVisible();
    await ep1Sec1.click();

    // タイトル
    await page.waitForURL(/contents\/01-00\.html/);
    await expect(page.locator('#title-screen')).toBeVisible();
    await expect(page.locator('#title-screen-ep-title')).toContainText('太陽の行く先');
    // 「前のエピソードへ」は ep1 では disabled
    await expect(page.locator('#btn-title-prev')).toBeDisabled();

    // 「本文を読む」で reader へ
    await page.locator('#btn-title-enter').click();
    await page.waitForURL(/contents\/01-01\.html/);
    await expect(page.locator('#main-container')).toBeVisible();
    // 本文レンダ完了（scene-content の hidden 解除）
    await expect(page.locator('#scene-content')).toBeVisible();
});
