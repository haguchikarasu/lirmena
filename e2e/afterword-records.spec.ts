/*
 * 受け入れテスト：あとがきの記録（要件 06-5「あとがき（vol[XX]-af）のキー」・06-6・06-7）。
 * あとがきは線形の外。印は目次に出すだけで、stage・オートセーブ・「続きから読む」に使わない。位置は保存しない。
 * テスト名の先頭の番号は受け入れ条件の番号。
 */

import { test, expect } from './_fixtures';
import {
    enterFromTitle, expectAtEnd, expectAtHead, expectResume, goBackByOpening, gotoToc, openAfterwordFromToc, openExternal, openFromToc, openHold,
    openVolumes, position, readToEnd, records, scrollToRatio, seed, setupRoutes, tryToRecord, waitReader,
} from './_records';

const chip = (page: import('@playwright/test').Page) => page.locator('#episodes-area a.idx-chip[href*="vol01-afterword.html"]');

test.describe('C. あとがき（外部から）', () => {
    test.beforeEach(async ({ page }) => { await setupRoutes(page); });
    const badge = (page: import('@playwright/test').Page) => page.locator('#badge-hold');

    test('C8 外部から開く：札なし。印は付き、autosave は不変', async ({ page }) => {
        const autosave = { ep: 1, sec: 2, ratio: 0.3 };
        await seed(page, { autosave });
        await openExternal(page, 'vol01-afterword');
        await expect(badge(page)).toBeHidden();
        await expect.poll(async () => (await records(page)).reached).toEqual(['vol01-af']);
        await tryToRecord(page);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['vol01-af']);
        expect((await records(page)).autosave).toMatchObject(autosave);
    });

    test('C9 外部から開いて「もどる」で本文へ（最前線でない）：札が出て、何も記録しない', async ({ page }) => {
        await seed(page);
        await openExternal(page, 'vol01-afterword');
        await goBackByOpening(page, '02-03\\.html');
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        await readToEnd(page);
        await page.waitForTimeout(300);
        const r = await records(page);
        expect(r.reached).toEqual(['vol01-af']);
        expect(r.read).toEqual([]);
        expect(r.autosave).toBeNull();
        expect(r.stage).toBe('1');
    });

    test('C10 外部から開いて「次へ」→ タイトル →「本文を読む」（最前線でない）：札が出て、何も記録しない', async ({ page }) => {
        await seed(page);
        await openExternal(page, 'vol01-afterword');
        await page.locator('#btn-next').click();
        await page.waitForURL(/05-00\.html/);
        await enterFromTitle(page, 5);
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        await readToEnd(page);
        await page.waitForTimeout(300);
        const r = await records(page);
        expect(r.reached).toEqual(['vol01-af']);
        // 「次へ」を押すのにあとがきの末尾まで動くので、あとがきの印は付く。本文の読破は増えない
        expect(r.read).toEqual(['vol01-af']);
        expect(r.autosave).toBeNull();
    });

    test('C11 巻末まで読破した人が外部からあとがき → 次へ → タイトル → 次巻：札なしで記録が始まり、保留も解除される', async ({ page }) => {
        await seed(page, { read: ['02-03'] });
        await openExternal(page, 'vol01-afterword');
        expect(await openHold(page)).not.toBeNull();
        await page.locator('#btn-next').click();
        await page.waitForURL(/05-00\.html/);
        await enterFromTitle(page, 5);
        await expect(badge(page)).toBeHidden();
        expect(await openHold(page)).toBeNull();
        await expect.poll(async () => (await records(page)).autosave).toMatchObject({ ep: 5, sec: 1 });
    });

    test('C12 外部からのあとがきのあと目次を開くと保留が解除される', async ({ page }) => {
        await seed(page);
        await openExternal(page, 'vol01-afterword');
        expect(await openHold(page)).not.toBeNull();
        await gotoToc(page);
        expect(await openHold(page)).toBeNull();
    });
});

test.describe('C. あとがき（サイト内から）', () => {
    test.beforeEach(async ({ page }) => { await setupRoutes(page); });

    test('C1/C2 読みかけで未読のあとがきを開いても「続きから」は動かず、印だけ付く', async ({ page }) => {
        const autosave = { ep: 1, sec: 2, ratio: 0.3 };
        await seed(page, { autosave });
        await openAfterwordFromToc(page);
        await page.waitForTimeout(600);
        await scrollToRatio(page, 0.5);
        await page.waitForTimeout(700);
        let r = await records(page);
        expect(r.autosave).toMatchObject(autosave);
        expect(await page.evaluate(() => localStorage.getItem('autosaveAfterword'))).toBeNull();
        expect(r.reached).toContain('vol01-af');

        await gotoToc(page);
        await openVolumes(page);
        await expect(chip(page)).toHaveAttribute('aria-label', '第1巻 あとがき 既読');
        await expectResume(page, { button: '続きから読む', sub: '第1話#2', here: '01-02' });

        await openAfterwordFromToc(page);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['vol01-af']);
        r = await records(page);
        expect(r.stage).toBe('1');
        await gotoToc(page);
        await openVolumes(page);
        await expect(chip(page)).toHaveAttribute('aria-label', '第1巻 あとがき 読破');
        await expectResume(page, { button: '続きから読む', sub: '第1話#2', here: '01-02' });
    });

    test('C3/C4/C5 巻末を読了 → あとがき → 目次：地点は巻末の末尾。「あとがき」ボタンが見え、次へで次巻へ', async ({ page }) => {
        await seed(page);
        await openFromToc(page, 2, 3);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['02-03']);
        await page.locator('#btn-afterword').click();
        await page.waitForURL(/vol01-afterword/);
        await waitReader(page);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['02-03', 'vol01-af']);

        await gotoToc(page);
        await openVolumes(page);
        await expectResume(page, { button: '続きから読む', sub: '第2話#3', slot0: { loc: '第2話#3', ratio: 1 }, here: '02-03' });
        await expect(chip(page)).not.toHaveClass(/idx-chip--here/);

        await page.locator('#idx-cta-btn').click();
        await page.waitForURL(/02-03\.html/);
        await waitReader(page);
        await expectAtEnd(page);
        await expect(page.locator('#btn-afterword')).toBeInViewport();
        await page.locator('#btn-next').click();
        await page.waitForURL(/05-00\.html/);
    });

    test('C6 あとがきを途中で閉じて目次から開き直すと先頭から', async ({ page }) => {
        await seed(page);
        await openAfterwordFromToc(page);
        await page.waitForTimeout(600);
        await scrollToRatio(page, 0.5);
        await page.waitForTimeout(600);
        await gotoToc(page);
        await openAfterwordFromToc(page);
        await expectAtHead(page);
    });

    test('C7 あとがきでリロードすると history.state の位置へ戻る', async ({ page }) => {
        await seed(page);
        await openAfterwordFromToc(page);
        await page.waitForTimeout(600);
        await scrollToRatio(page, 0.5);
        await expect.poll(() => page.evaluate(() => (history.state as { lirmenaRatio?: number } | null)?.lirmenaRatio ?? -1)).toBeCloseTo(0.5, 1);
        await page.reload();
        await waitReader(page);
        await expect.poll(async () => (await position(page)).ratio).toBeCloseTo(0.5, 1);
    });
});
