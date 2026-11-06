/*
 * 受け入れテスト：記録の保留と札（要件 06-5「外部サイト/直接アクセスで開いた本文ページは記録しない（最前線を除く）」・06-6「記録を止めているときの札」）。
 * テスト名の先頭の番号は受け入れ条件の番号。外部流入は goto（referrer は空、referer 指定で外部の値）、サイト内の移動は実際のクリックで作る。
 * 記録されないことを見るテストには、同じ流れで記録される対照（D3 など）を置く。
 */

import { test, expect } from './_fixtures';
import {
    enterFromTitle, expectAtHead, expectResume, gotoToc, goBackByOpening, openExternal, openFromToc, openHold, position, readToEnd, records, scrollAndSave,
    scrollToRatio, seed, setupRoutes, tryToRecord, waitReader,
} from './_records';

const badge = (page: import('@playwright/test').Page) => page.locator('#badge-hold');

test.describe('D. 保留と札', () => {
    test.beforeEach(async ({ page }) => { await setupRoutes(page); });

    test('D1/D2 新規が外部から途中の節：札が出て、何も記録しない。末尾まで読んでも stage は不変', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        let r = await records(page);
        expect(r.reached).toEqual([]);
        expect(r.autosave).toBeNull();
        await readToEnd(page);
        await page.waitForTimeout(300);
        r = await records(page);
        expect(r.read).toEqual([]);
        expect(r.stage).toBe('1');
    });

    test('D3 対照：同じ節を目次から開くと札なしですべて記録する', async ({ page }) => {
        await seed(page);
        await openFromToc(page, 1, 2);
        await expect(badge(page)).toBeHidden();
        await scrollAndSave(page, 0.4);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['01-02']);
        const r = await records(page);
        expect(r.reached).toEqual(['01-02']);
        expect(r.autosave).toMatchObject({ ep: 1, sec: 2 });
    });

    test('D4 新規が外部から最初の節：札なしですべて記録する（最前線）', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-01');
        await expect(badge(page)).toBeHidden();
        await scrollAndSave(page, 0.4);
        const r = await records(page);
        expect(r.reached).toEqual(['01-01']);
        expect(r.autosave).toMatchObject({ ep: 1, sec: 1 });
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['01-01']);
    });

    test('D5 順に読んだ人が SNS から次の節：札なしですべて記録する（最大読破の次）', async ({ page }) => {
        await seed(page, { read: ['01-01', '01-02'] });
        await openExternal(page, '02-01', 'https://t.co/abc');
        await expect(badge(page)).toBeHidden();
        await scrollAndSave(page, 0.4);
        const r = await records(page);
        expect(r.reached).toEqual(['02-01']);
        expect(r.autosave).toMatchObject({ ep: 2, sec: 1 });
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['01-01', '01-02', '02-01']);
    });

    test('D6 読みかけの地点へ外部リンクで戻る：札なし。位置を復元し、すべて記録する', async ({ page }) => {
        await seed(page, { read: ['01-01'], autosave: { ep: 2, sec: 2, ratio: 0.4 } });
        await openExternal(page, '02-02');
        await expect(badge(page)).toBeHidden();
        await expect.poll(async () => (await position(page)).ratio).toBeCloseTo(0.4, 1);
        await scrollAndSave(page, 0.6);
        expect((await records(page)).reached).toEqual(['02-02']);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['01-01', '02-02']);
    });

    test('D7 迷い込みから「次へ」：移った先でも札が出て、何も記録しない', async ({ page }) => {
        await seed(page);
        await openExternal(page, '02-02');
        await readToEnd(page);
        await page.locator('#btn-next').click();
        await page.waitForURL(/02-03\.html/);
        await waitReader(page);
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        const r = await records(page);
        expect(r.reached).toEqual([]);
        expect(r.read).toEqual([]);
        expect(r.autosave).toBeNull();
    });

    test('D8 迷い込みから「もどる」で最初の節へ：札が消えて記録が始まり、保留も解除される', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        await expect(badge(page)).toBeVisible();
        await goBackByOpening(page, '01-01\\.html');
        await expect(badge(page)).toBeHidden();
        expect(await openHold(page)).toBeNull();
        await expect.poll(async () => (await records(page)).reached).toEqual(['01-01']);
        await readToEnd(page);
        await page.locator('#btn-next').click();
        await page.waitForURL(/01-02\.html/);
        await waitReader(page);
        await expect(badge(page)).toBeHidden();
        await expect.poll(async () => (await records(page)).reached).toEqual(['01-01', '01-02']);
    });

    test('D9 外部から開いたあと目次を開くと解除され、その節も記録する', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        expect(await openHold(page)).not.toBeNull();
        await gotoToc(page);
        expect(await openHold(page)).toBeNull();
        await openFromToc(page, 1, 2);
        await expect(badge(page)).toBeHidden();
        await expect.poll(async () => (await records(page)).reached).toEqual(['01-02']);
    });

    test('D10 外部からタイトル →「本文を読む」：本文に札が出る', async ({ page }) => {
        await seed(page);
        await page.goto('/lirmena/contents/02-00.html');
        await enterFromTitle(page, 2);
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        expect((await records(page)).reached).toEqual([]);
    });

    test('D11 読破済みの範囲へ外部リンク：札が出て、何も記録しない', async ({ page }) => {
        // 開く節は読破していない（飛ばした節）。最初から記録済みの節を開くと、記録が走っても値が変わらず検出できない
        await seed(page, { read: ['01-02'], reached: ['01-02'], autosave: { ep: 2, sec: 1, ratio: 0.3 } });
        await openExternal(page, '01-01');
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        await readToEnd(page);
        await page.waitForTimeout(300);
        const r = await records(page);
        expect(r.reached).toEqual(['01-02']);
        expect(r.read).toEqual(['01-02']);
        expect(r.autosave).toMatchObject({ ep: 2, sec: 1, ratio: 0.3 });
    });

    test('D12 保留中のリロード：札は続く', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        await page.reload();
        await waitReader(page);
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        expect((await records(page)).reached).toEqual([]);
    });

    test('D13 保留のない最前線でのリロード：referrer は外部のままでも札は出ない', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-01', 'https://t.co/abc');
        await expect(badge(page)).toBeHidden();
        await page.reload();
        await waitReader(page);
        await expect(badge(page)).toBeHidden();
        expect(await openHold(page)).toBeNull();
    });

    test('D13 新たに保留を付けるのは通常の遷移だけ：保留のないタブで最前線でないページをリロードしても札は出ない', async ({ page }) => {
        await seed(page);
        await openFromToc(page, 1, 2);
        // 目次から開いた 01-02 が最前線でなくなる（別の節を読み進めたことにする）。referrer は同一オリジンなので、
        // 外部 referrer のリロードは D13 の上の例で見ている。ここは「リロードで新たに付かない」の対照
        await page.evaluate(() => localStorage.setItem('read', JSON.stringify(['02-03'])));
        await page.reload();
        await waitReader(page);
        await expect(badge(page)).toBeHidden();
    });

    test('D14 保留中でも栞の追加と位置の復元は動く', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        await expect(badge(page)).toBeVisible();
        await page.waitForTimeout(600);
        await scrollToRatio(page, 0.5);
        await expect.poll(() => page.evaluate(() => (history.state as { lirmenaRatio?: number } | null)?.lirmenaRatio ?? -1)).toBeCloseTo(0.5, 1);
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: '栞を追加' }).click();
        await page.locator('#bookmark-popup .bookmark-slot[data-slot="1"]').click();
        const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('bookmarks') ?? '[]')) as Array<{ ep: number; sec: number }>;
        expect(saved[0]).toMatchObject({ ep: 1, sec: 2 });
        await page.reload();
        await waitReader(page);
        await expect.poll(async () => (await position(page)).ratio).toBeCloseTo(0.5, 1);
        expect((await records(page)).autosave).toBeNull();
    });

    test('D15 保留はタブごと：別のタブで目次を開いても元のタブの保留は続く', async ({ page, context }) => {
        await seed(page);
        await openExternal(page, '01-02');
        const other = await context.newPage();
        await other.goto('/lirmena/');
        await expect(other.locator('#episodes-area .idx-chip').first()).toBeAttached();
        await other.close();
        await page.reload();
        await waitReader(page);
        await expect(badge(page)).toBeVisible();
    });

    test('D16 保留中に巻末へ迷い込んで読了しても stage は不変', async ({ page }) => {
        await seed(page);
        await openExternal(page, '02-03');
        await readToEnd(page);
        await page.waitForTimeout(300);
        const r = await records(page);
        expect(r.read).toEqual([]);
        expect(r.stage).toBe('1');
    });

    test('D17 札を押すと説明が 3 項目のリストで出て、目次へのリンクがなく、閉じられる', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        await badge(page).click();
        const popup = page.locator('#hold-popup');
        await expect(popup).toBeVisible();
        await expect(popup).toContainText('ページを直接開いたため、以下の機能を一時停止しています。');
        await expect(popup.locator('li')).toHaveText(['オートセーブ', '続きから読む', '到達/読破']);
        await expect(popup.locator('a')).toHaveCount(0);
        await popup.locator('[data-sheet-close]').first().click();
        await expect(popup).toBeHidden();
        await badge(page).click();
        await expect(popup).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(popup).toBeHidden();
    });

    for (const [name, viewport] of [['PC', { width: 1280, height: 800 }], ['スマホ', { width: 375, height: 812 }]] as const) {
        test(`D17 説明は札のすぐ下に出て、画面に収まる（${name}）`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await seed(page);
            await openExternal(page, '01-02');
            const b = (await badge(page).boundingBox())!;
            await badge(page).click();
            const popup = page.locator('#hold-popup');
            await expect(popup).toBeVisible();
            const p = (await popup.boundingBox())!;
            expect(p.y).toBeGreaterThanOrEqual(b.y + b.height);
            expect(p.y).toBeLessThanOrEqual(b.y + b.height + 8);
            expect(Math.abs(p.x - b.x)).toBeLessThanOrEqual(2);
            expect(p.x + p.width).toBeLessThanOrEqual(viewport.width);
            expect(p.y + p.height).toBeLessThanOrEqual(viewport.height);
            // 背景を押すと閉じる
            await page.mouse.click(viewport.width - 10, viewport.height - 10);
            await expect(popup).toBeHidden();
        });
    }

    test('D18 札は押せる範囲が札だけで、それ以外は今までどおり本文が受ける', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        const box = await badge(page).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeLessThan(160);
        expect(box!.height).toBeLessThan(48);
        const hit = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.id ?? '', { x: box!.x + box!.width + 8, y: box!.y + box!.height / 2 });
        expect(hit).not.toBe('badge-hold');
        // 札以外の場所のホイールは今までどおり本文を動かす
        const viewport = page.viewportSize()!;
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, 400);
        await expect.poll(async () => (await position(page)).progress).toBeGreaterThan(100);
    });

    test('D19 bfcache からの復帰で再判定：保留が消えていれば札が消え、到達が付き、オートセーブが動く', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        expect((await records(page)).reached).toEqual([]);
        // 別のページで目次を開いて解除された状態を作る（DOM は古いまま）。戻る操作は使わない（ページが作り直されて通常の読み込みになるため）
        await page.evaluate(() => {
            sessionStorage.removeItem('lirmena.recordHold');
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        await expect(badge(page)).toBeHidden();
        await expect.poll(async () => (await records(page)).reached).toEqual(['01-02']);
        await scrollAndSave(page, 0.7);
        expect((await records(page)).autosave).toMatchObject({ ep: 1, sec: 2 });
    });

    test('D19 保留中に末尾まで読んだページも、復帰して記録が始まれば読破が付く', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        await readToEnd(page);
        await page.waitForTimeout(300);
        expect((await records(page)).read).toEqual([]);
        await page.evaluate(() => {
            sessionStorage.removeItem('lirmena.recordHold');
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        await expect(badge(page)).toBeHidden();
        await scrollToRatio(page, 0.5);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['01-02']);
    });

    test('D19 対照：persisted でない pageshow では何も変わらない', async ({ page }) => {
        await seed(page);
        await openExternal(page, '01-02');
        await page.evaluate(() => {
            sessionStorage.removeItem('lirmena.recordHold');
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
        });
        await page.waitForTimeout(200);
        await expect(badge(page)).toBeVisible();
        expect((await records(page)).reached).toEqual([]);
    });

    test('D21 併読者が外部リンクで最大読破の次を開く：記録され、autosave が移る', async ({ page }) => {
        await seed(page, { read: ['01-01'], autosave: { ep: 2, sec: 2, ratio: 0.5 } });
        await openExternal(page, '01-02');
        await expect(badge(page)).toBeHidden();
        await expect.poll(async () => (await records(page)).autosave).toMatchObject({ ep: 1, sec: 2 });
        // 本来の節を開けば地点は戻る
        await gotoToc(page);
        await openFromToc(page, 2, 2);
        await expect.poll(async () => (await records(page)).autosave).toMatchObject({ ep: 2, sec: 2 });
        await gotoToc(page);
        await expectResume(page, { button: '続きから読む', sub: '第2話#2', here: '02-02' });
    });

    test('D22 読破なしで読みかけの併読者が外部リンクで最初の節を開く：札が出て、autosave は不変', async ({ page }) => {
        await seed(page, { autosave: { ep: 2, sec: 2, ratio: 0.5 } });
        await openExternal(page, '01-01');
        await expect(badge(page)).toBeVisible();
        await tryToRecord(page);
        expect((await records(page)).autosave).toMatchObject({ ep: 2, sec: 2, ratio: 0.5 });
    });
});

test('D20 sessionStorage が例外を投げる環境でも本文が壊れず、開いたページについて札が出る', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
        Object.defineProperty(window, 'sessionStorage', {
            configurable: true,
            get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
        });
    });
    await setupRoutes(page);
    await page.goto('/lirmena/');
    await expect(page.locator('#episodes-area .idx-chip').first()).toBeAttached();
    await openExternal(page, '01-02');
    await expect(badge(page)).toBeVisible();
    await tryToRecord(page);
    expect((await records(page)).reached).toEqual([]);
    expect(errors).toEqual([]);
});

test('札が出ないページ：タイトルとあとがき', async ({ page }) => {
    await setupRoutes(page);
    await seed(page);
    await page.goto('/lirmena/contents/02-00.html');
    await expect(page.locator('#title-screen')).toBeVisible();
    await expect(badge(page)).toHaveCount(0);
    await openExternal(page, 'vol01-afterword');
    await expect(badge(page)).toBeHidden();
    await expectAtHead(page);
});
