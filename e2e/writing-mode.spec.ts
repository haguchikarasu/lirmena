/*
 * 骨格 E2E ②：reader で書字方向を縦横切替すると <html data-writing-mode> が反映される。
 * plan Phase 3 の導線 2 に対応。位置維持は割合ベース（design/architecture.md「依存グラフに現れない結線」：
 * settings.ts→main.ts の onWritingModeChange 注入）で自動保証されるため、ここでは属性反映を骨格として押さえる。
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

// 二重引用符の出し分け（要件 05-4）は CSS だけが担い、jsdom の renderer.test.ts では検証できない。
// 公開本文に “ ” が無いので、renderer.ts が出すのと同じ形の対を先頭段落へ差し込み、本文の内容に依存させない。
// innerText は CSS の display を反映する＝選択コピーで取れる字の近似として見る。
test('二重引用符は横書きで “・縦書きで 〝 に見え、書字方向の切替で即座に入れ替わる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await page.evaluate(() => {
        const p = document.querySelector('#scene-content p');
        if (!p) throw new Error('本文の段落が無い');
        p.id = 'e2e-dq-para';
        const h = document.createElement('span');
        h.className = 'dq-h';
        h.id = 'e2e-dq-h';
        h.textContent = '“';
        const v = document.createElement('span');
        v.className = 'dq-v';
        v.id = 'e2e-dq-v';
        v.textContent = '〝';
        p.prepend(h, v);
    });
    const dqH = page.locator('#e2e-dq-h');
    const dqV = page.locator('#e2e-dq-v');
    const headOfPara = () => page.locator('#e2e-dq-para').evaluate((el) => [...(el as HTMLElement).innerText][0]);

    // 既定の横書き：原稿の字だけが見える
    await expect(dqH).toBeVisible();
    await expect(dqV).toBeHidden();
    expect(await headOfPara()).toBe('“');

    // 縦書き：縦書きの字だけが見える（再描画なし・属性の切替だけで入れ替わる）
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '設定' }).click();
    await page.getByRole('button', { name: '縦書き', exact: true }).click();
    await expect(dqH).toBeHidden();
    await expect(dqV).toBeVisible();
    expect(await headOfPara()).toBe('〝');

    // 横書きに戻す
    await page.getByRole('button', { name: '横書き', exact: true }).click();
    await expect(dqH).toBeVisible();
    await expect(dqV).toBeHidden();
    expect(await headOfPara()).toBe('“');
});
