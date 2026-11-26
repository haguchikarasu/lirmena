/*
 * 受け入れテスト：動きを減らす設定（prefers-reduced-motion）。基準は design/architecture.md の「動きを減らす設定」。
 *   動き（移動・拡大・回転・滑らかなスクロール）は no-preference のときだけ付け、色・不透明度の変化は設定に関係なく残す。
 * 見るのは計算後のスタイルと、スクロールの実際の位置。各項目に、no-preference のときは今までと同じであることの対照を置く。
 * 設定は emulateMedia で切り替える（test.use({ reducedMotion }) は @playwright/test の直下のオプションに無く、黙って無視される。
 * opening.spec.ts と同じ）。届いていることは各検査の冒頭で matchMedia を読んで確かめる。
 * 静的な約束（CSS の書き方・behavior: 'smooth' を裸で書かない）は src/html-contract.test.ts が CI で見る。
 */

import type { Page } from '@playwright/test';
import { test, expect } from './_fixtures';
import { scrollToRatio, setupRoutes, setWritingMode, waitReader } from './_records';

const PREFS = ['reduce', 'no-preference'] as const;
type Pref = (typeof PREFS)[number];

async function usePref(page: Page, pref: Pref): Promise<void> {
    await page.emulateMedia({ reducedMotion: pref });
}

async function expectPref(page: Page, pref: Pref): Promise<void> {
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), '設定が届いている').toBe(pref === 'reduce');
}

// 計算後の transition-property を 1 つずつに分けて返す
async function transitionProps(page: Page, selector: string): Promise<string[]> {
    const v = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).transitionProperty);
    return v.split(',').map((s) => s.trim());
}

for (const pref of PREFS) {
    test.describe(`prefers-reduced-motion: ${pref}`, () => {
        test.beforeEach(async ({ page }) => { await usePref(page, pref); });

        test('用語の相互参照：着地した項目は背景が光り、枠線は残らない', async ({ page }) => {
            await page.goto('/lirmena/glossary.html');
            await expectPref(page, pref);
            await page.locator('#g-光輝 a.gl-ref').click();
            const target = page.locator('#g-リルム');
            await expect(target).toHaveClass(/\bgl-flash\b/);
            // 光る（背景色が薄れる）のは設定に関係なく付く。移動ではないので
            expect(await target.evaluate((el) => getComputedStyle(el).animationName)).toBe('gl-flash');
            // 光り終わった後も枠線は無い（クラスは次の着地まで外れないので、クラスに枠線を付けると残り続ける）
            await page.waitForTimeout(1600);
            expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
        });

        test('目次の巻の ▶：色の transition は常に、回転の transition は no-preference のときだけ', async ({ page }) => {
            await page.goto('/lirmena/');
            await expectPref(page, pref);
            const props = await transitionProps(page, '.idx-vol-chev');
            expect(props).toContain('color');
            if (pref === 'reduce') expect(props).not.toContain('rotate');
            else expect(props).toContain('rotate');
        });

        test('人物の顔：拡大の transition は no-preference のときだけ。枠の色と明るさの transition は常に', async ({ page }) => {
            await page.goto('/lirmena/contents/01-01.html');
            await expect(page.locator('#main-container')).toBeVisible();
            await expectPref(page, pref);
            await page.locator('#menu-toggle').click();
            await page.getByRole('button', { name: '人物', exact: true }).click();
            const face = '#characters-overlay .cv-face img, #characters-overlay .cv-face .cv-face-initial';
            await expect(page.locator(face).first()).toBeVisible();
            const props = await transitionProps(page, face);
            expect(props).toEqual(expect.arrayContaining(['border-color', 'filter']));
            if (pref === 'reduce') expect(props).not.toContain('scale');
            else expect(props).toContain('scale');
            // 選んだ顔が少し大きいのは設定に関係なく同じ（止めるのは動きだけ）
            const pressed = page.locator('#characters-overlay .cv-face[aria-pressed="true"] img, #characters-overlay .cv-face[aria-pressed="true"] .cv-face-initial');
            await expect.poll(() => pressed.first().evaluate((el) => getComputedStyle(el).scale)).toBe('1.06');
        });

        test('縦書きのホイール：reduce は次のフレームで目的の位置にいる。no-preference は滑らかに動く', async ({ page }) => {
            await setupRoutes(page);
            await setWritingMode(page, 'vertical');
            await page.goto('/lirmena/contents/01-02.html');
            await waitReader(page);
            await expectPref(page, pref);
            // 開幕（先頭の黒い余白）を外れた本文の途中から回す
            await scrollToRatio(page, 0.3);
            await page.waitForTimeout(300);
            const box = (await page.locator('#main-container').boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            const at = () => page.evaluate(() => Math.abs(document.getElementById('main-container')!.scrollLeft));
            const start = await at();
            await page.mouse.wheel(0, 200);
            const nextFrame = await page.evaluate(() => new Promise<number>((res) => {
                requestAnimationFrame(() => res(Math.abs(document.getElementById('main-container')!.scrollLeft)));
            }));
            await page.waitForTimeout(1000);
            const settled = await at();
            expect(settled - start, 'ホイール 1 回で進む').toBeGreaterThan(100);
            if (pref === 'reduce') expect(Math.abs(settled - nextFrame), '次のフレームで着いている').toBeLessThanOrEqual(1);
            else expect(settled - nextFrame, '次のフレームではまだ途中').toBeGreaterThan(1);
        });
    });
}
