/*
 * 骨格 E2E：エシュカ地図ポップアップ（要件 06-14）。
 * ポップアップは map.ts 1 か所が中身を生成し、目次ページ（付録カード）と本文ページ（右下メニュー）の
 * 両方から開く。見るのは「開く／閉じる／別タブ導線が生きている／目次で FAB より手前」の 4 点だけで、
 * 寸法・レイアウトは手動スモークに残す（骨格導線しか見ない方針）。
 */

import { test, expect } from './_fixtures';

// 地図画像の URL（map.ts の IMAGE_PATH ＋ base）。別タブ導線が本物を指しているかの照合に使う。
const MAP_URL_RE = /\/lirmena\/img\/eshka-map\.avif$/;

// ポップアップの中身（画像リンクと「原寸で開く」）が、どちらも別タブで画像そのものを指していること。
async function expectOpensImageInNewTab(page: import('@playwright/test').Page): Promise<void> {
    for (const id of ['#map-popup-link', '#map-popup-open']) {
        const link = page.locator(id);
        await expect(link).toHaveAttribute('href', MAP_URL_RE);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
    }
    // 画像が実際に届いていること（404 なら map.ts が #map-popup-error に差し替えるので上の locator が消える）
    await expect(page.locator('#map-popup img')).toBeVisible();
}

test.describe('目次の付録カード', () => {
    test('エシュカ地図：ポップアップが開き、Escape・閉じるボタン・背景クリックで閉じる', async ({ page }) => {
        await page.goto('/lirmena/');
        await page.locator('#idx-appendix > summary').click();

        const overlay = page.locator('#map-overlay');
        const open = async (): Promise<void> => {
            await page.locator('#appendix-map').click();
            await expect(overlay).toBeVisible();
        };

        await open();
        await expectOpensImageInNewTab(page);

        // FAB（z-index 100）がポップアップの上に出ていない＝FAB の位置で一番上にあるのはオーバーレイ
        const onTop = await page.evaluate(() => {
            const r = document.getElementById('fab-toggle')!.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return document.getElementById('map-overlay')!.contains(el);
        });
        expect(onTop).toBe(true);

        await page.keyboard.press('Escape');
        await expect(overlay).toBeHidden();
        // Escape はポップアップを閉じるだけで、FAB メニューを開かない
        await expect(page.locator('#fab-panel')).toBeHidden();

        await open();
        await page.locator('#map-popup-close').click();
        await expect(overlay).toBeHidden();

        await open();
        await overlay.click({ position: { x: 5, y: 5 } });
        await expect(overlay).toBeHidden();
    });
});

test('本文ページ：右下メニューのエシュカ地図が開き、各方法で閉じる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    const overlay = page.locator('#map-overlay');
    const open = async (): Promise<void> => {
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: 'エシュカ地図' }).click();
        await expect(overlay).toBeVisible();
    };

    await open();
    await expectOpensImageInNewTab(page);

    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();

    await open();
    await page.locator('#map-popup-close').click();
    await expect(overlay).toBeHidden();

    await open();
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toBeHidden();
});
