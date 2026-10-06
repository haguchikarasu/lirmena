/*
 * 更新履歴の版種別フィルタ E2E（要件 06-7「更新履歴エリア（コンテンツ）」・06-1「変更履歴エリア」）。
 * 実データの changelog を触らず page.route で fixture に差し替えて検証する。
 *
 * 目次（index.ts）と ep タイトルページ（title.ts）は版種別の判定 versionKind とスイッチの markup を
 * それぞれ inline 複製で持つ（目次の独立方針）。本 spec はその**同期検査を兼ねる**：同じ版の並びを
 * 両ページに流し、全行の (version, data-kind) が一致することを見る（design/modules/index.md の複製表）。
 *
 * JSON の形はページで違う（目次＝ep/sha が配列、ep 別＝sha が文字列）ので fixture は 2 形。版の並びは共通。
 *
 * 検証観点：
 *   1. 目次：初期表示はメジャー＋マイナーのみ・初期 3 件は絞り込み後に数える・「すべて表示」で残りが出る
 *   2. 目次：パッチを ON にすると出る／全 OFF で空表示が出てトグルボタンが消える
 *   3. タイトル：初期表示はパッチを隠す・パッチ ON で全件
 *   4. タイトル：パッチだけの ep は空表示（スイッチは出る）／履歴なしの ep は「更新履歴なし」でスイッチを出さない
 *   5. 両ページの版種別判定の一致
 */

import { test, expect } from './_fixtures';
import type { Page, Route } from '@playwright/test';

// 版の並び（新しい順）と期待する種別。メジャー 1・マイナー 3・パッチ 3。
const VERSIONS: [string, 'major' | 'minor' | 'patch'][] = [
    ['2.0.0', 'major'],
    ['1.3.0', 'minor'],
    ['1.2.1', 'patch'],
    ['1.2.0', 'minor'],
    ['1.1.1', 'patch'],
    ['1.1.0', 'minor'],
    ['1.0.1', 'patch'],
];

const CONTENT_FIXTURE = VERSIONS.map(([version]) => ({
    version, date: '2026/01/01', change: `変更 ${version}`, ep: [1], sha: ['abcdef1'],
}));
const EP_FIXTURE = VERSIONS.map(([version]) => ({
    version, date: '2026/01/01', change: `変更 ${version}`, sha: 'abcdef1',
}));
const EP_PATCH_ONLY = EP_FIXTURE.filter((_, i) => VERSIONS[i][1] === 'patch');

async function mockJson(page: Page, pattern: string, body: unknown): Promise<void> {
    await page.route(pattern, (route: Route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
}

/** 目次の表示中の版（"vX.Y.Z"）を上から順に返す */
async function visibleTocVersions(page: Page): Promise<string[]> {
    return page.locator('#content-changelog-list li.cl-entry:visible .cl-version').allTextContents();
}

/** タイトルページの表示中の版を上から順に返す */
async function visibleTitleVersions(page: Page): Promise<string[]> {
    return page.locator('#title-screen-changelog-list .changelog-entry:visible .changelog-version a').allTextContents();
}

test.describe('目次 コンテンツ更新履歴の版種別フィルタ', () => {
    test.beforeEach(async ({ page }) => {
        await mockJson(page, '**/changelog/content-changelog.json', CONTENT_FIXTURE);
        await page.goto('/lirmena/');
        await expect(page.locator('#content-changelog-list li.cl-entry')).toHaveCount(VERSIONS.length);
    });

    test('初期表示はメジャー＋マイナーのみ・初期 3 件は絞り込み後に数える', async ({ page }) => {
        const filter = page.locator('#content-changelog-filter');
        await expect(filter.locator('[data-kind="major"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(filter.locator('[data-kind="minor"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(filter.locator('[data-kind="patch"]')).toHaveAttribute('aria-pressed', 'false');

        expect(await visibleTocVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.0']);

        const toggle = page.locator('#content-changelog-toggle');
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveText('すべて表示');
        await toggle.click();
        expect(await visibleTocVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.0', 'v1.1.0']);
        await expect(toggle).toHaveText('閉じる');
        await expect(page.locator('#content-changelog-empty')).toBeHidden();
    });

    test('展開状態はフィルタを切り替えても保たれ、「閉じる」で絞り込み後の先頭 3 件に戻る', async ({ page }) => {
        const toggle = page.locator('#content-changelog-toggle');
        await toggle.click();
        await page.locator('#content-changelog-filter [data-kind="patch"]').click();
        expect(await visibleTocVersions(page)).toEqual(VERSIONS.map(([v]) => `v${v}`));
        await expect(toggle).toHaveText('閉じる');

        await toggle.click();
        expect(await visibleTocVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.1']);
        await expect(toggle).toHaveText('すべて表示');
    });

    test('パッチを ON にすると出る／全 OFF で空表示が出てトグルが消える', async ({ page }) => {
        const filter = page.locator('#content-changelog-filter');
        await filter.locator('[data-kind="patch"]').click();
        await expect(filter.locator('[data-kind="patch"]')).toHaveAttribute('aria-pressed', 'true');
        expect(await visibleTocVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.1']);

        await filter.locator('[data-kind="major"]').click();
        await filter.locator('[data-kind="minor"]').click();
        await filter.locator('[data-kind="patch"]').click();
        expect(await visibleTocVersions(page)).toEqual([]);
        await expect(page.locator('#content-changelog-empty')).toBeVisible();
        await expect(page.locator('#content-changelog-toggle')).toBeHidden();
    });
});

test.describe('ep タイトルページ 変更履歴の版種別フィルタ', () => {
    test('初期表示はパッチを隠し、パッチ ON で全件', async ({ page }) => {
        await mockJson(page, '**/changelog/ep01-changelog.json', EP_FIXTURE);
        await page.goto('/lirmena/contents/01-00.html');
        await expect(page.locator('#title-screen-changelog-head')).toBeVisible();

        expect(await visibleTitleVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.0', 'v1.1.0']);
        await page.locator('#title-screen-changelog-filter [data-kind="patch"]').click();
        expect(await visibleTitleVersions(page)).toEqual(VERSIONS.map(([v]) => `v${v}`));
        await expect(page.locator('#title-screen-changelog-empty')).toBeHidden();
    });

    test('パッチだけの ep は空表示（スイッチは出る）', async ({ page }) => {
        await mockJson(page, '**/changelog/ep01-changelog.json', EP_PATCH_ONLY);
        await page.goto('/lirmena/contents/01-00.html');
        await expect(page.locator('#title-screen-changelog-head')).toBeVisible();

        expect(await visibleTitleVersions(page)).toEqual([]);
        await expect(page.locator('#title-screen-changelog-empty')).toBeVisible();
    });

    test('履歴なしの ep は「更新履歴なし」でスイッチを出さない', async ({ page }) => {
        await mockJson(page, '**/changelog/ep01-changelog.json', []);
        await page.goto('/lirmena/contents/01-00.html');
        await expect(page.locator('#title-screen-changelog-list')).toHaveText('更新履歴なし');
        await expect(page.locator('#title-screen-changelog-head')).toBeHidden();
        await expect(page.locator('#title-screen-changelog-empty')).toBeHidden();
    });
});

test('目次とタイトルページの版種別判定が一致する（inline 複製の同期検査）', async ({ page }) => {
    const expected = VERSIONS.map(([v, kind]) => [`v${v}`, kind]);

    await mockJson(page, '**/changelog/content-changelog.json', CONTENT_FIXTURE);
    await page.goto('/lirmena/');
    await expect(page.locator('#content-changelog-list li.cl-entry')).toHaveCount(VERSIONS.length);
    // 折りたたみで hidden の行もあるので、可視性ではなく data-kind 属性で全行を集める
    const toc = await page.locator('#content-changelog-list li.cl-entry').evaluateAll(lis =>
        lis.map(li => [li.querySelector('.cl-version')?.textContent ?? '', (li as HTMLElement).dataset.kind ?? '']));

    await mockJson(page, '**/changelog/ep01-changelog.json', EP_FIXTURE);
    await page.goto('/lirmena/contents/01-00.html');
    await expect(page.locator('#title-screen-changelog-list .changelog-entry')).toHaveCount(VERSIONS.length);
    const title = await page.locator('#title-screen-changelog-list .changelog-entry').evaluateAll(rows =>
        rows.map(row => [row.querySelector('.changelog-version a')?.textContent ?? '', (row as HTMLElement).dataset.kind ?? '']));

    expect(toc).toEqual(expected);
    expect(title).toEqual(expected);

    // スイッチの markup（ボタンの並び・表示文字列・初期 aria-pressed）も両ページで一致する
    const readSwitch = (sel: string) => page.locator(`${sel} button[data-kind]`).evaluateAll(bs =>
        bs.map(b => [(b as HTMLElement).dataset.kind ?? '', b.textContent ?? '', b.getAttribute('aria-pressed') ?? '']));
    const titleSwitch = await readSwitch('#title-screen-changelog-filter');
    await page.goto('/lirmena/');
    const tocSwitch = await readSwitch('#content-changelog-filter');
    expect(titleSwitch).toEqual(tocSwitch);
});
