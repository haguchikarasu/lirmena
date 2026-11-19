/*
 * 骨格 E2E：タッチで背景を押してシート・確認を閉じたとき、その 1 回のタップが下の要素に届かないこと。
 *
 * なぜ実ブラウザで見るか：タッチのあとに合成される click の行き先は「その時点でその座標に見えている要素」で、
 * 決めるのはブラウザ（jsdom の単体テスト src/ui/{sheet,confirm}.test.ts では再現できない）。
 * いまは手書きの判定（click で閉じる。ui/sheet・ui/confirm）なので、click は閉じる前の <dialog> に届いて終わる。
 * HTML の closedby="any" に置き換えると、ブラウザは pointerdown の時点で閉じ、後から来る click が下のページに届く
 * （2026-11-19 に Chromium 149 で実測：共有シートの背景タップで下の「設定」が押される／確認の背景タップで
 * 下の設定シートも一緒に閉じる）。そのため closedby は入れていない。入れ直すとき・閉じ方を変えるときはここが赤になる。
 *
 * 見るもの（要件 06-4：確認は Esc・背景・「やめる」で何もせず閉じる。design/modules/sheet.md）：
 *   - 目次：共有シートを開き、上の帯の「設定」の真上の背景をタップ → 共有シートだけが閉じ、設定シートは開かない
 *   - 目次：設定シートの上に確認を開き、背景をタップ → 確認だけが閉じ、設定シートは開いたまま。設定値は変わらない
 */

import { test, expect } from './_fixtures';

test.describe('タッチで背景を押して閉じる（スマホ幅）', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('共有シートの背景タップは、下にある「設定」ボタンを押さない', async ({ page }) => {
        await page.goto('/lirmena/');
        const settingsBtn = page.locator('#idx-btn-settings');
        const box = await settingsBtn.boundingBox();
        expect(box).not.toBeNull();
        const x = box!.x + box!.width / 2;
        const y = box!.y + box!.height / 2;

        await page.locator('#idx-btn-share').tap();
        const share = page.locator('#share-popup');
        await expect(share).toBeVisible();
        // タップする点が共有シートの器の外（＝背景）であること。器に重なっていたら検査にならない
        const sheetBox = await share.boundingBox();
        expect(y).toBeLessThan(sheetBox!.y);

        await page.touchscreen.tap(x, y);
        await expect(share).toBeHidden();
        // 抜けた click が届くなら、閉じた直後に設定シートが開く。少し待ってから見る
        await page.waitForTimeout(300);
        await expect(page.locator('#settings-popup')).toBeHidden();
    });

    test('確認の背景タップは確認だけを閉じ、下の設定シートは開いたまま', async ({ page }) => {
        await page.goto('/lirmena/');
        await page.evaluate(() => localStorage.setItem('lirmena.fontSize', 'large'));
        await page.locator('#idx-btn-settings').tap();
        const settings = page.locator('#settings-popup');
        await expect(settings).toBeVisible();
        await page.locator('.settings-action', { hasText: '設定を初期値に戻す' }).tap();
        const confirm = page.locator('#confirm-dialog');
        await expect(confirm).toBeVisible();

        // 確認の器より上の背景をタップする
        const box = await confirm.boundingBox();
        expect(box!.y).toBeGreaterThan(40);
        await page.touchscreen.tap(195, 20);
        await expect(confirm).toBeHidden();
        await page.waitForTimeout(300);
        await expect(settings).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('lirmena.fontSize'))).toBe('large');
    });
});
