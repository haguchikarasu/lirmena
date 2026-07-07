/*
 * 骨格 E2E ③：reader 起動後に感想窓口 #btn-share-group が現れ、#btn-share-x の href に ep/sec が入る。
 * plan Phase 3 の導線 4 に対応（feedback.ts の init 契約）。
 * href フォーマット（feedback.ts の IF）：
 *   text = `✨輝くもの《リルメナ》✨第{ep}話 #{sec}\n{URL}` を encodeURIComponent して
 *          `https://x.com/intent/tweet?text=...` に載せる。
 * 期待値の導出は仕様（feedback.ts IF）から。実装のミラーではなく contract を確認する。
 */

import { test, expect } from './_fixtures';

test('reader(01-01) で感想窓口が表示され X 共有 href に ep/sec が入る', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    const group = page.locator('#btn-share-group');
    // feedback.init() 呼び出しで hidden が外れる
    await expect(group).toBeVisible();

    const xBtn = page.locator('#btn-share-x');
    const href = await xBtn.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href!).toMatch(/^https:\/\/x\.com\/intent\/tweet\?text=/);
    // encodeURIComponent('第1話') = %E7%AC%AC1%E8%A9%B1
    expect(href!).toContain('%E7%AC%AC1%E8%A9%B1');
    // encodeURIComponent('#1') = %231
    expect(href!).toContain('%231');
});
