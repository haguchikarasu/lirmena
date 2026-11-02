/*
 * 骨格 E2E：資料ページ（characters.html・map.html・glossary.html。要件 06-8／06-14／06-15）。
 * 中身は資料シートと同じ部品（characters.ts・map.ts・glossary.ts）で、上の帯（templates/parts/world-nav.html・
 * ui/world-nav）のタブでページ間を行き来する。見るのは：
 *   - 3 枚とも本番ビルド（vite preview）で 404 にならない（vite の input の足し忘れは dev では気づけない＝R5）
 *   - タブの行き来・いまのページの印・?dev の引き継ぎ
 *   - ‹ はブラウザの「戻る」と同じ（本文から来たら本文へ）。来た元が無ければ目次へ。タブの行き来は履歴に積まない
 *   - 人物・地図の中身が出る
 *   - スマホ幅で 3 枚とも 1 画面に収まり、スクロールを止める指定（overflow: hidden・position: fixed）を body に使っていない
 *     （ただし自動テストでは vh＝svh なので、アドレスバーの分のはみ出しは出ない＝実機の Chrome で確かめる。R16）
 * 用語集ページの検索・相互参照・直リンクは e2e/glossary.spec.ts が見る。
 */

import { readFileSync } from 'node:fs';
import { test, expect } from './_fixtures';

type Entry = { volume: number; characters: { name: string }[] };
const CHARACTERS = JSON.parse(
    readFileSync(new URL('../public/characters.json', import.meta.url), 'utf-8'),
) as Entry[];
const VOL1 = CHARACTERS.find(c => c.volume === 1)!.characters;

const PAGES = ['characters', 'map', 'glossary'] as const;

test.describe('資料ページ', () => {
    for (const name of PAGES) {
        test(`${name}.html が本番ビルドで開け、いまのページのタブに印が付く`, async ({ page }) => {
            const res = await page.goto(`/lirmena/${name}.html`);
            expect(res?.status()).toBe(200);
            await expect(page.locator('#wp-top')).toBeVisible();
            await expect(page.locator(`#wp-tab-${name}`)).toHaveAttribute('aria-current', 'page');
            await expect(page.locator('#wp-tabs [aria-current]')).toHaveCount(1);
        });
    }

    test('タブで行き来し、?dev を引き継ぐ。直に開いたときの ‹ は目次へ', async ({ page }) => {
        await page.goto('/lirmena/glossary.html?dev');
        await page.locator('#wp-tab-characters').click();
        await expect(page).toHaveURL(/\/lirmena\/characters\.html\?dev$/);
        await page.locator('#wp-tab-map').click();
        await expect(page).toHaveURL(/\/lirmena\/map\.html\?dev$/);
        await page.locator('#wp-tab-glossary').click();
        await expect(page).toHaveURL(/\/lirmena\/glossary\.html\?dev$/);
        await page.locator('#wp-back').click();
        await expect(page).toHaveURL(/\/lirmena\/\?dev$/);
    });

    test('本文の「ページで開く」から来たら、タブを行き来しても ‹ で本文へ戻る', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html?dev');
        await expect(page.locator('#main-container')).toBeVisible();
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: 'エシュカ地図' }).click();
        await page.locator('#world-sheet-page').click();
        await expect(page).toHaveURL(/\/lirmena\/map\.html\?dev$/);
        await page.locator('#wp-tab-characters').click();
        await expect(page).toHaveURL(/\/lirmena\/characters\.html\?dev$/);
        await page.locator('#wp-back').click();
        await expect(page).toHaveURL(/\/lirmena\/contents\/01-01\.html\?dev$/);
    });

    test('本文のシートで選んだ人は「ページで開く」で人物のページへ引き継がれる', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: 'キャラクター紹介' }).click();
        await page.locator('#characters-overlay .cv-face').nth(2).click();
        await page.locator('#world-sheet-page').click();
        await expect(page).toHaveURL(/\/lirmena\/characters\.html#vol=1&who=/);
        await expect(page.locator('#wp-panel .cv-face').nth(2)).toHaveAttribute('aria-pressed', 'true');
        // ページで別の人を選ぶと # も付け直す（履歴には積まない）
        const before = await page.evaluate(() => history.length);
        await page.locator('#wp-panel .cv-face').nth(1).click();
        await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('who'))).toBe(VOL1[1].name);
        expect(await page.evaluate(() => history.length)).toBe(before);
    });

    test('人物：今の Stage の紹介が出て、顔を押すとその人になる', async ({ page }) => {
        await page.goto('/lirmena/characters.html');
        const faces = page.locator('#wp-panel .cv-face');
        await expect(faces).toHaveCount(VOL1.length);
        await expect(page.locator('#wp-panel .cv-name')).toBeVisible();
        await faces.nth(1).click();
        await expect(faces.nth(1)).toHaveAttribute('aria-pressed', 'true');
        await expect(faces.nth(0)).toHaveAttribute('aria-pressed', 'false');
    });

    test('地図：絵と＋／−が出る', async ({ page }) => {
        await page.goto('/lirmena/map.html');
        await expect(page.locator('#wp-panel #map-popup img')).toBeVisible();
        await expect(page.locator('#wp-panel .mv-zoom-btn')).toHaveCount(2);
    });
});

test.describe('資料ページ（スマホ幅）', () => {
    test.use({ viewport: { width: 375, height: 740 } });

    for (const name of PAGES) {
        test(`${name}.html は 1 画面に収まり、body のスクロールを止めていない`, async ({ page }) => {
            await page.goto(`/lirmena/${name}.html`);
            await expect(page.locator('#wp-top')).toBeVisible();
            // 中身（顔の帯・地図・用語の一覧）が描かれてから測る
            await expect(page.locator('#wp-panel > *, #gl-list > *').first()).toBeVisible();
            const m = await page.evaluate(() => {
                const cs = getComputedStyle(document.body);
                return {
                    over: document.documentElement.scrollHeight - innerHeight,
                    overflow: cs.overflowY,
                    position: cs.position,
                };
            });
            expect(m.over).toBeLessThanOrEqual(0);
            expect(m.overflow).not.toBe('hidden');
            expect(m.position).not.toBe('fixed');
        });
    }

    test('人物：顔の帯が画面の下端に収まる', async ({ page }) => {
        await page.goto('/lirmena/characters.html');
        const bar = page.locator('#wp-panel .cv-faces');
        await expect(bar).toBeVisible();
        const bottom = await bar.evaluate(el => el.getBoundingClientRect().bottom);
        expect(bottom).toBeLessThanOrEqual(740);
    });
});
