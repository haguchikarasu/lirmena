/*
 * 骨格 E2E ③：reader 起動後に感想窓口 #btn-share-group が現れ、#btn-share-x の href に ep/sec が入る。
 * あわせて「X でポスト」の X の後ろの空き（縦書きで詰める・横書きで残す）を見る。
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

// 「X でポスト」の X と「でポスト」の間（v4.2.2 の回帰防止）。縦書きは X を立てる upright が半角スペースまで
// 立てて 1 文字分空いていたので、空白を消して詰める。横書きは空白を残す。空きは CSS だけが決める＝jsdom では測れない。
// 字の位置は Range の外接矩形で取り、縦書きは「X の下端と『で』の上端の差」、横書きは「X の右端と『で』の左端の差」を見る。
test('「X でポスト」は縦書きで X の後ろを詰め、横書きでは空白を残す', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#btn-share-group')).toBeVisible();
    const gapAfterX = () => page.locator('#btn-share-x-label').evaluate((label) => {
        const x = label.firstChild;
        const de = label.lastChild;
        if (!x || !de) throw new Error('ラベルの字が無い');
        const rectOf = (node: Node) => {
            const r = document.createRange();
            r.setStart(node, 0);
            r.setEnd(node, 1);
            return r.getBoundingClientRect();
        };
        const a = rectOf(x);
        const b = rectOf(de);
        const vertical = document.documentElement.dataset.writingMode === 'vertical';
        return vertical ? b.top - a.bottom : b.left - a.right;
    });
    // 読み上げの名前は書字方向によらず「X でポスト」
    await expect(page.getByRole('link', { name: 'X でポスト', exact: true })).toBeVisible();

    // 既定の横書き：空白ぶん（数 px）空く
    expect(await gapAfterX()).toBeGreaterThan(2);

    // 縦書き：詰める（修正前は 1 文字ぶん＝十数 px 空いていた）
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '設定' }).click();
    await page.getByRole('button', { name: '縦書き', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'vertical');
    expect(Math.abs(await gapAfterX())).toBeLessThan(1);
});
