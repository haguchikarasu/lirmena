/*
 * 受け入れテスト：「もどる」の着地（要件 06-6・06-1）と、オートセーブ／「続きから読む」（要件 06-5・06-7）。
 * テスト名の先頭の番号は受け入れ条件の番号（B＝もどる、A＝続きから）。
 * 期待は要件から書く。記録されないことを見るテストには、同じ流れで記録される対照を同じ spec に置く。
 */

import { test, expect } from './_fixtures';
import {
    enterFromTitle, expectAtEnd, expectAtHead, expectResume, goBackByOpening, gotoToc, nudge, openAfterwordFromToc, openFromToc, openVolumes,
    position, readToEnd, records, scrollAndSave, scrollToRatio, seed, setupRoutes, setWritingMode, waitReader,
} from './_records';

test.describe('B.「もどる」の着地', () => {
    test.beforeEach(async ({ page }) => { await setupRoutes(page); });

    for (const mode of ['horizontal', 'vertical'] as const) {
        test(`B1/B8 読破済みの前節へ「もどる」は末尾へ着地する（${mode}）`, async ({ page }) => {
            await setWritingMode(page, mode);
            await seed(page, { read: ['01-01'], reached: ['01-01'] });
            await openFromToc(page, 1, 2);
            await goBackByOpening(page, '01-01\\.html');
            await expectAtEnd(page);
            expect((await records(page)).pendingScrollEnd).toBeNull();
        });

        test(`B2/B8 未読の前節へ「もどる」は先頭へ着地する（${mode}）`, async ({ page }) => {
            await setWritingMode(page, mode);
            await seed(page);
            await openFromToc(page, 1, 2);
            await goBackByOpening(page, '01-01\\.html');
            await expectAtHead(page);
            expect((await records(page)).pendingScrollEnd).toBeNull();
        });
    }

    test('B3/B4 未読の前節へ戻って少しスクロールしても読破は付かず、末尾まで読めば付く', async ({ page }) => {
        await seed(page);
        await openFromToc(page, 1, 2);
        await goBackByOpening(page, '01-01\\.html');
        await nudge(page);
        await page.waitForTimeout(300);
        expect((await records(page)).read).toEqual([]);
        // 対照：同じページで末尾まで読むと付く（読了の検知そのものは動いている）
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['01-01']);
    });

    test('B6 あとがきの「もどる」：巻末が未読なら先頭で、少しスクロールしても stage が動かない', async ({ page }) => {
        await seed(page);
        await openAfterwordFromToc(page);
        await goBackByOpening(page, '02-03\\.html');
        await expectAtHead(page);
        await nudge(page);
        await page.waitForTimeout(300);
        const r = await records(page);
        expect(r.read.filter((k) => !k.startsWith('vol'))).toEqual([]);
        expect(r.stage).toBe('1');
    });

    test('B6 あとがきの「もどる」：巻末が読破済みなら末尾', async ({ page }) => {
        await seed(page, { read: ['02-03'], reached: ['02-03'] });
        await openAfterwordFromToc(page);
        await goBackByOpening(page, '02-03\\.html');
        await expectAtEnd(page);
    });

    for (const [name, read, expectAt] of [
        ['読破済みなら末尾', ['01-02'], expectAtEnd],
        ['未読なら先頭', [], expectAtHead],
    ] as const) {
        test(`B5 タイトルの「戻る」：${name}`, async ({ page }) => {
            await seed(page, { read: [...read], reached: [...read] });
            await openVolumes(page);
            await page.locator('#episodes-area a.idx-chip[href*="contents/02-00.html"]').click();
            await page.waitForURL(/02-00\.html/);
            await page.locator('#btn-title-prev').click();
            await page.waitForURL(/01-02\.html/);
            await waitReader(page);
            await expectAt(page);
        });
    }
});

test('B7 読破済みの前節に戻っても autosave は動かない', async ({ page }) => {
    await setupRoutes(page);
    await seed(page, { read: ['01-01', '01-02'], autosave: { ep: 2, sec: 1, ratio: 0.4 } });
    await openFromToc(page, 1, 2);
    await goBackByOpening(page, '01-01\\.html');
    await expectAtEnd(page);
    await page.waitForTimeout(700);
    expect((await records(page)).autosave).toMatchObject({ ep: 2, sec: 1, ratio: 0.4 });
});

test.describe('A. オートセーブと「続きから読む」', () => {
    test.beforeEach(async ({ page }) => { await setupRoutes(page); });

    test('A1 新規：第一話から読む。スロット 0 なし。枠なし', async ({ page }) => {
        await seed(page);
        await expectResume(page, { button: '第一話から読む', sub: '', slot0: null, here: null });
        await expect(page.locator('body')).toHaveAttribute('data-reader', 'first');
    });

    for (const mode of ['horizontal', 'vertical'] as const) {
        test(`A2/A15 読みかけ：同じ位置へ戻る（${mode}）`, async ({ page }) => {
            await setWritingMode(page, mode);
            await seed(page);
            await openFromToc(page, 1, 1);
            await scrollAndSave(page, 0.4);
            await gotoToc(page);
            await expectResume(page, { button: '続きから読む', sub: '第1話#1', slot0: { loc: '第1話#1', ratio: 0.4 }, here: '01-00' });
            await page.locator('#idx-cta-btn').click();
            await page.waitForURL(/01-01\.html/);
            await waitReader(page);
            await expect.poll(async () => (await position(page)).ratio).toBeCloseTo(0.4, 1);
            expect((await records(page)).pendingJump).toBeNull();
        });

        test(`A3/A15 読了して閉じた：扉を経由せず本文の末尾へ。「次へ」が見える（${mode}）`, async ({ page }) => {
            await setWritingMode(page, mode);
            await seed(page);
            await openFromToc(page, 1, 1);
            await readToEnd(page);
            await expect.poll(async () => (await records(page)).read).toEqual(['01-01']);
            await gotoToc(page);
            await expectResume(page, { button: '続きから読む', sub: '第1話#1', slot0: { loc: '第1話#1', ratio: 1 }, here: '01-00' });
            await expect(page.locator('#idx-cta-btn')).toHaveAttribute('href', /contents\/01-01\.html/);
            await page.locator('#idx-cta-btn').click();
            await page.waitForURL(/01-01\.html/);
            await waitReader(page);
            await expectAtEnd(page);
            await expect(page.locator('#btn-next')).toBeInViewport();
            await page.locator('#btn-next').click();
            await page.waitForURL(/01-02\.html/);
        });
    }

    test('A2 対照：同じ記録でも、続きからなら位置へ、目次のチップなら先頭へ着地する', async ({ page }) => {
        await seed(page, { read: ['01-01'], autosave: { ep: 1, sec: 2, ratio: 0.4 } });
        await page.locator('#idx-cta-btn').click();
        await page.waitForURL(/01-02\.html/);
        await waitReader(page);
        await expect.poll(async () => (await position(page)).ratio).toBeCloseTo(0.4, 1);
        await gotoToc(page);
        await openFromToc(page, 1, 2);
        await expectAtHead(page);
    });

    test('A4 話の最後を読了 → 続きから → 次へ → タイトル → 本文を読む', async ({ page }) => {
        await seed(page, { read: ['01-01', '01-02'] });
        await page.locator('#idx-cta-btn').click();
        await page.waitForURL(/01-02\.html/);
        await waitReader(page);
        await page.locator('#btn-next').click();
        await page.waitForURL(/02-00\.html/);
        await enterFromTitle(page, 2);
        await expectAtHead(page);
    });

    test('A5/A6 読み返しでは autosave も「続きから」も動かず、末尾まで読んでも動かない', async ({ page }) => {
        const autosave = { ep: 2, sec: 1, ratio: 0.4 };
        await seed(page, { read: ['01-01', '01-02'], autosave });
        await openFromToc(page, 1, 1);
        await scrollToRatio(page, 0.5);
        await page.waitForTimeout(700);
        await scrollToRatio(page, 0.55);
        await page.waitForTimeout(100);
        expect((await records(page)).autosave).toMatchObject(autosave);
        await readToEnd(page);
        await page.waitForTimeout(700);
        const r = await records(page);
        expect(r.autosave).toMatchObject(autosave);
        expect(r.read).toEqual(['01-01', '01-02']);
        await gotoToc(page);
        await expectResume(page, { button: '続きから読む', sub: '第2話#1', slot0: { loc: '第2話#1', ratio: 0.4 }, here: '02-00' });
    });

    test('A7 誤タップ：飛ばした節へ「続きから」が移り、本来の節を開けば戻る', async ({ page }) => {
        await seed(page, { read: ['01-01'], autosave: { ep: 1, sec: 2, ratio: 0.3 } });
        await openFromToc(page, 2, 3);
        await expect.poll(async () => (await records(page)).autosave).toMatchObject({ ep: 2, sec: 3 });
        await gotoToc(page);
        await expectResume(page, { button: '続きから読む', sub: '第2話#3', here: '02-03' });
        await openFromToc(page, 1, 2);
        await expect.poll(async () => (await records(page)).autosave).toMatchObject({ ep: 1, sec: 2, ratio: 0 });
        await gotoToc(page);
        await expectResume(page, { button: '続きから読む', sub: '第1話#2', slot0: { loc: '第1話#2', ratio: 0 }, here: '01-02' });
    });

    test('A8/A9/A10 併読者：飛ばした先の読みかけ → 読了 → 飛ばした節を埋めても地点は動かない', async ({ page }) => {
        await seed(page);
        await openFromToc(page, 2, 2);
        await scrollAndSave(page, 0.6);
        await gotoToc(page);
        await expectResume(page, { button: '続きから読む', sub: '第2話#2', slot0: { loc: '第2話#2', ratio: 0.6 }, here: '02-02' });

        await openFromToc(page, 2, 2);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['02-02']);
        await gotoToc(page);
        await expectResume(page, { button: '続きから読む', sub: '第2話#2', slot0: { loc: '第2話#2', ratio: 1 }, here: '02-02' });
        expect((await records(page)).stage).toBe('1');

        const before = (await records(page)).autosave;
        await openFromToc(page, 1, 1);
        await readToEnd(page);
        await expect.poll(async () => (await records(page)).read).toEqual(['02-02', '01-01']);
        await page.waitForTimeout(700);
        expect((await records(page)).autosave).toEqual(before);
        await gotoToc(page);
        await expectResume(page, { button: '続きから読む', sub: '第2話#2', here: '02-02' });
    });

    test('A11 最新まで読了：読み返すボタン。スロット 0 は帯を満たして末尾へ', async ({ page }) => {
        await seed(page, { read: ['05-02'] });
        await expectResume(page, { button: '第5話#2 を読み返す', slot0: { loc: '第5話#2', ratio: 1 }, here: '05-02' });
        await expect(page.locator('body')).toHaveAttribute('data-reader', 'caught');
        await page.locator('#bookmark-slots .idx-bm-slot--auto .idx-bm-go').click();
        await page.waitForURL(/05-02\.html/);
        await waitReader(page);
        await expectAtEnd(page);
    });

    test('A12 新しい節が公開された：続きから → 末尾 → 次へで新しい節へ', async ({ page }) => {
        await setupRoutes(page, { publish: ['05-03'] });
        await seed(page, { read: ['05-02'] });
        await expectResume(page, { button: '続きから読む', sub: '第5話#2', slot0: { loc: '第5話#2', ratio: 1 }, here: '05-02' });
        await page.locator('#idx-cta-btn').click();
        await page.waitForURL(/05-02\.html/);
        await waitReader(page);
        await expectAtEnd(page);
        await page.locator('#btn-next').click();
        await page.waitForURL(/05-03\.html/);
    });

    test('A13 未公開へ戻された節を指す記録は無視する（残る最大読破の末尾）', async ({ page }) => {
        await setupRoutes(page, { unpublish: ['02-02', '02-03'] });
        await seed(page, { read: ['01-02', '02-03'], autosave: { ep: 2, sec: 2, ratio: 0.5 } });
        await expectResume(page, { button: '続きから読む', sub: '第1話#2', slot0: { loc: '第1話#2', ratio: 1 }, here: '01-02' });
    });

    test('A13 未公開へ戻された節しか記録が無ければ最初の節', async ({ page }) => {
        await setupRoutes(page, { unpublish: ['05-02'] });
        await seed(page, { read: ['05-02'], autosave: { ep: 5, sec: 2, ratio: 0.5 } });
        await expectResume(page, { button: '第一話から読む', sub: '', slot0: null, here: null });
    });

    test('A14 読み返し中のリロード・ブラウザの戻るは history.state の位置へ戻る（autosave は不変）', async ({ page }) => {
        const autosave = { ep: 2, sec: 1, ratio: 0.4 };
        await seed(page, { read: ['01-01', '01-02'], autosave });
        await openFromToc(page, 1, 2);
        await page.waitForTimeout(600);
        await scrollToRatio(page, 0.5);
        await expect.poll(() => page.evaluate(() => (history.state as { lirmenaRatio?: number } | null)?.lirmenaRatio ?? -1)).toBeCloseTo(0.5, 1);
        await page.reload();
        await waitReader(page);
        await expect.poll(async () => (await position(page)).ratio).toBeCloseTo(0.5, 1);
        await page.waitForTimeout(600);
        await readToEnd(page);
        await page.locator('#btn-next').click();
        await page.waitForURL(/02-00\.html/);
        await page.goBack();
        await page.waitForURL(/01-02\.html/);
        await waitReader(page);
        await expect.poll(async () => (await position(page)).ratio).toBeGreaterThan(0.5);
        expect((await records(page)).autosave).toMatchObject(autosave);
    });

    test('A16 スロット 0 に × は無く、手動栞の行にはある', async ({ page }) => {
        await seed(page, {
            autosave: { ep: 1, sec: 2, ratio: 0.3 },
            extra: { bookmarks: JSON.stringify([{ slot: 1, ep: 1, sec: 1, scene: 1, ratio: 0.3, savedAt: 100 }]) },
        });
        await expect(page.locator('#bookmark-slots .idx-bm-slot--auto')).toHaveCount(1);
        await expect(page.locator('#bookmark-slots .idx-bm-slot--auto .idx-bm-del')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '栞 1を消す' })).toHaveCount(1);
    });

    test('A17 目次の「読破を消す」：read と autosave が消え、第一話からへ戻る。手動栞は残る', async ({ page }) => {
        await seed(page, {
            read: ['01-01'], reached: ['01-01'], autosave: { ep: 1, sec: 2, ratio: 0.3 },
            extra: { bookmarks: JSON.stringify([{ slot: 1, ep: 1, sec: 1, scene: 1, ratio: 0.3, savedAt: 100 }]) },
        });
        await page.locator('#idx-btn-settings').click();
        await page.locator('.settings-action', { hasText: '読破を消す' }).click();
        await expect(page.locator('#confirm-note')).toHaveText('オートセーブも一緒に削除されます。');
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        await expect(page.locator('#idx-cta-btn')).toHaveText('第一話から読む');
        const r = await records(page);
        expect(r.read).toEqual([]);
        expect(r.autosave).toBeNull();
        expect(r.reached).toEqual(['01-01']);
        expect(await page.evaluate(() => localStorage.getItem('bookmarks'))).not.toBeNull();
    });

    test('A17 本文の「読破を消す」でも autosave が消える', async ({ page }) => {
        await seed(page, { read: ['01-01'], autosave: { ep: 1, sec: 2, ratio: 0.3 } });
        await openFromToc(page, 1, 1);
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: '設定' }).click();
        await page.locator('.settings-action', { hasText: '読破を消す' }).click();
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        await expect.poll(async () => (await records(page)).read).toEqual([]);
        expect((await records(page)).autosave).toBeNull();
    });

    test('A18 「栞をすべて消す」：手動栞だけ消え、autosave と「続きから」は残る', async ({ page }) => {
        await seed(page, {
            autosave: { ep: 1, sec: 2, ratio: 0.3 },
            extra: { bookmarks: JSON.stringify([{ slot: 1, ep: 1, sec: 1, scene: 1, ratio: 0.3, savedAt: 100 }]) },
        });
        await page.locator('#idx-btn-settings').click();
        await page.locator('.settings-action', { hasText: '栞をすべて消す' }).click();
        await expect(page.locator('#confirm-msg')).toHaveText('保存した栞をすべて削除しますか？');
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        await expect.poll(() => page.evaluate(() => localStorage.getItem('bookmarks'))).toBeNull();
        expect((await records(page)).autosave).toMatchObject({ ep: 1, sec: 2 });
        await expect(page.locator('#idx-cta-btn')).toHaveText('続きから読む');
    });

    test('A19 「既読を消す」：reached だけ消え、「続きから」は残る', async ({ page }) => {
        await seed(page, { read: ['01-01'], reached: ['01-01', '01-02'], autosave: { ep: 1, sec: 2, ratio: 0.3 } });
        await page.locator('#idx-btn-settings').click();
        await page.locator('.settings-action', { hasText: '既読を消す' }).click();
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        await expect.poll(async () => (await records(page)).reached).toEqual([]);
        await expect(page.locator('#idx-cta-btn')).toHaveText('続きから読む');
        expect((await records(page)).autosave).toMatchObject({ ep: 1, sec: 2 });
    });
});

test.describe('F. 既存読者の公開時（旧版の localStorage をそのまま入れて新版を開く）', () => {
    test.beforeEach(async ({ page }) => { await setupRoutes(page); });

    test('F1 旧版の読み返し中（autosave が最大読破より前）：地点は最大読破の節の末尾', async ({ page }) => {
        await seed(page, { read: ['01-01', '01-02', '02-01'], autosave: { ep: 1, sec: 1, ratio: 0.5 } });
        await expectResume(page, { button: '続きから読む', sub: '第2話#1', slot0: { loc: '第2話#1', ratio: 1 }, here: '02-00' });
    });

    test('F2 旧版の読みかけ（autosave が先）：位置つきで戻れる', async ({ page }) => {
        await seed(page, { read: ['01-01'], autosave: { ep: 1, sec: 2, ratio: 0.5 } });
        await expectResume(page, { button: '続きから読む', sub: '第1話#2', slot0: { loc: '第1話#2', ratio: 0.5 }, here: '01-02' });
        await page.locator('#idx-cta-btn').click();
        await page.waitForURL(/01-02\.html/);
        await waitReader(page);
        await expect.poll(async () => (await position(page)).ratio).toBeCloseTo(0.5, 1);
    });

    test('F3 autosaveAfterword のほうが新しい：旧キーが消え、「続きから」は本文を指す', async ({ page }) => {
        await seed(page, {
            autosave: { ep: 1, sec: 2, ratio: 0.5 },
            extra: {
                autosaveAfterword: JSON.stringify({ vol: 1, ratio: 0.2, savedAt: 999 }),
                pendingJumpAfterword: JSON.stringify({ vol: 1, ratio: 0.2 }),
            },
        });
        await expectResume(page, { button: '続きから読む', sub: '第1話#2', here: '01-02' });
        expect(await page.evaluate(() => [localStorage.getItem('autosaveAfterword'), localStorage.getItem('pendingJumpAfterword')])).toEqual([null, null]);
    });

    test('F4 栞の位置（ratio）がそのまま。schemaVersion は 5 のまま', async ({ page }) => {
        const list = [1, 2, 3].map((slot) => ({ slot, ep: 1, sec: 1, scene: 1, ratio: slot / 10, savedAt: 100 + slot }));
        await seed(page, { extra: { bookmarks: JSON.stringify(list) } });
        expect(JSON.parse(await page.evaluate(() => localStorage.getItem('bookmarks') ?? '[]'))).toEqual(list);
        expect((await records(page)).schemaVersion).toBe('5');
    });

    test('F5 版数のない旧データ：初回の移行で読破になり、地点と本文の着地が読める', async ({ page }) => {
        // アプリの JS が動かない同じオリジンのページで、版数なしの状態を作る（seed は版数を書くので使わない）
        await page.goto('/lirmena/story.json');
        await page.evaluate(() => {
            localStorage.clear();
            localStorage.setItem('sceneRead', JSON.stringify(['01-02-00', '01-01-03']));
        });
        await gotoToc(page);
        await expectResume(page, { button: '続きから読む', sub: '第1話#2', slot0: { loc: '第1話#2', ratio: 1 }, here: '01-02' });
        const r = await records(page);
        expect(r.read).toEqual(['01-02']);
        expect(new Set(r.reached)).toEqual(new Set(['01-02', '01-01']));
        expect(r.schemaVersion).toBe('5');
        await page.locator('#idx-cta-btn').click();
        await page.waitForURL(/01-02\.html/);
        await waitReader(page);
        await expectAtEnd(page);
    });

    test('F5 sceneRead だけが残っている読者：目次の読破と地点が読める', async ({ page }) => {
        await seed(page, { extra: { sceneRead: JSON.stringify(['01-02-00']) } });
        await expectResume(page, { button: '続きから読む', sub: '第1話#2', slot0: { loc: '第1話#2', ratio: 1 }, here: '01-02' });
    });
});
