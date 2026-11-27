// ページごとのタイトル（要件 07）。pages() が story.json から埋めた結果を、ビルドしたページで見る。
// 文言の組み立ては src/page-meta.test.ts、雛形の形は src/head-contract.test.ts が見る。ここは「埋まって届いている」ことだけ。
import { test, expect, type Page } from '@playwright/test';

const WORK = '輝くもの《リルメナ》';
const BASE = 'https://haguchikarasu.github.io/lirmena/';

const og = (page: Page, prop: string) => page.locator(`meta[property="${prop}"]`).getAttribute('content');

test.describe('ページごとのタイトル', () => {
    test('本文ページ：話数・節・話名が先頭に入り、og:title と og:url もそのページのもの', async ({ page }) => {
        await page.goto('/lirmena/contents/01-02.html');
        await expect(page).toHaveTitle(`第1話 #2 太陽の行く先｜${WORK}`);
        expect(await og(page, 'og:title')).toBe(`第1話 #2 太陽の行く先｜${WORK}`);
        expect(await og(page, 'og:url')).toBe(`${BASE}contents/01-02.html`);
    });

    test('タイトルページ：話数と話名（ルビは親文字だけ）', async ({ page }) => {
        await page.goto('/lirmena/contents/02-00.html');
        await expect(page).toHaveTitle(`第2話 翠昴晶さがし -前編-｜${WORK}`);
        expect(await og(page, 'og:title')).toBe(`第2話 翠昴晶さがし -前編-｜${WORK}`);
        expect(await og(page, 'og:url')).toBe(`${BASE}contents/02-00.html`);
    });

    test('目次と資料ページ：og:title は <title> と同じ', async ({ page }) => {
        for (const [path, title, url] of [
            ['', WORK, BASE],
            ['characters.html', `人物｜${WORK}`, `${BASE}characters.html`],
            ['map.html', `エシュカの地図｜${WORK}`, `${BASE}map.html`],
            ['glossary.html', `用語集｜${WORK}`, `${BASE}glossary.html`],
        ]) {
            await page.goto(`/lirmena/${path}`);
            await expect(page).toHaveTitle(title);
            expect(await og(page, 'og:title')).toBe(title);
            expect(await og(page, 'og:url')).toBe(url);
        }
    });
});
