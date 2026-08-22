/*
 * 骨格 E2E：初回の読み方選択ダイアログ（要件 06-4 プリセット / 06-12 初回導線）。
 *
 * **この spec だけは `./_fixtures` を使わず `@playwright/test` を直接 import する。**
 * fixture は `lirmena.tutorialSeen` と `lirmena.presetAsked` を全ページに先付けして初回導線を黙らせる
 * （他の spec ではオーバーレイがクリックを阻害するため）。ここは初回導線そのものが検査対象なので、
 * まっさらな localStorage で開く必要がある。
 *
 * 見ているのは 1) 出す/出さないのゲート 2) 閉じたあとチュートリアルへ繋がること 3) 読書位置を失わないこと。
 * 特に 3) は「firstrun.init() を bg.subscribe() より前に戻すと落ちる」回帰テスト。
 */

import { test, expect } from '@playwright/test';

const READER_URL = '/lirmena/contents/01-01.html';
const DISPLAY_KEYS = ['lirmena.writingMode', 'lirmena.lineGap', 'lirmena.fontFamily', 'lirmena.fontSize', 'lirmena.fontWeight'];

test('まっさらな読者にはダイアログが出て、書籍風を選ぶと縦書きになりチュートリアルが続く', async ({ page }) => {
    await page.goto(READER_URL);
    await expect(page.locator('#firstrun-popup')).toBeVisible();
    // 質問に答えるまでチュートリアルは出ない（図解が書字方向に依存するため）。
    await expect(page.locator('#tutorial-popup')).toBeHidden();

    await page.locator('#firstrun-popup').getByRole('button', { name: '書籍風' }).click();

    await expect(page.locator('#firstrun-popup')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'vertical');
    await expect(page.locator('#tutorial-popup')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('lirmena.presetAsked'))).toBe('1');
});

test('「あとで決める」は設定を変えずに閉じ、チュートリアルへ進む', async ({ page }) => {
    await page.goto(READER_URL);
    await expect(page.locator('#firstrun-popup')).toBeVisible();

    await page.locator('#firstrun-popup').getByRole('button', { name: 'あとで決める' }).click();

    await expect(page.locator('#firstrun-popup')).toBeHidden();
    await expect(page.locator('#tutorial-popup')).toBeVisible();
    const stored = await page.evaluate(
        (keys) => keys.map((k) => localStorage.getItem(k)),
        DISPLAY_KEYS,
    );
    expect(stored).toEqual([null, null, null, null, null]);
    expect(await page.evaluate(() => localStorage.getItem('lirmena.presetAsked'))).toBe('1');
});

// Escape で閉じた延長でチュートリアルを開くため、同じ keydown が後続のリスナー（tutorial.ts が document に
// 登録している Escape ハンドラ）に届くと両方閉じて tutorialSeen だけが立つ。firstrun は onDone を
// マイクロタスクに載せてこれを避けている。その構造が壊れたらここで落ちる。
test('Escape で閉じてもチュートリアルは閉じずに残る', async ({ page }) => {
    await page.goto(READER_URL);
    await expect(page.locator('#firstrun-popup')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('#firstrun-popup')).toBeHidden();
    await expect(page.locator('#tutorial-popup')).toBeVisible();
});

test('一度答えたらリロードしても再び訊かれない', async ({ page }) => {
    await page.goto(READER_URL);
    await page.locator('#firstrun-popup').getByRole('button', { name: '書籍風' }).click();
    await expect(page.locator('#firstrun-popup')).toBeHidden();

    await page.reload();
    await expect(page.locator('#main-container')).toBeVisible();
    await expect(page.locator('#firstrun-popup')).toBeHidden();
});

// ゲートの検査。ここで見るべきは「出ないこと」だけでなく「出ないうえでチュートリアルは出ること」——
// firstrun が onDone を呼び損ねると、設定を触ったことがある読者が初回ガイドへ永久に到達できなくなる。
test('表示設定を触ったことがある読者には訊かず、チュートリアルだけが出る', async ({ page }) => {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('lirmena.fontSize', 'large');
        } catch { /* noop */ }
    });
    await page.goto(READER_URL);
    await expect(page.locator('#main-container')).toBeVisible();

    await expect(page.locator('#firstrun-popup')).toBeHidden();
    await expect(page.locator('#tutorial-popup')).toBeVisible();
});

test('目次ページにはダイアログの器を置かない', async ({ page }) => {
    await page.goto('/lirmena/');
    await expect(page.locator('#firstrun-popup')).toHaveCount(0);
});

// 読書位置の回帰。firstrun.init() は bg.subscribe() より後で呼ぶ必要がある——それより前だと
// reader.getLastRatio() が 0 のままで、プリセット適用の位置復元が本文先頭へ飛ばしてしまう。
test('読書位置を復元して開いた読者がプリセットを選んでも先頭へ飛ばない', async ({ page }) => {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('schemaVersion', '5');
            localStorage.setItem('autosave', JSON.stringify({ ep: 1, sec: 1, ratio: 0.5, savedAt: 1 }));
            localStorage.setItem('lirmena.tutorialSeen', '1');   // ガイドは本件と無関係なので黙らせる
        } catch { /* noop */ }
    });
    await page.goto(READER_URL);
    await expect(page.locator('#firstrun-popup')).toBeVisible();

    const before = await page.locator('#main-container').evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(0);   // オートセーブから途中位置で開けている（前提の確認）

    // 横書きのままのプリセットを選ぶ（書字方向を変えずに位置復元だけを走らせる）。
    await page.locator('#firstrun-popup').getByRole('button', { name: 'ウェブ小説風' }).click();
    await expect(page.locator('#firstrun-popup')).toBeHidden();

    const after = await page.locator('#main-container').evaluate((el) => el.scrollTop);
    expect(after).toBeGreaterThan(0);
});
