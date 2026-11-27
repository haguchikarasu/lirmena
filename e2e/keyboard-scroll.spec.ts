/*
 * 受け入れテスト：キーボードで本文を動かす（src/keyscroll.ts）。本文ページは文書ではなく #main-container がスクロールするので、
 * サイトがキーを受けて動かす。
 *
 * 仕様：
 *   - どの場面でも効く（開いた直後・「読み進める」の後・ボタンにフォーカスがあるとき）：矢印・PageUp/PageDown・Home・End・Space
 *   - 横書き（下へ進む）：↓＝1 行進む、↑＝1 行戻る。← → は何もしない
 *   - 縦書き（左へ進む）：← と ↓ で 1 行進み、→ と ↑ で戻る
 *   - PageDown・Space＝進行方向の表示長の 0.875 倍ぶん進む。PageUp・Shift+Space＝同じだけ戻る（両方向共通）
 *   - Home＝本文の頭（開幕）、End＝本文の末尾（#btn-next が画面に入る）
 *   - 動かさない場面：ボタンにフォーカスがあるときの Space／メニュー・シート・初回の案内が開いている間／
 *     背景鑑賞モード（<html>.is-immersive）の間／Ctrl・Alt・Meta と一緒に押したとき
 *
 * 時間には頼らない：待ちは expect.poll と、ページの中の rAF（フレーム）で位置が落ち着くまで見る settle だけで書く。
 * 「動かない」ことは、キーを押したあと位置が落ち着くのを待ってから、押す前と同じかを見る。
 * 位置は _records の position（読み進める向きの px・0 起点・正値）で測る。
 */

import type { Page } from '@playwright/test';
import { test, expect } from './_fixtures';
import { position, setupRoutes, setWritingMode, waitReader } from './_records';

const MODES = ['horizontal', 'vertical'] as const;
type Mode = (typeof MODES)[number];

const LINE_MAX = 120;     // 1 行ぶんの上限（px）。0 より大きく、これ未満
const PAGE_RATIO = 0.875; // 1 画面ぶん＝表示長 × 0.875
const PAGE_TOL = 0.15;    // ±15%

// 書字方向を決めて、開いた直後（どこも押していない・開幕）の状態で開く。本文は route で固定の長さにする
async function openAtOpening(page: Page, mode: Mode): Promise<void> {
    await setupRoutes(page);
    await setWritingMode(page, mode);
    await page.goto('/lirmena/contents/01-02.html');
    await waitReader(page);
    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', mode);
    await expect(page.locator('html')).toHaveClass(/\bat-opening\b/);
}

// 「読み進める」を押して開幕を抜ける（スクロールのアニメーションが終わるまで待つ）
async function leaveOpening(page: Page): Promise<void> {
    await page.locator('#opening-start').click();
    await expect(page.locator('html')).not.toHaveClass(/\bat-opening\b/);
    await settle(page);
}

// 位置が落ち着く（10 フレーム続けて変わらない）まで待って、その位置を返す。滑らかなスクロールの途中の値を読まないため。
// 上限 240 フレームで諦めて、そのときの位置を返す（タイマーは使わない）
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

// 「押したのに動かない」の確認：位置が落ち着いてから、押す前と同じ（±1px）であることを見る
async function expectUnmoved(page: Page, before: number, message: string): Promise<void> {
    const after = await settle(page);
    expect(Math.abs(after - before), message).toBeLessThanOrEqual(1);
}

// #btn-next の矩形が全体でビューポートに入っている（toBeInViewport は WebKit で縦書きの器の中の子を交差 0 と返すため、矩形で見る）
async function btnNextInViewport(page: Page): Promise<boolean> {
    const b = await page.locator('#btn-next').boundingBox();
    const vp = page.viewportSize()!;
    if (!b || b.width === 0 || b.height === 0) return false;
    return b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
}

// 1 画面ぶんの期待の幅（表示長 × 0.875 の ±15%）
async function pageRange(page: Page): Promise<{ min: number; max: number }> {
    const { client } = await position(page);
    return { min: client * PAGE_RATIO * (1 - PAGE_TOL), max: client * PAGE_RATIO * (1 + PAGE_TOL) };
}

for (const mode of MODES) {
    test.describe(`書字方向：${mode}`, () => {
        // K1：開いた直後に ↓ で進み、↑ で戻る（両方向。縦書きも ↓ は進む・↑ は戻る）
        test(`K1 開いた直後に ↓ で 1 行進み、↑ で戻る（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            await page.keyboard.press('ArrowDown');
            await expect.poll(() => settle(page), { message: '↓ で進む' }).toBeGreaterThan(0);
            const p1 = await settle(page);
            expect(p1, '1 行ぶんは 120px 未満').toBeLessThan(LINE_MAX);
            // 1 行ぶん＝本文の段落の行の高さ（予備の 40px に落ちていないことも見る。行の高さは段落に付いている）
            const line = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#scene-content p')!).lineHeight));
            expect(line, '段落の行の高さが px で読める').toBeGreaterThan(0);
            expect(Math.abs(p1 - line), `↓ の量（${p1}）は段落の行の高さ（${line}）`).toBeLessThanOrEqual(2);

            await page.keyboard.press('ArrowDown');
            await expect.poll(() => settle(page), { message: '続けて ↓ でさらに進む' }).toBeGreaterThan(p1 + 1);
            const p2 = await settle(page);

            await page.keyboard.press('ArrowUp');
            await expect.poll(() => settle(page), { message: '↑ で戻る' }).toBeLessThan(p2 - 1);
            const p3 = await settle(page);
            expect(p3, '↑ は 1 行ぶんだけ戻る（頭まで飛ばない）').toBeGreaterThan(0);
            expect(p2 - p3, '戻る量は 1 行ぶん').toBeLessThan(LINE_MAX);
        });

        // K2：PageDown で約 1 画面進み PageUp で戻る／Space で進み Shift+Space で戻る
        test(`K2 PageDown・Space で約 1 画面進み、PageUp・Shift+Space で戻る（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const { min, max } = await pageRange(page);
            const { range } = await position(page);
            expect(range, '本文が短すぎて検査できない').toBeGreaterThan(max * 2);

            for (const [fwd, back] of [['PageDown', 'PageUp'], ['Space', 'Shift+Space']] as const) {
                const start = await settle(page);
                await page.keyboard.press(fwd);
                await expect.poll(() => settle(page), { message: `${fwd} で約 1 画面進む` }).toBeGreaterThanOrEqual(start + min);
                const moved = (await settle(page)) - start;
                expect(moved, `${fwd} の量は表示長の 0.875 倍の ±15%`).toBeLessThanOrEqual(max);

                await page.keyboard.press(back);
                await expect.poll(() => settle(page), { message: `${back} で同じだけ戻る` }).toBeLessThanOrEqual(start + 4);
                expect(Math.abs((await settle(page)) - start), `${back} は進んだ量と同じだけ戻る`).toBeLessThanOrEqual(max * 0.15 + 4);
            }
        });

        // K10：続けて押した分は積み上がる（滑らかに動いている途中で次を押しても、2 回ぶん進む）
        test(`K10 PageDown を続けて 3 回押すと約 3 画面進む（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const { min, max } = await pageRange(page);
            for (let i = 0; i < 3; i++) await page.keyboard.press('PageDown');
            await expect.poll(() => settle(page), { message: '3 回ぶん進む' }).toBeGreaterThanOrEqual(min * 3);
            expect(await settle(page), '3 回ぶんを超えない').toBeLessThanOrEqual(max * 3);
        });

        // K3：縦書きは ← で進み → で戻る／横書きは ← → で動かない
        if (mode === 'vertical') {
            test(`K3 縦書きは ← で 1 行進み、→ で戻る（${mode}）`, async ({ page }) => {
                await openAtOpening(page, mode);
                await page.keyboard.press('ArrowLeft');
                await expect.poll(() => settle(page), { message: '← で進む' }).toBeGreaterThan(0);
                const p1 = await settle(page);
                expect(p1, '1 行ぶんは 120px 未満').toBeLessThan(LINE_MAX);

                await page.keyboard.press('ArrowLeft');
                await expect.poll(() => settle(page), { message: '続けて ← でさらに進む' }).toBeGreaterThan(p1 + 1);
                const p2 = await settle(page);

                await page.keyboard.press('ArrowRight');
                await expect.poll(() => settle(page), { message: '→ で戻る' }).toBeLessThan(p2 - 1);
                expect(p2 - (await settle(page)), '戻る量は 1 行ぶん').toBeLessThan(LINE_MAX);
            });
        } else {
            test(`K3 横書きは ← → で動かない（${mode}）`, async ({ page }) => {
                await openAtOpening(page, mode);
                // 戻る向きが頭で止まって「動かない」に見えないよう、先に少し進めておく
                await page.keyboard.press('ArrowDown');
                await expect.poll(() => settle(page)).toBeGreaterThan(0);
                await page.keyboard.press('ArrowDown');
                const before = await settle(page);
                await page.keyboard.press('ArrowLeft');
                await expectUnmoved(page, before, '← は何もしない');
                await page.keyboard.press('ArrowRight');
                await expectUnmoved(page, before, '→ は何もしない');
            });
        }

        // K4：End で末尾（#btn-next が画面内）、Home で頭（開幕が戻る・位置 0 付近）
        test(`K4 End で本文の末尾へ、Home で頭（開幕）へ（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            await page.keyboard.press('End');
            await expect.poll(async () => {
                const p = await position(page);
                return p.range - p.progress;
            }, { message: 'End で末尾へ着く' }).toBeLessThanOrEqual(4);
            await expect.poll(() => btnNextInViewport(page), { message: '#btn-next が画面に入る' }).toBe(true);
            await expect(page.locator('html')).not.toHaveClass(/\bat-opening\b/);

            await page.keyboard.press('Home');
            await expect.poll(() => settle(page), { message: 'Home で頭へ戻る' }).toBeLessThanOrEqual(4);
            await expect(page.locator('html'), '頭は開幕').toHaveClass(/\bat-opening\b/);
        });

        // K5：「読み進める」をマウスで押した後も ↓ で進む
        test(`K5 「読み進める」を押した後も ↓ で進む（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            await leaveOpening(page);
            const before = await settle(page);
            expect(before, '読書点の位置まで送られている').toBeGreaterThan(0);
            await page.keyboard.press('ArrowDown');
            await expect.poll(() => settle(page), { message: '↓ で進む' }).toBeGreaterThan(before + 1);
            expect((await settle(page)) - before, '1 行ぶんは 120px 未満').toBeLessThan(LINE_MAX);
        });

        // K6：ボタンにフォーカスがあるときの Space は本文を動かさない（ボタンを押す動作に譲る）
        test(`K6 ボタンにフォーカスがあるときの Space は本文を動かさず、ボタンが押される（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const before = await settle(page);
            await page.locator('#menu-toggle').focus();
            await expect(page.locator('#menu-toggle')).toBeFocused();
            await page.keyboard.press('Space');
            await expect(page.locator('#menu-panel'), 'Space でメニューが開く').toBeVisible();
            await expectUnmoved(page, before, 'Space で本文は動かない');
        });

        // K7：メニューが開いている間は ↓ で動かない
        test(`K7 メニューが開いている間は ↓ で動かない（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const before = await settle(page);
            await page.locator('#menu-toggle').click();
            await expect(page.locator('#menu-panel')).toBeVisible();
            await page.keyboard.press('ArrowDown');
            await expectUnmoved(page, before, 'メニュー表示中は本文が動かない');
            await expect(page.locator('#menu-panel'), '押してもメニューは開いたまま').toBeVisible();
        });

        // K8：背景鑑賞モードの間は ↓ で動かない（開幕を抜けてから Esc で入る）
        test(`K8 背景鑑賞モードの間は ↓ で動かない（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            await leaveOpening(page);
            await page.keyboard.press('Escape');
            await expect(page.locator('html'), 'Esc で鑑賞モードに入る').toHaveClass(/\bis-immersive\b/);
            const before = await settle(page);
            await page.keyboard.press('ArrowDown');
            await expectUnmoved(page, before, '鑑賞モード中は本文が動かない');
            await expect(page.locator('html'), '↓ で鑑賞モードは抜けない').toHaveClass(/\bis-immersive\b/);
        });

        // K9：Ctrl と一緒に押したときは動かさない
        test(`K9 Ctrl+↓ では動かない（${mode}）`, async ({ page }) => {
            await openAtOpening(page, mode);
            const before = await settle(page);
            await page.keyboard.press('Control+ArrowDown');
            await expectUnmoved(page, before, 'Ctrl+↓ は本文を動かさない');
        });
    });
}
