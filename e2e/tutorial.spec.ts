/*
 * 骨格 E2E：チュートリアル（初回ガイドのカード。<dialog id="tutorial-popup"> の showModal()。src/tutorial.ts）。
 *
 * **この spec は `./_fixtures` を使わず `@playwright/test` を直接 import する**（firstrun.spec.ts と同じ理由）。
 * fixture は `lirmena.tutorialSeen` を全ページに先付けして初回ガイドを黙らせるが、ここは初回の自動表示そのものが
 * 検査対象。`lirmena.presetAsked=1` だけを先付けして読み方ダイアログを黙らせ、まっさらな tutorialSeen で開く。
 * メニューからの再表示の検査だけは tutorialSeen=1 も先付けて、自動表示と混ざらないようにする。
 * ブラウザごとの「未対応」の表（_browser-gaps）はこのファイルには掛からない。
 *
 * 見ているのは、jsdom では決まらないもの：
 *   - 自動表示・フォーカス・Tab/Shift+Tab の閉じ込め・Enter での送り・カード地/縁/背景のクリックの振り分け・Esc・×
 *   - 開いている間、裏のボタンが押せず、キーで本文が動かない（縦書き・横書き）
 *   - 閉じたあとはリロードしても自動で開かず、鑑賞モードへ入れる／メニューから開き直すと 1 枚目から、閉じると FAB へフォーカスが戻る
 *   - カードが画面に収まる（PC・スマホ縦）、動きを減らす設定でアニメーションが tut-fade になる
 */

import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { position, reloadInPage, setupRoutes, setWritingMode, waitReader } from './_records';

const READER_URL = '/lirmena/contents/01-01.html';
const STEP_COUNT = 5;

// 初回扱い（読み方ダイアログだけ黙らせる。tutorialSeen は入れない）で本文ページを開き、カードが出るまで待つ
async function openFirstVisit(page: Page): Promise<void> {
    await page.addInitScript(() => {
        try { localStorage.setItem('lirmena.presetAsked', '1'); } catch { /* noop */ }
    });
    await page.goto(READER_URL);
    await expect(page.locator('#tutorial-popup')).toBeVisible();
}

// 既読扱いで本文ページを開く（メニューから再表示する検査用）
async function openSeen(page: Page): Promise<void> {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('lirmena.presetAsked', '1');
            localStorage.setItem('lirmena.tutorialSeen', '1');
        } catch { /* noop */ }
    });
    await page.goto(READER_URL);
    await expect(page.locator('#main-container')).toBeVisible();
    await expect(page.locator('#tutorial-popup')).toBeHidden();
}

// 右下メニュー →「チュートリアル」でカードを開く
async function openFromMenu(page: Page): Promise<void> {
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: 'チュートリアル', exact: true }).click();
    await expect(page.locator('#tutorial-popup')).toBeVisible();
}

// いま何枚目か（ドットの is-on の位置）
const stepIndex = (page: Page): Promise<number> =>
    page.locator('#tutorial-popup .tutorial-dots .dot').evaluateAll((ds) => ds.findIndex((d) => d.classList.contains('is-on')));

const nextBtn = (page: Page) => page.locator('#tutorial-popup .tutorial-next');

// カードの矩形
const cardBox = async (page: Page) => (await page.locator('#tutorial-popup').boundingBox())!;

// フレームを 3 つ進める（クリックの後始末・リロード直後の初期化が済むのを、時間でなく描画で待つ）
const settleFrames = (page: Page): Promise<void> =>
    page.evaluate(() => new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => res())));
    }));

// 進行軸の位置が 10 フレーム続けて変わらなくなるまで待って返す（_records の position と同じ式）
async function settle(page: Page): Promise<number> {
    return page.evaluate(() => new Promise<number>((resolve) => {
        const c = document.querySelector<HTMLElement>('#main-container')!;
        const v = document.documentElement.getAttribute('data-writing-mode') === 'vertical';
        const read = (): number => (v ? Math.abs(c.scrollLeft) : c.scrollTop);
        let last = read();
        let still = 0;
        let frames = 0;
        const tick = (): void => {
            const now = read();
            still = Math.abs(now - last) < 0.5 ? still + 1 : 0;
            last = now;
            frames += 1;
            if (still >= 10 || frames >= 240) resolve(now);
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }));
}

test.describe('初回の自動表示', () => {
    test('開くとカードが見え、フォーカスは「次へ」にある', async ({ page }) => {
        await openFirstVisit(page);
        await expect(nextBtn(page)).toBeFocused();
        await expect(nextBtn(page)).toHaveText('次へ');
        expect(await stepIndex(page)).toBe(0);
        // 器は <dialog> が自分で持つ（role・aria-modal を手で付けない）
        await expect(page.locator('#tutorial-popup')).not.toHaveAttribute('role', /./);
        await expect(page.locator('#tutorial-popup')).toHaveAttribute('aria-labelledby', 'tutorial-title');
    });

    test('Tab・Shift+Tab を回してもフォーカスはカードの中に留まる', async ({ page }) => {
        await openFirstVisit(page);
        // 1 枚目は「もどる」が隠れているので止まり先は × と「次へ」。Firefox・WebKit は端でブラウザ自身の UI へ出ることが
        // あるので、body に居る回は数えず、ページの中の止まり先がいつも器の中にあることを見る
        const where: string[] = [];
        for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
            await page.keyboard.press(key);
            where.push(await page.evaluate(() => {
                const a = document.activeElement;
                if (!a || a === document.body || a === document.documentElement) return 'page';
                return a.closest('#tutorial-popup') ? 'in' : 'out:' + (a.id || a.className || a.tagName);
            }));
        }
        expect(where.filter((w) => w.startsWith('out:'))).toEqual([]);
        expect(where).toContain('in');
    });

    test('Enter で次へ進み、5 枚目は「はじめる」で、Enter で閉じる', async ({ page }) => {
        await openFirstVisit(page);
        for (let i = 1; i < STEP_COUNT; i++) {
            await page.keyboard.press('Enter');
            await expect.poll(() => stepIndex(page), { message: `${i + 1} 枚目へ進む` }).toBe(i);
            await expect(nextBtn(page)).toBeFocused();   // 押し続けてそのまま読み進められる
        }
        await expect(nextBtn(page)).toHaveText('はじめる');
        await page.keyboard.press('Enter');
        await expect(page.locator('#tutorial-popup')).toBeHidden();
    });

    test('カード地のクリックで次へ進み、カードの縁の余白でも閉じずに次へ進む', async ({ page }) => {
        await openFirstVisit(page);
        await page.locator('#tutorial-popup .tutorial-text').click();
        await expect.poll(() => stepIndex(page), { message: 'カード地で次へ' }).toBe(1);

        // dialog 自身の余白（矩形の内側 3px。背景ではない）
        const b = await cardBox(page);
        await page.mouse.click(b.x + 3, b.y + b.height / 2);
        await expect.poll(() => stepIndex(page), { message: '縁の余白でも次へ（閉じない）' }).toBe(2);
        await expect(page.locator('#tutorial-popup')).toBeVisible();
    });

    test('背景を押すと閉じるだけで、裏の要素は押されない', async ({ page }) => {
        await openFirstVisit(page);
        const url = page.url();
        await page.mouse.click(5, 5);
        await expect(page.locator('#tutorial-popup')).toBeHidden();
        await settleFrames(page);
        await expect(page.locator('html')).not.toHaveClass(/\bis-immersive\b/);
        expect(page.url()).toBe(url);
    });

    test('Escape で閉じる', async ({ page }) => {
        await openFirstVisit(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#tutorial-popup')).toBeHidden();
    });

    test('× で閉じる', async ({ page }) => {
        await openFirstVisit(page);
        await page.locator('#tutorial-popup .tutorial-close').click();
        await expect(page.locator('#tutorial-popup')).toBeHidden();
    });

    test('開いている間、裏のメニューボタンは押せない', async ({ page }) => {
        await openFirstVisit(page);
        const box = await page.locator('#menu-toggle').boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await expect(page.locator('#menu-panel')).toBeHidden();
        // カードの外を押したので、いまのクリックでカードは閉じる（背景の振る舞い）。裏へは抜けていない
        await expect(page.locator('html')).not.toHaveClass(/\bis-immersive\b/);
    });

    test('閉じたあと、リロードしても自動では開かない', async ({ page }) => {
        await openFirstVisit(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#tutorial-popup')).toBeHidden();
        expect(await page.evaluate(() => localStorage.getItem('lirmena.tutorialSeen'))).toBe('1');

        await reloadInPage(page);
        await expect(page.locator('#main-container')).toBeVisible();
        await settleFrames(page);
        await expect(page.locator('#tutorial-popup')).toBeHidden();
    });
});

// 開いている間は、キーで本文が動かない（keyscroll.ts は開いたモーダルの間は何もしない）。書字方向の両方で、
// 「閉じたあとは同じキーで動く」対照を付けて、動かないのが検査の前提の崩れでないことを確かめる
for (const mode of ['horizontal', 'vertical'] as const) {
    test(`開いている間、矢印キー・PageDown・Space・End で本文が動かない（${mode}）`, async ({ page }) => {
        await setupRoutes(page);
        await setWritingMode(page, mode);
        await page.addInitScript(() => {
            try { localStorage.setItem('lirmena.presetAsked', '1'); } catch { /* noop */ }
        });
        await page.goto('/lirmena/contents/01-02.html');
        await waitReader(page);
        await expect(page.locator('#tutorial-popup')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-writing-mode', mode);

        const before = await settle(page);
        for (const key of ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'PageDown', 'Space', 'End']) {
            await page.keyboard.press(key);
            const after = await settle(page);
            expect(Math.abs(after - before), `${key} で本文が動かない`).toBeLessThanOrEqual(1);
        }
        await expect(page.locator('#tutorial-popup')).toBeVisible();

        // 対照：閉じたあとの PageDown は本文を動かす
        await page.keyboard.press('Escape');
        await expect(page.locator('#tutorial-popup')).toBeHidden();
        await page.keyboard.press('PageDown');
        await expect.poll(async () => (await position(page)).progress, { message: '閉じたあとは PageDown で動く' }).toBeGreaterThan(before + 10);
    });
}

test.describe('メニューからの再表示', () => {
    test('1 枚目から始まり、× で閉じるとフォーカスがメニューのボタンへ戻る', async ({ page }) => {
        await openSeen(page);
        await openFromMenu(page);
        expect(await stepIndex(page)).toBe(0);
        await page.locator('#tutorial-popup .tutorial-close').click();
        await expect(page.locator('#tutorial-popup')).toBeHidden();
        await expect(page.locator('#menu-toggle')).toBeFocused();
    });

    test('Escape で閉じるとフォーカスがメニューのボタンへ戻る', async ({ page }) => {
        await openSeen(page);
        await openFromMenu(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#tutorial-popup')).toBeHidden();
        await expect(page.locator('#menu-toggle')).toBeFocused();
    });

    test('背景を押して閉じるとフォーカスがメニューのボタンへ戻る', async ({ page }) => {
        await openSeen(page);
        await openFromMenu(page);
        await page.mouse.click(5, 5);
        await expect(page.locator('#tutorial-popup')).toBeHidden();
        await expect(page.locator('#menu-toggle')).toBeFocused();
    });

    test('2 枚目まで進めて閉じ、開き直すと 1 枚目から始まる', async ({ page }) => {
        await openSeen(page);
        await openFromMenu(page);
        await nextBtn(page).click();
        await expect.poll(() => stepIndex(page)).toBe(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('#tutorial-popup')).toBeHidden();

        await openFromMenu(page);
        expect(await stepIndex(page)).toBe(0);
        await expect(nextBtn(page)).toHaveText('次へ');
    });

    test('閉じているとき器は表示されず、本文のタップで鑑賞モードへ入れる', async ({ page }) => {
        await openSeen(page);
        await page.locator('#opening-start').click();
        await expect(page.locator('html')).not.toHaveClass(/\bat-opening\b/);
        await expect(page.locator('#tutorial-popup')).toBeHidden();
        expect(await page.locator('#tutorial-popup').evaluate((el) => getComputedStyle(el).display)).toBe('none');

        // 開いて閉じたあとも同じ（閉じた <dialog> を「開いている」と誤判定しない）
        await openFromMenu(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#tutorial-popup')).toBeHidden();
        const vp = page.viewportSize()!;
        await page.mouse.click(vp.width * 0.3, vp.height * 0.5);
        await expect(page.locator('html')).toHaveClass(/\bis-immersive\b/);
    });
});

test.describe('カードの収まり', () => {
    // 左右の空き 24px 以上・ビューポートの内側（小数の丸めに 0.5px の余裕）
    const expectFits = async (page: Page, equalSides: boolean): Promise<void> => {
        const b = await cardBox(page);
        const vp = page.viewportSize()!;
        const left = b.x;
        const right = vp.width - (b.x + b.width);
        expect(left, '左の空き').toBeGreaterThanOrEqual(23.5);
        expect(right, '右の空き').toBeGreaterThanOrEqual(23.5);
        expect(b.y, '上端がビューポートの内側').toBeGreaterThanOrEqual(-0.5);
        expect(b.y + b.height, '下端がビューポートの内側').toBeLessThanOrEqual(vp.height + 0.5);
        if (equalSides) expect(Math.abs(left - right), '左右の空きが等しい').toBeLessThanOrEqual(1);
    };

    test('PC：画面の中に収まり、左右の空きが等しい', async ({ page }) => {
        await openFirstVisit(page);
        await expectFits(page, true);
    });

    test.describe('スマホ縦', () => {
        test.use({ viewport: { width: 375, height: 812 } });

        test('画面の中に収まり、左右に 24px 以上空く', async ({ page }) => {
            await openFirstVisit(page);
            await expectFits(page, true);
        });
    });
});

test.describe('動きを減らす設定', () => {
    test('reduce では浮き上がらず（tut-fade）、設定なしでは浮き上がる（tut-rise）', async ({ page }) => {
        // 設定は開く前に切り替える（開いた直後のアニメーション名を読むため）
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openFirstVisit(page);
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), '設定が届いている').toBe(true);
        expect(await page.locator('#tutorial-popup').evaluate((el) => getComputedStyle(el).animationName)).toBe('tut-fade');
    });

    test('設定なし（no-preference）', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await openFirstVisit(page);
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), '設定が届いている').toBe(false);
        expect(await page.locator('#tutorial-popup').evaluate((el) => getComputedStyle(el).animationName)).toBe('tut-rise');
    });
});
