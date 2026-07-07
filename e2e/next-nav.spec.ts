/*
 * 骨格 E2E ④：reader の「次へ」導線が次 sec ページへ進む。
 * plan Phase 3 の導線 5 に対応。ep1 sec1 → ep1 sec2 を確認する。
 * transition.ts の離脱フェード経由の location.href 遷移だが、Playwright は自動で follow する。
 */

import { test, expect } from './_fixtures';

test('reader(01-01) の「次へ」で reader(01-02) へ遷移する', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await expect(page.locator('#btn-next')).toBeVisible();

    await page.locator('#btn-next').click();
    await page.waitForURL(/contents\/01-02\.html/, { timeout: 10_000 });
    await expect(page.locator('#main-container')).toBeVisible();
    await expect(page.locator('#scene-content')).toBeVisible();
});
