/*
 * 骨格 E2E：目次ページの「設定をリセット」が消すキーの網羅（要件 06-4 / 06-7）。
 *
 * 目次側（index.ts の buildSettingsPopup）のリセットは localStorage キーを**手で列挙**して
 * removeItem する（本文側 settings.ts の Object.keys(DEFAULTS) 走査と違い自動追従しない）。
 * 設定行を足したときの追従漏れを検出できるのはここだけなので、5 項目を個別ではなくまとめて見る。
 *
 * 読書点（lirmena.readingAnchor）も対象に含める：目次に調整 UI は無いが「設定をリセット」は
 * グローバルな初期化であって表示設定だけの初期化ではない（要件 06-4）。本文側は setItem('45')、
 * 目次側は removeItem という非対称なので、**消えたあと本文ページで既定 45% に解決されるところまで**
 * 見て初めて「両者は読み手にとって同値」が担保される。
 *
 * src/index.ts は vitest の coverage 対象外（ops/local-checks.md）なので目次側の回帰はここに置く。
 */

import { test, expect } from './_fixtures';

// 表示設定5行が localStorage に持つキーと、既定と異なる値（リセットで消えたことを見るための seed）。
// 並びは要件 06-4 の設定項目表の順。行を足したらここにも足す。
const DISPLAY_KEYS = {
    'lirmena.writingMode': 'vertical',
    'lirmena.lineGap': 'off',
    'lirmena.fontFamily': 'sans',
    'lirmena.fontSize': 'large',
    'lirmena.fontWeight': 'bold',
} as const;

const READING_ANCHOR_KEY = 'lirmena.readingAnchor';
// リセット対象の全キー（表示設定5行＋読書点）と seed 値。
const SEED: Record<string, string> = { ...DISPLAY_KEYS, [READING_ANCHOR_KEY]: '70' };
const ALL_KEYS = Object.keys(SEED);

const openSettingsFromToc = async (page: import('@playwright/test').Page) => {
    await page.locator('#fab-toggle').click();
    await page.getByRole('menuitem', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
};

const readKeys = (page: import('@playwright/test').Page, keys: string[]) =>
    page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), keys);

test('目次の「設定をリセット」で表示設定5キーと読書点がすべて消える', async ({ page }) => {
    await page.addInitScript((seed) => {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }, SEED);

    await page.goto('/lirmena/');
    await openSettingsFromToc(page);

    // seed が効いていること（＝このあとの toBeNull が「元から無い」で通ってしまうのを防ぐ）
    expect(await readKeys(page, ALL_KEYS)).toEqual(Object.values(SEED));

    await page.locator('.settings-action', { hasText: '設定をリセット' }).click();

    expect(await readKeys(page, ALL_KEYS)).toEqual(ALL_KEYS.map(() => null));
});

test('目次でリセットした読書点は本文ページで既定 45% に解決される', async ({ page }) => {
    await page.goto('/lirmena/');
    // seed は addInitScript ではなく goto 後の evaluate で入れる：addInitScript は**遷移のたびに再実行される**ので、
    // このあとの本文ページへの goto でリセット済みの値が書き戻されてしまう（目次側に読書点の UI は無く、
    // 値はリセットをクリックする瞬間に存在していればよいのでこれで足りる）。
    await page.evaluate((key) => localStorage.setItem(key, '70'), READING_ANCHOR_KEY);

    await openSettingsFromToc(page);
    await page.locator('.settings-action', { hasText: '設定をリセット' }).click();
    expect(await readKeys(page, [READING_ANCHOR_KEY])).toEqual([null]);

    // 目次側は removeItem、本文側は setItem('45')。読み手（settings.ts の _loadReadingAnchor）が
    // null を既定へ倒すので、キーが無い状態でも --reading-anchor は 45% で解決される。
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();
    const anchor = await page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--reading-anchor'),
    );
    expect(anchor).toBe('45%');
});
