/*
 * localStorage が使えない環境の E2E（Cookie・サイトデータの全ブロック）。
 *
 * 守りたい不変条件：**localStorage を読むだけで例外が出る環境でも、目次・扉・本文が表示される**。
 * あわせて、**初回案内（読み方選択・チュートリアル）がページごとに出続けない**こと（代用品が表示済み扱いで始める）。
 * 全シェルの <head> の early ブロック（head-contract:early）が、例外を検出したら window.localStorage を
 * メモリ上の代用品に差し替える。TS の各モジュールは素の localStorage を try なしで触る箇所があるので、
 * 差し替えが外れると目次は「読み込み中」のまま、本文はエラー表示になる＝この spec が落ちる。
 *
 * ブロック状態の再現：addInitScript で window.localStorage を「読むと SecurityError を投げる getter」に置き換える
 * （Chrome の「サイトにデータの保存を許可しない」と同じ振る舞い。実ブラウザでも同じく configurable な自前プロパティ）。
 * _fixtures.ts は localStorage に書き込んで初回ポップアップを抑えるので、この spec は使わない（ブロック下では書けない）。
 */

import { test, expect, type Page } from '@playwright/test';

async function blockStorage(page: Page): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            enumerable: true,
            get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
        });
    });
    return errors;
}

test('ブロック下でも目次が表示され、ページの間は記録が動く', async ({ page }) => {
    const errors = await blockStorage(page);
    await page.goto('/lirmena/');
    await expect(page.locator('#episodes-area')).toBeVisible();
    await expect(page.locator('a[href*="contents/01-00.html"]').first()).toBeVisible();
    // 代用品に差し替わっている（読み書きでき、例外を投げない）
    const roundTrip = await page.evaluate(() => {
        localStorage.setItem('lirmena.e2e', 'x');
        return localStorage.getItem('lirmena.e2e');
    });
    expect(roundTrip).toBe('x');
    expect(errors).toEqual([]);
});

test('ブロック下でも扉と本文が表示され、初回案内は毎ページ出ない', async ({ page }) => {
    const errors = await blockStorage(page);
    await page.goto('/lirmena/contents/01-00.html');
    await expect(page.locator('#title-screen-ep-title')).toContainText('太陽の行く先');
    // 記録が残らない環境では毎ページ「初回」になるので、代用品は初回案内を表示済み扱いで始める（early ブロック）。
    // 2 ページ続けて開き、どちらでも読み方選択（firstrun）とチュートリアルが出ないこと
    for (const sec of ['01-01', '01-02']) {
        await page.goto(`/lirmena/contents/${sec}.html`);
        await expect(page.locator('#main-container')).toBeVisible();
        await expect(page.locator('#scene-content')).toBeVisible();
        await page.waitForTimeout(1000);   // firstrun / tutorial は本文表示の後に開く
        await expect(page.locator('#firstrun-popup'), sec).toBeHidden();
        await expect(page.locator('#tutorial-popup'), sec).toBeHidden();
    }
    expect(errors).toEqual([]);
});
