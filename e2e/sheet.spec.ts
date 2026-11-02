/*
 * 骨格 E2E：本文ページのシート（<dialog class="sheet">。器は ui/sheet）の共通の振る舞い。
 *   - シートの上・背景をタップしても鑑賞モード（<html>.is-immersive）が切り替わらない（immersive.ts は dialog[open] を見る。計画 R3）
 *   - シートを閉じたあとは、本文のタップで鑑賞モードに入れる（閉じた <dialog> を「開いている」と誤判定しない）
 *   - 栞シート：スロットを押すとその位置に保存して閉じる
 *   - 共有シート：中身の高さ（fit）で開き、3 つのボタンがある
 *   - スマホ幅：設定シートは中身の高さで開き、最後の「設定を初期値に戻す」まで最初から見える
 *   - スマホ幅：掴んで動かすと離した高さで止まり、画面の下の方で離すと閉じる（ui/sheet の _wireDrag）
 *   - 人物の顔の帯はマウスのホイールで横へ送れる
 *   - スマホ幅：見出しの帯のボタン（タブ・閉じる）の上から動かし始めても掴める。ただ押しただけならボタンとして働く（全シート）
 * 寸法・色は手動スモークに残す。Android の戻る操作で閉じるか（CloseWatcher）と、日本語の変換中の Esc は実機で確かめる。
 */

import { test, expect } from './_fixtures';

const openMenuItem = async (page: import('@playwright/test').Page, name: string): Promise<void> => {
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name }).click();
};

// 本文の読書エリアの空いている所（ボタンや FAB の無い所）を軽くクリックする＝鑑賞モードのトグルの入力
const tapReadingArea = async (page: import('@playwright/test').Page): Promise<void> => {
    const vp = page.viewportSize()!;
    await page.mouse.click(vp.width * 0.3, vp.height * 0.5);
};

test('シートの上と背景のタップでは鑑賞モードに入らず、閉じたあとは入れる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    // 開幕（本文先頭の黒い余白）の間は鑑賞モードに入らない仕様なので、本文へ進めておく
    await page.locator('#opening-start').click();
    await expect(page.locator('html')).not.toHaveClass(/at-opening/);

    await openMenuItem(page, '設定');
    const sheet = page.locator('#settings-popup');
    await expect(sheet).toBeVisible();
    // シートの中（見出し）をタップ
    await sheet.locator('.sheet-title').click();
    await expect(page.locator('html')).not.toHaveClass(/is-immersive/);
    // 背景をタップ＝シートが閉じるだけ
    await page.mouse.click(5, 5);
    await expect(sheet).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/is-immersive/);

    // 閉じたあとは本文のタップで入れる
    await tapReadingArea(page);
    await expect(page.locator('html')).toHaveClass(/is-immersive/);
});

test('栞シート：スロットを押すと保存して閉じる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    await openMenuItem(page, '栞を追加');
    const sheet = page.locator('#bookmark-popup');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-slot="2"]')).toHaveText('スロット2：空き');
    await sheet.locator('[data-slot="2"]').click();
    await expect(sheet).toBeHidden();

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bookmarks') ?? '[]') as { slot: number; ep: number; sec: number }[]);
    expect(saved).toEqual([expect.objectContaining({ slot: 2, ep: 1, sec: 1 })]);

    await openMenuItem(page, '栞を追加');
    await expect(sheet.locator('[data-slot="2"]')).toHaveText(/^スロット2：第1話 #1（\d+%）/);
});

test('共有シート：中身の高さで開き、3 つの共有の方法がある', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    await openMenuItem(page, '共有');
    const sheet = page.locator('#share-popup');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-detent', 'fit');
    for (const name of ['リンクをコピー', 'X でシェア', 'LINE でシェア']) {
        await expect(sheet.getByRole('button', { name })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
});

test.describe('スマホ幅', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('設定シートは最後のボタンまで最初から見える', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await openMenuItem(page, '設定');
        const sheet = page.locator('#settings-popup');
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('button', { name: '設定を初期値に戻す' })).toBeInViewport({ ratio: 1 });
    });

    test('掴んで動かすと離した高さで止まり、下の方で離すと閉じる', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await openMenuItem(page, '設定');
        const sheet = page.locator('#settings-popup');
        await expect(sheet).toBeVisible();

        const box0 = (await sheet.boundingBox())!;
        const grabY = box0.y + 8;
        // 120px 下げて、止めてから離す＝その高さで止まる（段に吸い寄せない）
        await page.mouse.move(187, grabY);
        await page.mouse.down();
        await page.mouse.move(187, grabY + 120, { steps: 8 });
        await page.waitForTimeout(200);
        await page.mouse.up();
        await expect(sheet).toBeVisible();
        await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(box0.height - 120));

        // 画面の下の方（高さ 3 割未満）まで下げて離すと閉じる
        const box1 = (await sheet.boundingBox())!;
        await page.mouse.move(187, box1.y + 8);
        await page.mouse.down();
        await page.mouse.move(187, 760, { steps: 8 });
        await page.waitForTimeout(200);
        await page.mouse.up();
        await expect(sheet).toBeHidden();

        // 開き直すと、止めた高さは持ち越さず中身の高さに戻る
        await openMenuItem(page, '設定');
        await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(box0.height));
    });

    test('人物の顔の帯はホイールで横へ送れる', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await openMenuItem(page, 'キャラクター紹介');
        const faces = page.locator('#world-sheet .cv-faces');
        await expect(faces).toBeVisible();
        await faces.hover();
        await page.mouse.wheel(0, 120);
        await expect.poll(() => faces.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    });

    // 見出しの帯のボタンの上から縦に動かすと掴める（ボタンは押されない）。掴む所は細く、すぐ下のタブに指が掛かる
    const dragFrom = async (page: import('@playwright/test').Page, el: import('@playwright/test').Locator, dy: number): Promise<void> => {
        const b = (await el.boundingBox())!;
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + dy, { steps: 8 });
        await page.waitForTimeout(200);
        await page.mouse.up();
    };

    test('資料シート：タブの上から上へ動かすと高くなり、タブは切り替わらない。押すだけなら切り替わる', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await openMenuItem(page, 'キャラクター紹介');
        const sheet = page.locator('#world-sheet');
        await expect(sheet).toBeVisible();
        const h0 = (await sheet.boundingBox())!.height;

        await dragFrom(page, page.locator('#world-tab-map'), -150);
        await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(h0 + 150));
        await expect(page.locator('#world-tab-characters')).toHaveAttribute('aria-selected', 'true');

        await page.locator('#world-tab-map').click();
        await expect(page.locator('#world-tab-map')).toHaveAttribute('aria-selected', 'true');
    });

    for (const { item, id } of [
        { item: '設定', id: '#settings-popup' },
        { item: '共有', id: '#share-popup' },
        { item: '栞を追加', id: '#bookmark-popup' },
        { item: 'キャラクター紹介', id: '#world-sheet' },
    ]) {
        test(`${item}：閉じるボタンの上から下へ少し動かすと低くなり、閉じない`, async ({ page }) => {
            await page.goto('/lirmena/contents/01-01.html');
            await expect(page.locator('#main-container')).toBeVisible();
            await openMenuItem(page, item);
            const sheet = page.locator(id);
            await expect(sheet).toBeVisible();
            const h0 = (await sheet.boundingBox())!.height;
            await dragFrom(page, sheet.locator('.sheet-head [data-sheet-close]'), 30);
            await expect(sheet).toBeVisible();
            await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(h0 - 30));
        });
    }

    test('資料シート：全画面まで上げて閉じても、次は最初の高さで開く', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await openMenuItem(page, 'キャラクター紹介');
        const sheet = page.locator('#world-sheet');
        await expect(sheet).toBeVisible();
        const h0 = (await sheet.boundingBox())!.height;

        await dragFrom(page, page.locator('#world-tab-map'), -300);
        await expect(sheet).toHaveAttribute('data-detent', 'full');
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();

        await openMenuItem(page, '用語集');
        await expect(sheet).toHaveAttribute('data-detent', 'half');
        await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(h0));
    });

    test('ボタンの上から掴んだあとも、キーボードでボタンを押せる', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await openMenuItem(page, 'キャラクター紹介');
        const sheet = page.locator('#world-sheet');
        await expect(sheet).toBeVisible();
        await dragFrom(page, page.locator('#world-tab-map'), -100);
        await page.locator('#world-tab-glossary').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#world-tab-glossary')).toHaveAttribute('aria-selected', 'true');
    });
});
