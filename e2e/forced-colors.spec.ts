/*
 * E2E：強制カラーモード（Windows のコントラスト テーマ。`forced-colors: active`）での選択状態の区別。
 * 強制カラーでは、作者の書いた色・影がシステム色に置き換わる。色と影だけで表していた「選んでいる」が消えないように、
 * `@media (forced-colors: active)` の中で、線の有無・太さか Highlight / HighlightText の反転で区別を付けている
 * （_sheet.css・world-page.css・toc-page.css）。ここでは、選んでいるものといないものの計算後のスタイルが違うことを見る。
 *
 * 「違う」の判定は、見て分かる違いに限る：
 *   - 背景色は不透明度 0.5 以上のときだけ数える（強制カラーでは背景の不透明度が残る＝薄い地はほぼ見えない）
 *   - 枠は幅・style・色を見る（幅 0 や style none は「線が無い」として 1 つにまとめる）
 * 寸法の相殺（選んでいるときだけ太い線でも外形を変えない）は見ない（見た目の変化は通常の表示の画素比較で確かめる）。
 */

import type { Page } from '@playwright/test';
import { test, expect } from './_fixtures';

// test.use({ forcedColors }) は文脈に届かない（Playwright の検査用の選択肢に無い）ので、文脈の選択肢として渡す
test.use({ contextOptions: { forcedColors: 'active' } });

/** 色の文字列（rgb() / rgba()）を [r, g, b, a] にする */
function rgba(s: string): [number, number, number, number] {
    const n = (s.match(/[\d.]+/g) ?? []).map(Number);
    return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
}

type Look = { bottom: string; top: string; bg: string; color: string };

/** 要素の見て分かるスタイルを要約する（下の枠・上の枠・不透明な背景色・文字色） */
async function lookOf(page: Page, selector: string): Promise<Look[]> {
    const raw = await page.locator(selector).evaluateAll((els) => els.map((el) => {
        const s = getComputedStyle(el);
        return {
            bottom: [s.borderBottomWidth, s.borderBottomStyle, s.borderBottomColor],
            top: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor],
            bg: s.backgroundColor,
            color: s.color,
        };
    }));
    const edge = ([w, st, c]: string[]): string => (w === '0px' || st === 'none' || st === 'hidden' ? 'none' : `${w} ${st} ${c}`);
    return raw.map((r) => ({
        bottom: edge(r.bottom),
        top: edge(r.top),
        bg: rgba(r.bg)[3] >= 0.5 ? r.bg : 'none',
        color: r.color,
    }));
}

async function expectDistinct(page: Page, selected: string, other: string): Promise<void> {
    const [a] = await lookOf(page, selected);
    const [b] = await lookOf(page, other);
    expect(a, `${selected} が見つからない`).toBeDefined();
    expect(b, `${other} が見つからない`).toBeDefined();
    expect(a, '選んでいるものと選んでいないものが同じ見た目').not.toEqual(b);
}

test('資料シートのタブ：選んでいるタブと選んでいないタブが区別できる', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '用語', exact: true }).click();
    await expect(page.locator('#world-sheet')).toBeVisible();
    await expectDistinct(page, '#world-sheet .sheet-tab[aria-selected="true"]', '#world-sheet .sheet-tab[aria-selected="false"]');
});

test('資料ページのタブ：いまのページのタブとほかのタブが区別できる', async ({ page }) => {
    await page.goto('/lirmena/map.html');
    await expect(page.locator('#wp-top')).toBeVisible();
    await expectDistinct(page, '.wp-tab[aria-current="page"]', '.wp-tab:not([aria-current])');
});

test.describe('設定シート', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/lirmena/');
        await page.locator('#idx-btn-settings').click();
        await expect(page.locator('#settings-popup')).toBeVisible();
        await page.locator('#settings-popup').getByRole('button', { name: '書籍風' }).click();
        await expect(page.locator('#settings-popup .settings-preset__btn.active')).toHaveCount(1);
    });

    test('プリセット：選んでいるカードと選んでいないカードが区別できる', async ({ page }) => {
        await expectDistinct(page, '#settings-popup .settings-preset__btn.active', '#settings-popup .settings-preset__btn:not(.active)');
        // 色の違いだけに頼らない（強制カラーではユーザーのテーマ次第で色の差が小さくなる）＝枠の太さか style が違う
        const [a] = await lookOf(page, '#settings-popup .settings-preset__btn.active');
        const [b] = await lookOf(page, '#settings-popup .settings-preset__btn:not(.active)');
        expect(a.top.split(' ').slice(0, 2)).not.toEqual(b.top.split(' ').slice(0, 2));
    });

    test('選択肢：選んでいるものと選んでいないものが区別できる', async ({ page }) => {
        const row = '#settings-popup .settings-row:first-child';
        await expectDistinct(page, `${row} .settings-opt:has(:checked)`, `${row} .settings-opt:not(:has(:checked))`);
    });
});

test('目次の話のチップ：既読の印の点が、チップの地と違う色で描かれる', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('schemaVersion', '5');
        localStorage.setItem('reached', JSON.stringify(['01-01']));
        localStorage.setItem('read', JSON.stringify(['01-01']));
    });
    await page.goto('/lirmena/');
    const chip = page.locator('.idx-chip--read').first();
    await expect(chip).toBeVisible();
    const paint = await chip.evaluate((el) => {
        const dot = getComputedStyle(el, '::after');
        return {
            content: dot.content,
            dotBg: dot.backgroundColor,
            dotBorder: [dot.borderTopWidth, dot.borderTopStyle, dot.borderTopColor],
            chipBg: getComputedStyle(el).backgroundColor,
        };
    });
    expect(paint.content).not.toBe('none');
    // 点を塗っている色：不透明な背景色か、線（幅のある枠）の色
    const [bw, bs, bc] = paint.dotBorder;
    const dotColor = rgba(paint.dotBg)[3] >= 0.5 ? paint.dotBg
        : (bw !== '0px' && bs !== 'none' ? bc : null);
    expect(dotColor, '点が塗られていない').not.toBeNull();
    // チップの地とは不透明度を除いた色で比べる（強制カラーではチップの地も点も同じシステム色になりうる）
    expect(rgba(dotColor!).slice(0, 3)).not.toEqual(rgba(paint.chipBg).slice(0, 3));
});

// 外へ出る・別タブで開く印は、形を mask、色を背景色で付けている（toc-page.css・_map.css）。強制カラーでは作者の背景色が
// 消されるので、システム色を指定していないと印ごと見えなくなる。ここでは印が不透明な色で塗られていることを見る
for (const [name, url, selector] of [
    ['目次の外部リンク', '/lirmena/', '#idx-links a'],
    ['地図の「原寸で開く」', '/lirmena/map.html', '.mv-open'],
] as const) {
    test(`${name}：外へ出る印が、強制カラーでも塗られている`, async ({ page }) => {
        await page.goto(url);
        const link = page.locator(selector).first();
        await expect(link).toBeVisible();
        const paint = await link.evaluate((el) => {
            const s = getComputedStyle(el, '::after');
            return { bg: s.backgroundColor, mask: s.maskImage, w: parseFloat(s.inlineSize) };
        });
        expect(paint.mask).toContain('data:image/svg+xml');
        expect(paint.w).toBeGreaterThan(6);
        expect(rgba(paint.bg)[3], `印の色が透けている：${paint.bg}`).toBeGreaterThanOrEqual(0.5);
    });
}
