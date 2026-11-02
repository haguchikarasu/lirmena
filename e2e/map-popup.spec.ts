/*
 * 骨格 E2E：資料シートの「地図」タブ（要件 06-14）。
 * 地図の部品は map.ts 1 か所が描き、資料シート（ui/world-sheet）に置かれて本文ページ（右下メニュー）から開く
 * （目次の付録カードは map.html へ移る＝e2e/characters-popup.spec.ts が見る）。見るのは「開く／閉じる／画像が届く／
 * ＋−で拡大し端で押せなくなる／別タブ導線が生きている」で、寸法・レイアウトは手動スモークに残す（骨格導線しか見ない方針）。
 */

import { test, expect } from './_fixtures';

// 地図画像の URL（map.ts の IMAGE_PATH ＋ base）。別タブ導線が本物を指しているかの照合に使う。
const MAP_URL_RE = /\/lirmena\/img\/eshka-map\.avif$/;

// 地図が届いていて、「原寸で開く」が別タブで画像そのものを指していること。
async function expectMapReady(page: import('@playwright/test').Page): Promise<void> {
    const link = page.locator('#map-popup-open');
    await expect(link).toHaveAttribute('href', MAP_URL_RE);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // 画像が実際に届いていること（404 なら map.ts が #map-popup-error に差し替えるので img が消える）
    await expect(page.locator('#map-popup img')).toBeVisible();
}

test('本文ページ：右下メニューのエシュカ地図が開き、＋／− で拡大・縮小できる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: 'エシュカ地図' }).click();
    await expect(page.locator('#map-overlay')).toBeVisible();
    await expectMapReady(page);

    const fig = page.locator('#map-popup');
    const plus = page.getByRole('button', { name: '拡大' });
    const minus = page.getByRole('button', { name: '縮小' });
    await expect(fig).toHaveAttribute('data-zoom', '1');
    await expect(minus).toBeDisabled();
    await plus.click();
    await plus.click();
    await expect(fig).toHaveAttribute('data-zoom', '3');
    await expect(plus).toBeDisabled();
    // 拡大すると絵が枠より広くなる＝横にスクロールできる
    const scrollable = await page.locator('#map-popup .mv-scroll').evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrollable).toBe(true);
    await minus.click();
    await expect(fig).toHaveAttribute('data-zoom', '2');

    await page.keyboard.press('Escape');
    await expect(page.locator('#world-sheet')).toBeHidden();
    await expect(page.locator('#menu-toggle')).toBeFocused();
});
