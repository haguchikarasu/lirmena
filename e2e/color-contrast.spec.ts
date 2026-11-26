/*
 * E2E：弱い文字のコントラスト（WCAG 1.4.3。文字とその下の地が 4.5 : 1 以上）。
 * 対象は、以前に足りていなかった 6 か所（本文ページと目次・資料ページの「読み込み中」、目次の版の表示、
 * 変更履歴の版種別スイッチの選んでいないボタン、用語集の言語表記の行、用語の検索欄の案内文）。
 *
 * 文字色は getComputedStyle（案内文は '::placeholder'）。地は、要素から祖先をたどって背景色を集め、
 * 不透明な色に当たるまでの半透明の層を重ねた単色。**絵（目次・資料ページの背景の絵）は数えない**＝
 * 絵の明るい所では比が下がりうる（そこは手で測る。地が絵で単色に決まらないため）。
 * 比は WCAG の相対輝度の式で計算する。
 */

import type { Page } from '@playwright/test';
import { test, expect } from './_fixtures';

type Probe = { color: string; ground: [number, number, number] };

/** 文字色と、祖先の背景色を重ねた地を返す（ブラウザの中で計算する） */
async function probe(page: Page, selector: string, pseudo: string | null = null): Promise<Probe> {
    await expect(page.locator(selector).first()).toBeAttached();
    return page.evaluate(([sel, ps]) => {
        const parse = (s: string): number[] => {
            const n = (s.match(/[\d.]+/g) ?? []).map(Number);
            return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
        };
        const el = document.querySelector(sel)!;
        // 上（要素）から下（根）へ集め、不透明に当たったら止める
        const layers: number[][] = [];
        for (let n: Element | null = el; n; n = n.parentElement) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c[3] > 0) layers.push(c);
            if (c[3] >= 1) break;
        }
        // 根まで不透明が無ければ、ブラウザの地（白）を敷く
        if (!layers.length || layers[layers.length - 1][3] < 1) layers.push([255, 255, 255, 1]);
        // 下から順に重ねる
        let g = layers[layers.length - 1].slice(0, 3);
        for (let i = layers.length - 2; i >= 0; i--) {
            const [r, gg, b, a] = layers[i];
            g = [r * a + g[0] * (1 - a), gg * a + g[1] * (1 - a), b * a + g[2] * (1 - a)];
        }
        // 疑似要素の不透明度（Firefox は ::placeholder を既定で 0.54 で描く）。色だけ見ると、実際より明るく測ってしまう
        const opacity = ps ? Number(getComputedStyle(el, ps).opacity) : 1;
        return { color: getComputedStyle(el, ps).color, opacity, ground: g as [number, number, number] };
    }, [selector, pseudo] as const);
}

/** WCAG のコントラスト比 */
function contrast(fg: number[], bg: number[]): number {
    const lum = (rgb: number[]): number => {
        const [r, g, b] = rgb.map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const rgb = (s: string): number[] => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

async function expectReadable(page: Page, selector: string, pseudo: string | null = null): Promise<number> {
    const p = await probe(page, selector, pseudo);
    // 不透明度のぶんだけ、文字の色を地に混ぜてから比べる
    const fg = rgb(p.color).map((v, i) => v * p.opacity + p.ground[i] * (1 - p.opacity));
    const ratio = contrast(fg, p.ground);
    expect(ratio, `${selector}${pseudo ?? ''}：文字 ${p.color}（不透明度 ${p.opacity}）・地 rgb(${p.ground.map(Math.round).join(', ')})`).toBeGreaterThanOrEqual(4.5);
    return ratio;
}

test('本文ページの「読み込み中」', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    // 読み込みが済むと隠れるので、出して測る（色は hidden と関係ない）
    await page.evaluate(() => { document.getElementById('loading')!.hidden = false; });
    await expectReadable(page, '#loading');
});

test('目次の「読み込み中」', async ({ page }) => {
    // story.json を返さずに止め、「読み込み中」を出したままにする
    await page.route('**/story.json', () => { /* 応答しない */ });
    await page.goto('/lirmena/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#episodes-area .loading-text')).toBeVisible();
    await expectReadable(page, '#episodes-area .loading-text');
});

test.describe('目次', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-chip').first()).toBeVisible();
    });

    test('いちばん下の版の表示', async ({ page }) => {
        await expectReadable(page, '#idx-foot-ver');
    });

    test('変更履歴の版種別スイッチ：選んでいないボタンも読め、選んでいるボタンとの差が残る', async ({ page }) => {
        const off = await expectReadable(page, '#content-changelog-filter button[aria-pressed="false"]');
        const on = await expectReadable(page, '#content-changelog-filter button[aria-pressed="true"]');
        expect(on).toBeGreaterThan(off + 3);
    });
});

test.describe('用語集ページ', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/lirmena/glossary.html');
        await expect(page.locator('#gl-list .gl-langs').first()).toBeVisible();
    });

    test('言語表記の行', async ({ page }) => {
        await expectReadable(page, '#gl-list .gl-langs');
    });

    test('検索欄の案内文', async ({ page }) => {
        await expectReadable(page, '#gl-search', '::placeholder');
    });
});

test.describe('資料シートの用語のタブ', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        await expect(page.locator('#main-container')).toBeVisible();
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: '用語', exact: true }).click();
        await expect(page.locator('#glossary-popup-list .gl-langs').first()).toBeVisible();
    });

    test('言語表記の行', async ({ page }) => {
        await expectReadable(page, '#glossary-popup-list .gl-langs');
    });

    test('検索欄の案内文', async ({ page }) => {
        await expectReadable(page, '#glossary-search', '::placeholder');
    });
});
