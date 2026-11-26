/*
 * 骨格 E2E：資料シートの「地図」タブ（要件 06-14）。
 * 地図の部品は map.ts 1 か所が描き、資料シート（ui/world-sheet）に置かれて本文ページ（右下メニュー）から開く
 * （目次の付録カードは map.html へ移る＝e2e/characters-popup.spec.ts が見る）。見るのは「開く／閉じる／地図が届く／
 * ＋−で拡大し端で押せなくなる／別タブ導線が生きている」と、地図の枠（明るい紙）の color-scheme で、
 * 寸法・レイアウトは手動スモークに残す（骨格導線しか見ない方針）。
 */

import { test, expect } from './_fixtures';

// 地図の URL（map.ts の SVG_PATH ＋ base ＋ stage のフラグメント #s0〜#s5）。別タブ導線が本物を指しているかの照合に使う。
const MAP_URL_RE = /\/lirmena\/img\/eshka-map\.svg#s[0-5]$/;

// 地図が届いていて、「原寸で開く」が別タブで地図の SVG そのものを指していること。
async function expectMapReady(page: import('@playwright/test').Page): Promise<void> {
    const link = page.locator('#map-popup-open');
    await expect(link).toHaveAttribute('href', MAP_URL_RE);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    // 地図が実際に届いてページに埋まったこと（取得に失敗すると map.ts が #map-popup-error に差し替えるので svg が出ない）
    await expect(page.locator('#map-popup svg#eshka-map')).toBeVisible();
}

test('本文ページ：キーボードで拡大を端まで押しても、拡大ボタンのフォーカスが残る', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '地図', exact: true }).click();
    await expectMapReady(page);

    const fig = page.locator('#map-popup');
    const plus = page.getByRole('button', { name: '拡大' });
    await plus.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(fig).toHaveAttribute('data-zoom', '3');
    await expect(plus).toHaveAttribute('aria-disabled', 'true');
    // disabled にするとフォーカスが消える（activeElement が body に戻る）。aria-disabled ならボタンに残る
    await expect(plus).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(fig).toHaveAttribute('data-zoom', '3');
    await expect(plus).toBeFocused();
});

test('本文ページ：右下メニューのエシュカ地図が開き、＋／− で拡大・縮小できる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '地図', exact: true }).click();
    await expect(page.locator('#map-overlay')).toBeVisible();
    await expectMapReady(page);

    const fig = page.locator('#map-popup');
    const plus = page.getByRole('button', { name: '拡大' });
    const minus = page.getByRole('button', { name: '縮小' });
    await expect(fig).toHaveAttribute('data-zoom', '1');
    await expect(minus).toHaveAttribute('aria-disabled', 'true');
    await expect(plus).not.toHaveAttribute('aria-disabled', 'true');
    await plus.click();
    await plus.click();
    await expect(fig).toHaveAttribute('data-zoom', '3');
    await expect(plus).toHaveAttribute('aria-disabled', 'true');
    // 端のボタンを押しても、拡大率もスクロール位置も変わらない（aria-disabled は JS で作動を止める）
    const box = page.locator('#map-popup .mv-scroll');
    const pos = () => box.evaluate((el) => [el.scrollLeft, el.scrollTop]);
    const before = await pos();
    // Playwright は aria-disabled のボタンを「押せない」と見て待ち続けるので、判定を飛ばして実際に押す
    await plus.click({ force: true });
    await expect(fig).toHaveAttribute('data-zoom', '3');
    expect(await pos()).toEqual(before);
    // 拡大すると絵が枠より広くなる＝横にスクロールできる
    const scrollable = await page.locator('#map-popup .mv-scroll').evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrollable).toBe(true);
    await minus.click();
    await expect(fig).toHaveAttribute('data-zoom', '2');

    await page.keyboard.press('Escape');
    await expect(page.locator('#world-sheet')).toBeHidden();
    await expect(page.locator('#menu-toggle')).toBeFocused();
});

// ブラウザの部品（スクロールバーなど）の配色：ページの根は暗い配色、明るい紙の地図の枠の中は明るい配色（_palette.css）。
// 拡大して出るスクロールバーが、明るい紙の上で暗い配色のまま浮かないように
test('資料ページ：ページの根は color-scheme: dark、地図の枠（明るい紙）は light', async ({ page }) => {
    await page.goto('/lirmena/map.html');
    await expectMapReady(page);
    const scheme = await page.evaluate(() => ({
        root: getComputedStyle(document.documentElement).colorScheme,
        map: getComputedStyle(document.getElementById('map-popup')!).colorScheme,
    }));
    expect(scheme).toEqual({ root: 'dark', map: 'light' });
});
