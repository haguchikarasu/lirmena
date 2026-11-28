/*
 * 骨格 E2E：ページを移る導線はリンク（要件 06-1・06-6・08）。
 * 本文末の「次へ」「第◯巻あとがき」、タイトルページの「本文を読む」「前の話へ」は <a href>。
 *   - 行き先（href）は nav.ts / title.ts が実行時に入れる（公開状態で決まる。雛形には無い＝src/html-contract.test.ts）
 *   - ふつうのクリックと Enter は、サイトが受けてフェードつきで移る（preventDefault → transition.leave）
 *   - Ctrl・Shift などを押したクリックは、サイトは何もしない＝ブラウザが新しいタブなどで開く。移る前に書くもの
 *     （pendingScrollEnd）も書かない
 *   - 行き先が無いとき（第 1 話の「前の話へ」）は無効なリンク
 * 「前の話へ」で本文末に着くこと・「次へ」で進むことは resume.spec.ts・next-nav.spec.ts・afterword-records.spec.ts が見る。
 * 公開状態は _records.ts の fixture（第 1 巻：01-01・01-02・02-01〜02-03＝巻末＋あとがき／第 2 巻：05-01・05-02。05-03 は未公開）。
 */

import { test, expect } from './_fixtures';
import type { Locator, Page } from '@playwright/test';
import { setupRoutes, waitReader } from './_records';

const hrefOf = (a: Locator) => a.evaluate((el) => {
    const raw = el.getAttribute('href');
    if (raw === null) return null;
    const u = new URL(raw, location.href);
    return u.pathname.replace(/^.*\/lirmena\//, '') + u.search;
});

const openReader = async (page: Page, file: string) => {
    await page.goto(`/lirmena/contents/${file}`);
    await waitReader(page);
};
const openTitle = async (page: Page, file: string) => {
    await page.goto(`/lirmena/contents/${file}`);
    await expect(page.locator('#title-screen')).toBeVisible();
};

/**
 * 押し方を指定した click を 1 回送り、サイトが受けたか（preventDefault したか）を返す。
 * サイトのハンドラ（リンク自身）が走った後、window で結果を読んでから既定の動きを止める＝ページは移らず、新しいタブも開かない。
 */
const siteHandles = (a: Locator, init: MouseEventInit) => a.evaluate((el, init) => new Promise<boolean>((res) => {
    window.addEventListener('click', (e) => { res(e.defaultPrevented); e.preventDefault(); }, { once: true });
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
}), init);

test.beforeEach(async ({ page }) => { await setupRoutes(page); });

test.describe('本文末のリンク', () => {
    test('「次へ」は次の話へのリンク。名前は見えている文字', async ({ page }) => {
        await openReader(page, '01-01.html');
        const next = page.getByRole('link', { name: '次へ', exact: true });
        await expect(next).toHaveAttribute('id', 'btn-next');
        expect(await hrefOf(next)).toBe('contents/01-02.html');
        await expect(next).not.toHaveAttribute('aria-label');
    });

    test('次が無いときは「目次へもどる」で、行き先は目次', async ({ page }) => {
        await openReader(page, '05-02.html');
        const next = page.getByRole('link', { name: '目次へもどる', exact: true });
        await expect(next).toHaveAttribute('id', 'btn-next');
        expect(await hrefOf(next)).toBe('');
        // フェードを挟まずリンクのまま移る＝サイトは受けない
        expect(await siteHandles(next, {})).toBe(false);
    });

    test('巻末：「次へ」は次の巻の扉、「第１巻あとがき」はあとがき。あとがきのページの「次へ」も次の巻の扉', async ({ page }) => {
        await openReader(page, '02-03.html');
        expect(await hrefOf(page.locator('#btn-next'))).toBe('contents/05-00.html');
        const af = page.getByRole('link', { name: '第１巻あとがき', exact: true });
        await expect(af).toBeVisible();
        expect(await hrefOf(af)).toBe('contents/vol01-afterword.html');

        await openReader(page, 'vol01-afterword.html');
        expect(await hrefOf(page.locator('#btn-next'))).toBe('contents/05-00.html');
        await expect(page.locator('#btn-afterword')).toBeHidden();
    });

    test('巻末でない話では「あとがき」のリンクは出ず、行き先も持たない', async ({ page }) => {
        await openReader(page, '01-01.html');
        await expect(page.locator('#btn-afterword')).toBeHidden();
        await expect(page.locator('#btn-afterword')).not.toHaveAttribute('href');
    });

    test('ふつうのクリックはサイトが受ける。Ctrl・Shift・Meta・Alt つきと左以外のボタンは受けない', async ({ page }) => {
        await openReader(page, '02-03.html');
        for (const id of ['#btn-next', '#btn-afterword']) {
            const a = page.locator(id);
            for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
                expect(await siteHandles(a, init), `${id} ${JSON.stringify(init)}`).toBe(false);
            }
            // 受けなかったクリックでは幕を下ろさない
            await expect(page.locator('#transition-overlay')).not.toHaveClass(/fading/);
        }
        expect(await siteHandles(page.locator('#btn-next'), {})).toBe(true);
        await page.waitForURL(/contents\/05-00\.html/);
    });

    test('Enter で次の話へ移る', async ({ page }) => {
        await openReader(page, '01-01.html');
        await page.locator('#btn-next').focus();
        await page.keyboard.press('Enter');
        await page.waitForURL(/contents\/01-02\.html/);
    });

    test('現在のページのクエリ（?dev）を行き先に引き継ぐ', async ({ page }) => {
        await openReader(page, '01-01.html?dev');
        expect(await hrefOf(page.locator('#btn-next'))).toBe('contents/01-02.html?dev');
    });

    test('Ctrl を押しながらクリックすると新しいタブで開き、元のページはそのまま', async ({ page, context, browserName }) => {
        // 新しいタブを開く押し方はブラウザと OS で違う。実際に開く所まで見るのは Chromium だけ（受けないことは上の検査が 3 ブラウザで見る）
        test.skip(browserName !== 'chromium', '新しいタブが開く所まで見るのは Chromium だけ');
        await openReader(page, '01-01.html');
        const [tab] = await Promise.all([
            context.waitForEvent('page'),
            page.locator('#btn-next').click({ modifiers: ['ControlOrMeta'] }),
        ]);
        await tab.waitForURL(/contents\/01-02\.html/);
        expect(page.url()).toMatch(/contents\/01-01\.html/);
        await expect(page.locator('#transition-overlay')).not.toHaveClass(/fading/);
        await tab.close();
    });
});

test.describe('タイトルページのリンク', () => {
    test('第 1 話：「本文を読む」は 01-01 へ。「前の話へ」は行き先が無い無効なリンクで、押しても移らず、Tab でも止まらない', async ({ page }) => {
        await openTitle(page, '01-00.html');
        const enter = page.getByRole('link', { name: '本文を読む', exact: true });
        expect(await hrefOf(enter)).toBe('contents/01-01.html');

        const prev = page.getByRole('link', { name: '前の話へ', exact: true, disabled: true });
        await expect(prev).toHaveAttribute('id', 'btn-title-prev');
        await expect(prev).not.toHaveAttribute('href');
        await expect(prev).not.toHaveAttribute('tabindex');
        // フォーカスを受けない（href の無い <a> はフォーカスできない＝Tab の停止先にならない）
        expect(await prev.evaluate((el) => { (el as HTMLElement).focus(); return document.activeElement === el; })).toBe(false);
        expect(await siteHandles(prev, {})).toBe(false);
        await expect(page.locator('#transition-overlay')).not.toHaveClass(/fading/);
        expect(page.url()).toMatch(/contents\/01-00\.html/);
    });

    test('第 2 話：「前の話へ」は前の話の最後の節へ。ふつうのクリックだけが「本文末へ着く」印を書く', async ({ page }) => {
        await openTitle(page, '02-00.html');
        const prev = page.getByRole('link', { name: '前の話へ', exact: true });
        expect(await hrefOf(prev)).toBe('contents/01-02.html');
        await expect(prev).not.toHaveAttribute('aria-disabled');

        // 印は click の直後に同じ evaluate の中で読む（ふつうのクリックはすぐにページが移るので、後からは読めない）
        const clickAndReadPending = (init: MouseEventInit) => prev.evaluate((el, init) => new Promise<[boolean, string | null]>((res) => {
            window.addEventListener('click', (e) => { res([e.defaultPrevented, localStorage.getItem('pendingScrollEnd')]); e.preventDefault(); }, { once: true });
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
        }), init);
        expect(await clickAndReadPending({ ctrlKey: true }), '新しいタブで開くときは、サイトは受けず、印も書かない').toEqual([false, null]);

        // ふつうのクリック：印を書いてから、フェードの後にサイトが移る
        const [handled, pending] = await clickAndReadPending({});
        expect(handled).toBe(true);
        expect(JSON.parse(pending ?? 'null')).toEqual({ ep: 1, sec: 2 });
        await page.waitForURL(/contents\/01-02\.html/);
    });

    test('Tab で「本文を読む」に止まり、Enter で本文へ移る', async ({ page }) => {
        await openTitle(page, '02-00.html');
        await page.keyboard.press('Tab');
        await expect(page.locator('#btn-title-enter')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#btn-title-prev')).toBeFocused();
        await page.locator('#btn-title-enter').focus();
        await page.keyboard.press('Enter');
        await page.waitForURL(/contents\/02-01\.html/);
    });

    test('現在のページのクエリ（?dev）を行き先に引き継ぐ', async ({ page }) => {
        await openTitle(page, '02-00.html?dev');
        expect(await hrefOf(page.locator('#btn-title-enter'))).toBe('contents/02-01.html?dev');
        expect(await hrefOf(page.locator('#btn-title-prev'))).toBe('contents/01-02.html?dev');
    });
});
