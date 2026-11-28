/*
 * 骨格 E2E：設定の行はラジオのまとまり（要件 06-4・08）。
 * 行は <fieldset>＋<legend>、選択肢は <label> で包んだ <input type="radio">（templates/parts/settings.html）。
 * Tab で止まるのが行ごとに 1 つ・行の中は矢印キーで選ぶ、はブラウザの動きなので jsdom では見られない。
 * 行の名前（legend）と選択肢が横に並ぶことも、3 ブラウザの実際のレイアウトでしか確かめられない
 * （legend は既定だと枠の線の上に置かれる特別な箱。_sheet.css が絶対配置で外している）。
 */

import { test, expect } from './_fixtures';
import type { Page } from '@playwright/test';

const openFromReader = async (page: Page) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
};
const openFromToc = async (page: Page) => {
    await page.goto('/lirmena/');
    await page.locator('#idx-btn-settings').click();
    await expect(page.locator('#settings-popup')).toBeVisible();
};

const radio = (page: Page, name: string) => page.locator('#settings-popup').getByRole('radio', { name, exact: true });
const activeName = (page: Page) => page.evaluate(() => {
    const a = document.activeElement as HTMLInputElement | null;
    return a ? `${a.getAttribute('name') ?? a.tagName}=${a.value ?? ''}` : null;
});

for (const [label, open] of [['本文', openFromReader], ['目次', openFromToc]] as const) {
    test(`${label}：行の名前と選択肢が同じ行に横に並び、選択肢の高さは 40px`, async ({ page }) => {
        await open(page);
        const rows = await page.locator('#settings-popup .settings-row').evaluateAll((els) => els.map((row) => {
            const l = row.querySelector('.settings-row__label')!.getBoundingClientRect();
            const o = row.querySelector('.settings-row__opts')!.getBoundingClientRect();
            const r = row.getBoundingClientRect();
            return {
                labelRight: l.right, optsLeft: o.left,
                centerGap: Math.abs((l.top + l.bottom) / 2 - (o.top + o.bottom) / 2),
                optHeights: [...row.querySelectorAll('.settings-opt')].map((x) => x.getBoundingClientRect().height),
                rowHeight: r.height, optsHeight: o.height, optsRightGap: Math.abs(r.right - o.right), labelLeftGap: Math.abs(l.left - r.left),
            };
        }));
        expect(rows).toHaveLength(5);
        for (const r of rows) {
            expect(r.labelRight, '名前は選択肢の左').toBeLessThanOrEqual(r.optsLeft + 0.5);
            expect(r.centerGap, '名前と選択肢の縦の中心がそろう').toBeLessThan(1.5);
            for (const h of r.optHeights) expect(h).toBeCloseTo(40, 0);
            expect(r.rowHeight, '行の高さは選択肢の箱の高さ（fieldset の既定の余白が残っていない）').toBeCloseTo(r.optsHeight, 0);
            expect(r.optsRightGap, '選択肢の箱は行の右端まで').toBeLessThan(1);
            expect(r.labelLeftGap, '名前は行の左端から').toBeLessThan(1);
        }
    });

    test(`${label}：行は名前つきのまとまりで、中の選択肢はラジオ`, async ({ page }) => {
        await open(page);
        const popup = page.locator('#settings-popup');
        for (const [name, n] of [['書字方向', 2], ['段落の空行', 2], ['フォント', 2], ['文字の大きさ', 3], ['文字の太さ', 2]] as const) {
            await expect(popup.getByRole('group', { name, exact: true }).getByRole('radio')).toHaveCount(n);
        }
        // 既定値が選ばれている
        for (const name of ['横書き', 'あり', '明朝', '中', '通常']) await expect(radio(page, name)).toBeChecked();
    });

    test(`${label}：Tab で止まるのは行ごとに 1 つ（選ばれている選択肢）`, async ({ page }) => {
        await open(page);
        await radio(page, '横書き').focus();
        const stops = [await activeName(page)];
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('Tab');
            stops.push(await activeName(page));
        }
        expect(stops).toEqual(['writingMode=horizontal', 'lineGap=on', 'fontFamily=serif', 'fontSize=medium', 'fontWeight=normal']);
    });

    test(`${label}：ラベルの端を押しても選べる（押せる範囲はラベル全体）`, async ({ page }) => {
        await open(page);
        // ラジオの箱がラベルと同じ大きさ（フォーカスの輪郭線はラジオが描くので、選択肢全体を囲む）
        const gaps = await page.locator('#settings-popup .settings-opt').evaluateAll((els) => els.map((l) => {
            const a = l.getBoundingClientRect(), b = l.querySelector('input')!.getBoundingClientRect();
            return Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
        }));
        expect(gaps).toHaveLength(11);
        for (const g of gaps) expect(g).toBeLessThan(0.5);
        await page.locator('#settings-popup .settings-opt', { hasText: '太字' }).click({ position: { x: 4, y: 4 } });
        await expect(radio(page, '太字')).toBeChecked();
        await expect(radio(page, '通常')).not.toBeChecked();
        expect(await page.evaluate(() => localStorage.getItem('lirmena.fontWeight'))).toBe('bold');
    });
}

test('本文：行の中は矢印キーで選べて、選んだ時点で本文に反映される', async ({ page }) => {
    await openFromReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'horizontal');

    // 書字方向：横書き（2 つめ）から ← で縦書きへ
    await radio(page, '横書き').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(radio(page, '縦書き')).toBeChecked();
    await expect(radio(page, '縦書き')).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'vertical');
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, '横書き')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'horizontal');

    // 文字の大きさ：中 → 大 → 中 → 小（端から反対の端へ回るかはブラウザで違うので見ない）
    await radio(page, '中').focus();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, '大')).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('lirmena.fontSize'))).toBe('large');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(radio(page, '小')).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('lirmena.fontSize'))).toBe('small');

    // シートは開いたまま
    await expect(page.locator('#settings-popup')).toBeVisible();
});

test('本文：キーボードで選択肢に入ると輪郭線が出る。マウスで押したときは出ない', async ({ page }) => {
    await openFromReader(page);
    const outline = (name: string) => radio(page, name).evaluate((el) => {
        const cs = getComputedStyle(el);
        return `${cs.outlineStyle} ${cs.outlineWidth}`;
    });
    // プリセットの 2 枚めから Tab ＝ 1 行めの選ばれている選択肢へ
    await page.locator('#settings-popup .settings-preset__btn').nth(1).focus();
    await page.keyboard.press('Tab');
    expect(await activeName(page)).toBe('writingMode=horizontal');
    expect(await outline('横書き')).toBe('solid 2px');

    // マウスで押したとき（WebKit は押してもフォーカスを移さない。どちらでも輪郭線は出ない）
    await radio(page, '太字').click();
    await expect(radio(page, '太字')).toBeChecked();
    expect(await outline('太字')).not.toBe('solid 2px');
});
