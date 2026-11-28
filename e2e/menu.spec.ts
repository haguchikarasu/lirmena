/*
 * 骨格 E2E：本文ページの右下メニュー（#menu-toggle と #menu-panel。popover="auto" ＋ commandfor/command="toggle-popover"。src/menu.ts）。
 *
 * 見ているのは、jsdom では決まらないもの（ブラウザが持つ開閉の動き）：
 *   - クリックでの開閉と aria-expanded、マウスで開いたときはフォーカスを項目へ入れず、キーボードで開いたときだけ先頭へ入れる
 *   - ↓↑・Home・End（端で止まる）、Escape で閉じてボタンへ戻る（鑑賞モードへ入らない）、外側クリックで閉じる、Tab で外へ出ると閉じる
 *   - 項目を押すと閉じてから実行する（設定シート）、構造（button 8 個・hr 2 本・role なし）
 *   - フォーカスの輪郭線（キーボードだけ）、パネルの位置（PC・スマホ縦・スマホ横）、開いている間は本文が動かない
 *
 * 時間には頼らない：待ちは expect（自動再試行）・expect.poll と、ページの中の rAF（フレーム）だけで書く。
 */

import type { Page } from '@playwright/test';
import { test, expect } from './_fixtures';
import { setupRoutes, waitReader } from './_records';

const LABELS = ['目次へもどる', '栞を追加', 'チュートリアル', '人物', '地図', '用語', '設定', '共有'];

const toggle = (page: Page) => page.locator('#menu-toggle');
const panel = (page: Page) => page.locator('#menu-panel');
const item = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true });

// 本文ページを開く（開幕のまま）
async function openReader(page: Page): Promise<void> {
    await setupRoutes(page);
    await page.goto('/lirmena/contents/01-02.html');
    await waitReader(page);
    await expect(page.locator('html')).toHaveClass(/\bat-opening\b/);
}

// 「読み進める」を押して開幕を抜ける（鑑賞モードは開幕の間は入らないため）。位置が落ち着くまでフレームで待つ
async function leaveOpening(page: Page): Promise<void> {
    await page.locator('#opening-start').click();
    await expect(page.locator('html')).not.toHaveClass(/\bat-opening\b/);
    await settleScroll(page);
}

// 進行軸の位置が 10 フレーム続けて変わらなくなるまで待って返す（上限 240 フレーム）
function settleScroll(page: Page): Promise<number> {
    return page.evaluate(() => new Promise<number>((resolve) => {
        const c = document.querySelector<HTMLElement>('#main-container')!;
        const v = document.documentElement.getAttribute('data-writing-mode') === 'vertical';
        const read = (): number => (v ? Math.abs(c.scrollLeft) : c.scrollTop);
        let last = read();
        let still = 0;
        let frames = 0;
        const tick = (): void => {
            const now = read();
            still = Math.abs(now - last) < 0.5 ? still + 1 : 0;
            last = now;
            frames += 1;
            if (still >= 10 || frames >= 240) resolve(now);
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }));
}

// フレームを 3 つ進める（「起きないはずの変化」を見る前に、起きるなら起きている頃まで描画で待つ）
const settleFrames = (page: Page): Promise<void> =>
    page.evaluate(() => new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => res())));
    }));

// マウスで開く
async function openByMouse(page: Page): Promise<void> {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page)).toBeVisible();
}

// キーボードで開く（Enter）。先頭の項目へフォーカスが入るまで待つ
async function openByKeyboard(page: Page, key: 'Enter' | 'Space' = 'Enter'): Promise<void> {
    await toggle(page).focus();
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press(key);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(item(page, LABELS[0])).toBeFocused();
}

const isPopoverOpen = (page: Page): Promise<boolean> => panel(page).evaluate((el) => el.matches(':popover-open'));
const focusInPanel = (page: Page): Promise<boolean> => page.evaluate(() => !!document.activeElement?.closest('#menu-panel'));
const isImmersive = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.classList.contains('is-immersive'));

test.describe('開閉', () => {
    test('M1 クリックで開き、もう一度クリックで閉じる。aria-expanded が合い、開いている間は :popover-open', async ({ page }) => {
        await openReader(page);
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(panel(page)).toBeHidden();

        await toggle(page).click();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(panel(page)).toBeVisible();
        expect(await isPopoverOpen(page), '開いている間は :popover-open').toBe(true);

        await toggle(page).click();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(panel(page)).toBeHidden();
        expect(await isPopoverOpen(page), '閉じたら :popover-open でない').toBe(false);
    });

    test('M2 マウスで開いてもフォーカスは項目に入らず、↓ を 1 回押すと「目次へもどる」に入る', async ({ page }) => {
        await openReader(page);
        await openByMouse(page);
        // 開いた少しあとに届く通知で動かされないことを見るため、フレームを進めてから確かめる
        await settleFrames(page);
        expect(await focusInPanel(page), 'マウスで開いたらフォーカスは項目に入らない').toBe(false);

        await page.keyboard.press('ArrowDown');
        await expect(item(page, LABELS[0])).toBeFocused();
    });

    test('M3 Enter で開くと先頭の「目次へもどる」にフォーカスが入る（Space でも）', async ({ page }) => {
        await openReader(page);
        await openByKeyboard(page, 'Enter');
        // 閉じてから Space で開き直す
        await page.keyboard.press('Escape');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle(page)).toBeFocused();
        await page.keyboard.press('Space');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(item(page, LABELS[0])).toBeFocused();
    });
});

test.describe('開いている間のキー', () => {
    test('M4 ↓↑ で項目を移り、端では止まり、Home で最初・End で最後（共有）', async ({ page }) => {
        await openReader(page);
        await openByKeyboard(page);

        await page.keyboard.press('ArrowUp');
        await expect(item(page, '目次へもどる'), '先頭で ↑ は止まる（回り込まない）').toBeFocused();

        await page.keyboard.press('ArrowDown');
        await expect(item(page, '栞を追加')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(item(page, 'チュートリアル')).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(item(page, '栞を追加')).toBeFocused();

        await page.keyboard.press('End');
        await expect(item(page, '共有')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(item(page, '共有'), '末尾で ↓ は止まる（回り込まない）').toBeFocused();

        await page.keyboard.press('Home');
        await expect(item(page, '目次へもどる')).toBeFocused();
        expect(await isPopoverOpen(page), '操作の間ずっと開いたまま').toBe(true);
    });

    test('M5 Escape で閉じてフォーカスが #menu-toggle に戻り、鑑賞モードへは入らない。閉じたあとの Escape では入る', async ({ page }) => {
        await openReader(page);
        await leaveOpening(page);
        await openByMouse(page);
        await page.keyboard.press('ArrowDown');
        await expect(item(page, LABELS[0])).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle(page)).toBeFocused();
        await expect(panel(page)).toBeHidden();
        await settleFrames(page);
        expect(await isImmersive(page), 'メニューを閉じた Escape では鑑賞モードに入らない').toBe(false);

        await page.keyboard.press('Escape');
        await expect(page.locator('html'), '閉じた状態の Escape で鑑賞モードに入る').toHaveClass(/\bis-immersive\b/);
    });

    test('M6 メニューの外（本文の地）をクリックすると閉じ、鑑賞モードへは入らない', async ({ page }) => {
        await openReader(page);
        await leaveOpening(page);
        await openByMouse(page);

        // ボタン・リンク・メニューの無い、画面左上寄りの本文の地
        await page.mouse.click(60, 60);
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(panel(page)).toBeHidden();
        await settleFrames(page);
        expect(await isImmersive(page), '外側クリックで閉じたときは鑑賞モードに入らない').toBe(false);
    });

    test('M7a Tab（最後の項目「共有」から）でメニューの外へ出ると閉じる', async ({ page }) => {
        await openReader(page);
        await openByKeyboard(page);

        await page.keyboard.press('End');
        await expect(item(page, '共有')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(panel(page)).toBeHidden();
        // メニューはページの最後の部品で、この先はブラウザの UI。Playwright の Firefox はページの外へ Tab で出ないので、
        // フォーカスの行き先は決めない（閉じたパネルの中に残っていないことだけ見る）
        expect(await page.evaluate(() => document.getElementById('menu-panel')!.contains(document.activeElement)), 'フォーカスが閉じたパネルの中に残らない').toBe(false);
    });

    test('M7b Shift+Tab（#menu-toggle から）でメニューの外へ出ると閉じる。ボタンへは引き戻さない', async ({ page }) => {
        await openReader(page);
        await openByKeyboard(page);
        await toggle(page).focus();
        await expect(toggle(page)).toBeFocused();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Shift+Tab');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(panel(page)).toBeHidden();
        await expect(toggle(page), 'Shift+Tab で出たときもボタンへ引き戻さない').not.toBeFocused();
    });

    test('M12 開いている間は End で本文が動かない', async ({ page }) => {
        await openReader(page);
        const before = await settleScroll(page);
        await openByMouse(page);
        await page.keyboard.press('End');
        // End はメニュー内で最後の項目へ移る（本文へ流れない）
        await expect(item(page, '共有')).toBeFocused();
        const after = await settleScroll(page);
        expect(Math.abs(after - before), '本文の位置は変わらない').toBeLessThanOrEqual(1);
        expect(await isPopoverOpen(page)).toBe(true);
    });
});

test.describe('項目の実行', () => {
    test('M8 「設定」を押すとメニューが隠れて設定シートが出る。Escape で閉じるとフォーカスが #menu-toggle に戻る', async ({ page }) => {
        await openReader(page);
        await openByMouse(page);
        await item(page, '設定').click();

        await expect(panel(page)).toBeHidden();
        await expect(page.locator('#settings-popup')).toBeVisible();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');

        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-popup')).toBeHidden();
        await expect(toggle(page)).toBeFocused();
    });
});

test.describe('構造とフォーカスの見た目', () => {
    test('M9 項目は <button> 8 個、区切りは <hr> 2 本（チュートリアルの後・用語の後）。role="menu"・"menuitem" は付かない', async ({ page }) => {
        await openReader(page);
        const info = await panel(page).evaluate((el) => ({
            kids: [...el.children].map((c) => c.tagName + ':' + (c.tagName === 'BUTTON' ? (c.textContent ?? '').trim() : '')),
            hasMenuRole: el.hasAttribute('role') || el.querySelector('[role="menu"], [role="menuitem"]') !== null,
        }));
        expect(info.hasMenuRole, 'role は付かない').toBe(false);
        expect(info.kids).toEqual([
            ...LABELS.slice(0, 3).map((l) => 'BUTTON:' + l),
            'HR:',
            ...LABELS.slice(3, 6).map((l) => 'BUTTON:' + l),
            'HR:',
            ...LABELS.slice(6).map((l) => 'BUTTON:' + l),
        ]);
        expect(await panel(page).locator('button').count()).toBe(8);
        expect(await panel(page).locator('hr').count()).toBe(2);
    });

    test('M10 キーボードで項目に入ると輪郭線（2px）が出て、マウスを乗せただけでは出ない', async ({ page }) => {
        await openReader(page);
        await openByKeyboard(page);
        await page.keyboard.press('ArrowDown');
        const focused = item(page, '栞を追加');
        await expect(focused).toBeFocused();
        const ring = await focused.evaluate((el) => {
            const s = getComputedStyle(el);
            return { style: s.outlineStyle, width: s.outlineWidth };
        });
        expect(ring.style, 'キーボードで入ったら輪郭線が出る').not.toBe('none');
        expect(ring.width).toBe('2px');

        // 閉じて、マウスで開き直し、項目に乗せるだけ
        await page.keyboard.press('Escape');
        await expect(panel(page)).toBeHidden();
        await openByMouse(page);
        const hovered = item(page, '地図');
        await hovered.hover();
        const hoverRing = await hovered.evaluate((el) => getComputedStyle(el).outlineStyle);
        expect(hoverRing, 'マウスを乗せただけでは輪郭線が出ない').toBe('none');
    });
});

test.describe('位置', () => {
    // パネルの右端がボタンの右端と同じ、下端がボタンの上端より 0.6rem（9.6px）上
    async function expectAnchored(page: Page): Promise<void> {
        const p = (await panel(page).boundingBox())!;
        const t = (await toggle(page).boundingBox())!;
        expect(Math.abs(p.x + p.width - (t.x + t.width)), '右端がボタンの右端と同じ').toBeLessThanOrEqual(1);
        expect(Math.abs(t.y - (p.y + p.height) - 9.6), '下端がボタンの上端より 0.6rem 上').toBeLessThanOrEqual(1);
    }

    test('M11a PC（1280×800）', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openReader(page);
        await openByMouse(page);
        await expectAnchored(page);
    });

    test('M11b スマホ縦（375×812）', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await openReader(page);
        await openByMouse(page);
        await expectAnchored(page);
    });

    test('M11c スマホ横（844×390）：上端が画面内で、先頭の「目次へもどる」が押せる位置にある', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        await openReader(page);
        await openByMouse(page);
        const p = (await panel(page).boundingBox())!;
        expect(p.y, 'パネルの上端が画面の中').toBeGreaterThanOrEqual(0);
        await expect(item(page, '目次へもどる')).toBeInViewport();
        const first = (await item(page, '目次へもどる').boundingBox())!;
        expect(first.y, '先頭の項目の上端が画面の中').toBeGreaterThanOrEqual(0);
    });
});
