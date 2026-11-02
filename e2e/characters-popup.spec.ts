/*
 * 骨格 E2E：資料シートの「人物」タブ（要件 06-8）と目次の付録カード（要件 06-7）。
 * 人物の部品は characters.ts 1 か所が描き、資料シート（ui/world-sheet）に置かれて、本文ページ（右下メニュー）と
 * 目次ページ（付録カード）の両方から開く。見るのは「開く／人物が出る／選べる／閉じ方／閉じたあとのフォーカス／
 * 目次で FAB より手前」で、寸法・レイアウトは手動スモークに残す。
 *
 * 期待するキャラ数は public/characters.json から読む（本番データの公開範囲は vol1 だけ＝読者は Stage 1）。
 */

import { readFileSync } from 'node:fs';
import { test, expect } from './_fixtures';

// e2e は ES モジュールとして読まれる＝__dirname が無いので import.meta.url から辿る
type Entry = { volume: number; characters: { name: string }[] };
const CHARACTERS = JSON.parse(
    readFileSync(new URL('../public/characters.json', import.meta.url), 'utf-8'),
) as Entry[];
const VOL1 = CHARACTERS.find(c => c.volume === 1)!.characters;

test.describe('目次の付録カード', () => {
    test('初期状態は閉じていて、開くと設定の 3 項目が見える', async ({ page }) => {
        await page.goto('/lirmena/');
        const card = page.locator('#idx-appendix');
        await expect(card).toBeVisible();
        await expect(card).not.toHaveAttribute('open');
        await expect(page.locator('#appendix-chara-btn')).toBeHidden();

        await page.locator('#idx-appendix > summary').click();
        await expect(page.locator('#appendix-chara-btn')).toBeVisible();
        // エシュカ地図は 2026-10-09 に公開済み（挙動は e2e/map-popup.spec.ts が見る）
        await expect(page.locator('#appendix-map')).toBeVisible();
        // 用語集は 2026-10-11 に公開（別ページへのリンク。挙動は e2e/glossary.spec.ts が見る）
        await expect(page.locator('#appendix-glossary')).toBeVisible();
    });

    test('キャラクター紹介：資料シートの人物のタブが開き、Escape・閉じるボタン・背景で閉じる', async ({ page }) => {
        await page.goto('/lirmena/');
        await page.locator('#idx-appendix > summary').click();

        const sheet = page.locator('#world-sheet');
        const panel = page.locator('#characters-overlay');
        const open = async (): Promise<void> => {
            await page.locator('#appendix-chara-btn').click();
            await expect(panel).toBeVisible();
        };

        await open();
        await expect(panel.locator('.cv-face')).toHaveCount(VOL1.length);
        await expect(page.getByRole('tab', { name: '人物' })).toHaveAttribute('aria-selected', 'true');

        // シートは <dialog> の最前面の層＝FAB の位置で一番上にあるのはシート
        const onTop = await page.evaluate(() => {
            const r = document.getElementById('fab-toggle')!.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return document.getElementById('world-sheet')!.contains(el);
        });
        expect(onTop).toBe(true);

        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        // Escape はシートを閉じるだけで、FAB メニューを開かない
        await expect(page.locator('#fab-panel')).toBeHidden();
        // 閉じたら押したチップへフォーカスが戻る
        await expect(page.locator('#appendix-chara-btn')).toBeFocused();

        await open();
        await sheet.getByRole('button', { name: '閉じる' }).click();
        await expect(sheet).toBeHidden();

        await open();
        await page.mouse.click(5, 5);   // シートの外＝背景
        await expect(sheet).toBeHidden();
    });
});

test('本文ページ：右下メニューのキャラクター紹介が開き、人物を選べて、各方法で閉じる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    const sheet = page.locator('#world-sheet');
    const panel = page.locator('#characters-overlay');
    const open = async (): Promise<void> => {
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: 'キャラクター紹介' }).click();
        await expect(panel).toBeVisible();
    };

    await open();
    const faces = panel.locator('.cv-face');
    await expect(faces).toHaveCount(VOL1.length);
    // 最初は 1 人目。顔を押すとその人の紹介に替わる
    await expect(faces.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await faces.nth(1).click();
    await expect(faces.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.cv-name')).toContainText(VOL1[1].name.replace(/[|《》]/g, '').slice(0, 2));
    // 全身の絵が実際に届いている（404 なら幅が 0 のまま）
    await expect.poll(() => panel.locator('.cv-portrait').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    // 閉じたらメニューボタンへフォーカスが戻る（押したメニュー項目はもう閉じたパネルの中）
    await expect(page.locator('#menu-toggle')).toBeFocused();

    await open();
    await sheet.getByRole('button', { name: '閉じる' }).click();
    await expect(sheet).toBeHidden();

    await open();
    await page.mouse.click(5, 5);
    await expect(sheet).toBeHidden();
});

test('本文ページ：資料シートのタブで人物・地図・用語を行き来できる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: 'キャラクター紹介' }).click();

    await page.getByRole('tab', { name: '地図' }).click();
    await expect(page.locator('#map-overlay')).toBeVisible();
    await expect(page.locator('#characters-overlay')).toBeHidden();

    await page.getByRole('tab', { name: '用語' }).click();
    await expect(page.locator('#glossary-overlay')).toBeVisible();
    await expect(page.locator('#map-overlay')).toBeHidden();

    await page.getByRole('tab', { name: '人物' }).click();
    await expect(page.locator('#characters-overlay')).toBeVisible();
});
