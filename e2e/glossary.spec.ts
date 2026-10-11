/*
 * 骨格 E2E：用語集（要件 06-15）。
 * 一覧は glossary.ts 1 か所が描き、目次からは別ページ（glossary.html）、本文からは右下メニューのポップアップで開く。
 * 見るのは導線（目次 → ページ → 目次、本文 → ポップアップ）と、?dev の引き継ぎ・検索・相互参照・直リンクの着地・
 * 閉じ方。寸法・色は手動スモークに残す（骨格導線しか見ない方針）。
 *
 * ?dev の引き継ぎ（3 箇所）を見る検査はここだけ＝Playwright は CI に入っていないので、ローカルで回したときだけ効く。
 */

import { readFileSync } from 'node:fs';
import { test, expect } from './_fixtures';

// 見出し語の数（`## ` の行）。件数表示の照合に使う。
// e2e は ES モジュールとして読まれる＝__dirname が無いので import.meta.url から辿る（characters-popup.spec.ts と同じ）
const TERM_COUNT = (readFileSync(new URL('../public/glossary.md', import.meta.url), 'utf-8').match(/^## /gm) ?? []).length;

test.describe('目次 → 用語集ページ', () => {
    test('付録チップから同じタブで開き、全件が出て、目次へ戻れる', async ({ page }) => {
        await page.goto('/lirmena/');
        await page.locator('#idx-appendix > summary').click();
        await page.locator('#appendix-glossary').click();

        await expect(page).toHaveURL(/\/lirmena\/glossary\.html$/);
        await expect(page.locator('#gl-title')).toHaveText('用語集');
        await expect(page.locator('#gl-count')).toHaveText(`全 ${TERM_COUNT} 語`);
        await expect(page.locator('#gl-list .gl-entry')).toHaveCount(TERM_COUNT);

        await page.locator('#gl-back').click();
        await expect(page).toHaveURL(/\/lirmena\/$/);
    });

    test('?dev を目次 → 用語集 → 目次と引き継ぐ', async ({ page }) => {
        await page.goto('/lirmena/?dev');
        await page.locator('#idx-appendix > summary').click();
        await expect(page.locator('#appendix-glossary')).toHaveAttribute('href', 'glossary.html?dev');
        await page.locator('#appendix-glossary').click();
        await expect(page).toHaveURL(/\/lirmena\/glossary\.html\?dev$/);

        await page.locator('#gl-back').click();
        await expect(page).toHaveURL(/\/lirmena\/\?dev$/);
    });

    test('検索：ひらがなでカタカナの語に当たり、消すと全件に戻る', async ({ page }) => {
        await page.goto('/lirmena/glossary.html');
        const visible = page.locator('#gl-list .gl-entry:not([hidden])');
        await expect(visible).toHaveCount(TERM_COUNT);

        await page.locator('#gl-search').fill('えしゅか');
        await expect(page.locator('#g-エシュカ')).toBeVisible();
        expect(await visible.count()).toBeLessThan(TERM_COUNT);
        await expect(page.locator('#gl-count')).toHaveText(/件$/);

        await page.locator('#gl-search').fill('');
        await expect(visible).toHaveCount(TERM_COUNT);
    });

    test('相互参照で飛び先へ着地し、固定バーの下に隠れない', async ({ page }) => {
        await page.goto('/lirmena/glossary.html');
        await page.locator('#g-光輝 a.gl-ref').click();
        await expect(page).toHaveURL(/#g-/);
        await expectLandedBelowStickyBar(page, '#g-リルム');
    });

    test('直リンク #g-見出し語 で開くとその項目へ着地する', async ({ page }) => {
        await page.goto('/lirmena/glossary.html#g-リルム');
        await expectLandedBelowStickyBar(page, '#g-リルム');
    });
});

// 項目の上端が固定バー（検索と五十音）のすぐ下にある＝バーに隠れず、画面の上の方に来ている
async function expectLandedBelowStickyBar(page: import('@playwright/test').Page, selector: string): Promise<void> {
    await expect.poll(async () => page.evaluate((sel) => {
        const bar = document.getElementById('gl-sticky')!.getBoundingClientRect();
        const top = document.querySelector(sel)!.getBoundingClientRect().top;
        return top >= bar.bottom - 1 && top < bar.bottom + 40;
    }, selector)).toBe(true);
}

test.describe('本文 → 用語集ポップアップ', () => {
    const openPopup = async (page: import('@playwright/test').Page): Promise<void> => {
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: '用語集' }).click();
        await expect(page.locator('#glossary-overlay')).toBeVisible();
    };

    test('右下メニューから開き、一覧が出て、各方法で閉じる', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        const overlay = page.locator('#glossary-overlay');

        await openPopup(page);
        await expect(page.locator('#glossary-popup-list .gl-entry')).toHaveCount(TERM_COUNT);
        // 「ページで開く」は別タブで用語集ページを指す
        const pageLink = page.locator('#glossary-popup-page');
        await expect(pageLink).toHaveAttribute('href', '/lirmena/glossary.html');
        await expect(pageLink).toHaveAttribute('target', '_blank');

        await page.keyboard.press('Escape');
        await expect(overlay).toBeHidden();
        // 閉じたらフォーカスはメニューボタンへ戻る
        await expect(page.locator('#menu-toggle')).toBeFocused();

        await openPopup(page);
        await page.locator('#glossary-popup-close').click();
        await expect(overlay).toBeHidden();

        await openPopup(page);
        await overlay.click({ position: { x: 5, y: 5 } });
        await expect(overlay).toBeHidden();
    });

    test('検索欄に文字があるときの Escape は欄を消すだけで、次の Escape で閉じる', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await openPopup(page);

        const search = page.locator('#glossary-search');
        await search.fill('りるむ');
        await search.press('Escape');
        await expect(page.locator('#glossary-overlay')).toBeVisible();

        await search.fill('');
        await search.press('Escape');
        await expect(page.locator('#glossary-overlay')).toBeHidden();
    });

    test('?dev を「ページで開く」に引き継ぐ', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html?dev');
        await expect(page.locator('#main-container')).toBeVisible();
        await openPopup(page);
        await expect(page.locator('#glossary-popup-page')).toHaveAttribute('href', '/lirmena/glossary.html?dev');
    });
});
