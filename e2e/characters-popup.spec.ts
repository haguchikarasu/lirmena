/*
 * 骨格 E2E：キャラクター紹介ポップアップ（要件 06-8）と目次の付録カード（要件 06-7）。
 * ポップアップは characters.ts 1 か所が中身を生成し、本文ページ（右下メニュー）と目次ページ（付録カード）の
 * 両方から開く。切り出しで本文側が壊れていないことと、目次側の結線（Stage・Escape・重なり順）を見る。
 *
 * 期待するキャラ数は public/characters.json から読む（本番データの公開範囲は vol1 だけ＝読者は Stage 1）。
 */

import { readFileSync } from 'node:fs';
import { test, expect } from './_fixtures';

// e2e は ES モジュールとして読まれる＝__dirname が無いので import.meta.url から辿る
type Entry = { volume: number; characters: unknown[] };
const CHARACTERS = JSON.parse(
    readFileSync(new URL('../public/characters.json', import.meta.url), 'utf-8'),
) as Entry[];
const VOL1_COUNT = CHARACTERS.find(c => c.volume === 1)!.characters.length;

test.describe('目次の付録カード', () => {
    test('初期状態は閉じていて、未公開の項目（地図・用語集）は見えない', async ({ page }) => {
        await page.goto('/lirmena/');
        const card = page.locator('#idx-appendix');
        await expect(card).toBeVisible();
        await expect(card).not.toHaveAttribute('open');
        await expect(page.locator('#appendix-chara-btn')).toBeHidden();

        await page.locator('#idx-appendix > summary').click();
        await expect(page.locator('#appendix-chara-btn')).toBeVisible();
        await expect(page.locator('#appendix-map')).toBeHidden();
        await expect(page.locator('#appendix-glossary')).toBeHidden();
    });

    test('キャラクター紹介：今の Stage のキャラが出て、Escape・閉じるボタン・背景クリックで閉じる', async ({ page }) => {
        await page.goto('/lirmena/');
        await page.locator('#idx-appendix > summary').click();

        const overlay = page.locator('#characters-overlay');
        const open = async (): Promise<void> => {
            await page.locator('#appendix-chara-btn').click();
            await expect(overlay).toBeVisible();
        };

        await open();
        await expect(overlay.locator('.character-card')).toHaveCount(VOL1_COUNT);

        // FAB（z-index 100）がポップアップの上に出ていない＝FAB の位置で一番上にあるのはオーバーレイ
        const onTop = await page.evaluate(() => {
            const r = document.getElementById('fab-toggle')!.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return document.getElementById('characters-overlay')!.contains(el);
        });
        expect(onTop).toBe(true);

        await page.keyboard.press('Escape');
        await expect(overlay).toBeHidden();
        // Escape はポップアップを閉じるだけで、FAB メニューを開かない
        await expect(page.locator('#fab-panel')).toBeHidden();

        await open();
        await page.locator('#characters-popup-close').click();
        await expect(overlay).toBeHidden();

        await open();
        await overlay.click({ position: { x: 5, y: 5 } });
        await expect(overlay).toBeHidden();
    });
});

test('本文ページ：右下メニューのキャラクター紹介が開き、各方法で閉じる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    const overlay = page.locator('#characters-overlay');
    const open = async (): Promise<void> => {
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: 'キャラクター紹介' }).click();
        await expect(overlay).toBeVisible();
    };

    await open();
    await expect(overlay.locator('.character-card')).toHaveCount(VOL1_COUNT);

    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();

    await open();
    await page.locator('#characters-popup-close').click();
    await expect(overlay).toBeHidden();

    await open();
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toBeHidden();
});
