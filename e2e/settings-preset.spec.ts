/*
 * 骨格 E2E：表示設定のプリセット（要件 06-4）。
 * プリセットの定義は本文ページ（settings.ts の PRESETS）と目次ページ（index.ts の PRESETS）に
 * **複製**されている（index.ts は settings.ts を import できない＝.dependency-cruiser.cjs の
 * index-src-isolation）。この spec が複製の同期を機械で見張る役目を持つ。
 * 見ているのは 1) カードの表示文字列 2) 押した後の localStorage の値マップ 3) CSS の書き忘れ。
 * 特に 2) が本命で、表示名だけ揃っていて値が違う（＝「書籍風」が両ページで別物）状態を検出する。
 *
 * _fixtures を使う理由：Task 3 以降は本文ページで初回ダイアログが自動表示され、同じ「ウェブ小説風」
 * 「書籍風」のボタンを持つオーバーレイがメニューのクリックを阻害する。fixture が presetAsked を
 * 先付けして黙らせる（初回導線そのものは firstrun.spec.ts が fixture を使わずに見る）。
 */

import type { Page } from '@playwright/test';
import { test, expect } from './_fixtures';

const EXPECTED_PRESETS = [
    {
        name: 'ウェブ小説風',
        desc: '横書き・空行あり / ゴシック体',
        values: {
            'lirmena.writingMode': 'horizontal',
            'lirmena.lineGap': 'on',
            'lirmena.fontFamily': 'sans',
            'lirmena.fontSize': 'medium',
            'lirmena.fontWeight': 'normal',
        },
    },
    {
        name: '書籍風',
        desc: '縦書き・字下げ / 明朝体',
        values: {
            'lirmena.writingMode': 'vertical',
            'lirmena.lineGap': 'off',
            'lirmena.fontFamily': 'serif',
            'lirmena.fontSize': 'medium',
            'lirmena.fontWeight': 'normal',
        },
    },
] as const;

const KEYS = Object.keys(EXPECTED_PRESETS[0].values);

async function openReaderSettings(page: Page): Promise<void> {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
}

async function openTocSettings(page: Page): Promise<void> {
    await page.goto('/lirmena/');
    await page.locator('#fab-toggle').click();
    await page.getByRole('menuitem', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
}

const PAGES = [
    { label: '本文ページ', open: openReaderSettings },
    { label: '目次ページ', open: openTocSettings },
] as const;

for (const { label, open } of PAGES) {
    test(`${label}のプリセットが要件どおりの名前と内訳で並ぶ`, async ({ page }) => {
        await open(page);
        const panel = page.locator('#settings-popup');
        expect(await panel.locator('.settings-preset__name').allTextContents())
            .toEqual(EXPECTED_PRESETS.map((p) => p.name));
        expect(await panel.locator('.settings-preset__desc').allTextContents())
            .toEqual(EXPECTED_PRESETS.map((p) => p.desc));
    });

    // 二重定義の CSS（_ui.css / toc.css）は片方だけ書くと片側が無スタイルになる。
    // その場合 section の既定 display（block）になるのでここで落ちる。
    test(`${label}のプリセットカードにスタイルが当たっている`, async ({ page }) => {
        await open(page);
        const display = await page.locator('#settings-popup .settings-preset')
            .evaluate((el) => getComputedStyle(el).display);
        expect(display).toBe('flex');
    });

    for (const preset of EXPECTED_PRESETS) {
        test(`${label}で「${preset.name}」を押すと5項目が同じ値で保存される`, async ({ page }) => {
            await open(page);
            await page.locator('#settings-popup').getByRole('button', { name: preset.name }).click();
            const stored = await page.evaluate(
                (keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])),
                KEYS,
            );
            expect(stored).toEqual(preset.values);
        });
    }

    // 目次側の buildRow のクリックは自分の行しか更新しないので、複数キーを一括で変えたあとに
    // refreshRows() を呼び忘れると5行が古い選択のまま残る。本文側は _refreshOpts() が同じ役目。
    test(`${label}で書籍風を押すと表示設定5行の選択も追従する`, async ({ page }) => {
        await open(page);
        await page.locator('#settings-popup').getByRole('button', { name: '書籍風' }).click();
        const active = await page.locator('#settings-popup .settings-row').evaluateAll(
            (rows) => rows.map((r) => r.querySelector('.settings-opt.active')?.textContent ?? null),
        );
        expect(active).toEqual(['縦書き', 'なし', '明朝体', '中', '通常']);
    });

    test(`${label}で選んだカードだけが押下状態になる`, async ({ page }) => {
        await open(page);
        await page.locator('#settings-popup').getByRole('button', { name: '書籍風' }).click();
        const pressed = await page.locator('#settings-popup .settings-preset__btn')
            .evaluateAll((btns) => btns.map((b) => b.getAttribute('aria-pressed')));
        expect(pressed).toEqual(['false', 'true']);
    });

    // 既定値はどちらのプリセットとも一致しない（＝リセット後はカスタム扱い）。
    test(`${label}で設定をリセットするとどちらのカードも選ばれていない`, async ({ page }) => {
        await open(page);
        await page.locator('#settings-popup').getByRole('button', { name: '書籍風' }).click();
        await page.locator('#settings-popup .settings-action', { hasText: '設定をリセット' }).click();
        await expect(page.locator('#settings-popup .settings-preset__btn.active')).toHaveCount(0);
    });
}

// 目次ページは CSS 変数へ反映しない（横書き・明朝固定）ので、実際の見え方は本文ページでのみ検査する。
test('本文ページで書籍風を押すと縦書きになり、段落が空行から字下げに変わる', async ({ page }) => {
    await openReaderSettings(page);
    await page.locator('#settings-popup').getByRole('button', { name: '書籍風' }).click();

    await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'vertical');

    // 字下げが効くのは renderer が .indent を付けた段落だけ（行頭が始め括弧類・全角スペースなら付かない・要件 05-4）。
    // 実値は calc(1em + var(--body-letter-spacing)) が px に解決されたものなので、リテラル比較はしない。
    const para = page.locator('#scene-content p.indent').first();
    await expect(para).toBeAttached();
    const style = await para.evaluate((el) => {
        const s = getComputedStyle(el);
        return { indent: s.textIndent, margin: s.marginBlockEnd };
    });
    expect(style.indent).not.toBe('0px');
    expect(style.margin).toBe('0px');
});
