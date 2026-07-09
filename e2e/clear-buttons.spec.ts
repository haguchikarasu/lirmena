/*
 * 骨格 E2E ⑤：目次側の3クリアボタン（栞・既読・読破状況）が独立に対応キーだけを削除する。
 * 要件 06-4「栞・既読・読破の3クリアは独立で、それぞれ栞（bookmarks）／既読（reached）／読破（read）のみを削除する。
 * 実行前に window.confirm() でユーザー承認を取り、キャンセルなら何もしない」。
 * 目次 index.ts は独立方針で unit テストを持たないため、confirm 承認 × localStorage 整合の担保はここに置く。
 * 設定ポップアップ経由と FAB 経由の両導線を通す（両方に同じ confirmAndRun ヘルパを通しているため）。
 */

import { test, expect } from './_fixtures';

// 目次を開く前に localStorage に3種を seed する fixture 拡張。
const seedStorage = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('reached', JSON.stringify(['01-01', '02-02']));
            localStorage.setItem('read', JSON.stringify(['01-01']));
            localStorage.setItem('bookmarks', JSON.stringify([
                { slot: 1, ep: 1, sec: 1, scene: 0, ratio: 0.3, savedAt: 100 },
            ]));
            localStorage.setItem('sceneRead', JSON.stringify(['01-01-00']));
            localStorage.setItem('schemaVersion', '5'); // 移行を走らせない
        } catch { /* noop */ }
    });
};

const readStorage = async (page: import('@playwright/test').Page) => {
    return await page.evaluate(() => ({
        reached: localStorage.getItem('reached'),
        read: localStorage.getItem('read'),
        bookmarks: localStorage.getItem('bookmarks'),
        sceneRead: localStorage.getItem('sceneRead'),
    }));
};

const openSettingsFromFab = async (page: import('@playwright/test').Page) => {
    await page.locator('#fab-toggle').click();
    await page.getByRole('menuitem', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
};

test.describe('設定ポップアップ経由の3クリア × confirm 承認', () => {
    test.beforeEach(async ({ page }) => {
        await seedStorage(page);
    });

    test('「栞をクリア」＋accept で bookmarks のみ削除・他は温存', async ({ page }) => {
        page.once('dialog', (d) => d.accept());
        await page.goto('/lirmena/');
        await openSettingsFromFab(page);
        await page.locator('.settings-action', { hasText: '栞をクリア' }).click();

        const s = await readStorage(page);
        expect(s.bookmarks).toBeNull();
        expect(s.reached).not.toBeNull();
        expect(s.read).not.toBeNull();
        expect(s.sceneRead).not.toBeNull();
    });

    test('「既読をクリア」＋accept で reached と sceneRead のみ削除・他は温存', async ({ page }) => {
        page.once('dialog', (d) => d.accept());
        await page.goto('/lirmena/');
        await openSettingsFromFab(page);
        await page.locator('.settings-action', { hasText: '既読をクリア' }).click();

        const s = await readStorage(page);
        expect(s.reached).toBeNull();
        expect(s.sceneRead).toBeNull();
        expect(s.read).not.toBeNull();
        expect(s.bookmarks).not.toBeNull();
    });

    test('「読破状況をクリア」＋accept で read と sceneRead を削除・reached / bookmarks は温存', async ({ page }) => {
        page.once('dialog', (d) => d.accept());
        await page.goto('/lirmena/');
        await openSettingsFromFab(page);
        await page.locator('.settings-action', { hasText: '読破状況をクリア' }).click();

        const s = await readStorage(page);
        expect(s.read).toBeNull();
        // sceneRead も削除（loadReadSections が完了マーカーから読破を復活させないため）
        expect(s.sceneRead).toBeNull();
        expect(s.reached).not.toBeNull();
        expect(s.bookmarks).not.toBeNull();
    });

    test('confirm キャンセルなら 3ボタンのどれを押しても何も消えない', async ({ page }) => {
        await page.goto('/lirmena/');
        await openSettingsFromFab(page);

        for (const label of ['栞をクリア', '既読をクリア', '読破状況をクリア']) {
            page.once('dialog', (d) => d.dismiss());
            await page.locator('.settings-action', { hasText: label }).click();
        }

        const s = await readStorage(page);
        expect(s.bookmarks).not.toBeNull();
        expect(s.reached).not.toBeNull();
        expect(s.read).not.toBeNull();
        expect(s.sceneRead).not.toBeNull();
    });
});

test.describe('FAB 直接の3クリア × confirm 承認（設定パネル経由と対称）', () => {
    test.beforeEach(async ({ page }) => {
        await seedStorage(page);
    });

    test('FAB「読破状況をクリア」＋accept で read と sceneRead を削除・reached / bookmarks は温存', async ({ page }) => {
        page.once('dialog', (d) => d.accept());
        await page.goto('/lirmena/');
        await page.locator('#fab-toggle').click();
        await page.getByRole('menuitem', { name: '読破状況をクリア' }).click();

        const s = await readStorage(page);
        expect(s.read).toBeNull();
        expect(s.sceneRead).toBeNull();
        expect(s.reached).not.toBeNull();
        expect(s.bookmarks).not.toBeNull();
    });

    test('FAB「既読をクリア」＋dismiss なら何も消えない', async ({ page }) => {
        page.once('dialog', (d) => d.dismiss());
        await page.goto('/lirmena/');
        await page.locator('#fab-toggle').click();
        await page.getByRole('menuitem', { name: '既読をクリア' }).click();

        const s = await readStorage(page);
        expect(s.reached).not.toBeNull();
        expect(s.sceneRead).not.toBeNull();
    });
});
