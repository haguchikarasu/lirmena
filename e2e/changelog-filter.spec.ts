/*
 * 更新履歴の版種別フィルタ E2E（要件 06-7「更新履歴エリア（コンテンツ）」・06-1「変更履歴エリア」）。
 * 実データの changelog を触らず page.route で fixture に差し替えて検証する。
 *
 * 版種別の判定 versionKind は core/changelog を目次（index.ts）とタイトルページ（title.ts）が共有する
 * （判定そのものは src/core/pure.test.ts が見る）。スイッチの markup だけは index.html と templates/title.html に
 * 複製が残るので、本 spec がその**同期検査を兼ねる**（design/modules/index.md の複製表）。
 *
 * JSON の形はページで違う（目次＝ep/sha が配列、ep 別＝sha が文字列）ので fixture は 2 形。版の並びは共通。
 *
 * 検証観点：
 *   1. 目次：初期表示はメジャー＋マイナーのみ・初期 3 件は絞り込み後に数える・「すべて表示」で残りが出る
 *   2. 目次：パッチを ON にすると出る／全 OFF で空表示が出てトグルボタンが消える
 *   3. タイトル：初期表示はパッチを隠す・パッチ ON で全件
 *   4. タイトル：パッチだけの ep は空表示（スイッチは出る）／履歴なしの ep は「更新履歴なし」でスイッチを出さない
 *   5. 両ページのスイッチの markup の一致
 *   6. 両ページ：スイッチは名前つきのまとまりの中のチェックボックス・Space で切り替わる・押せる範囲と輪郭線は札の形・
 *      再読み込みで初期値に戻る（ブラウザがチェックを戻しても。Firefox は再読み込みでフォームの状態を戻す）
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
        await expect(filter.getByRole('checkbox', { name: '物語の変更' })).toBeChecked();
        await expect(filter.getByRole('checkbox', { name: '表現の調整' })).toBeChecked();
        await expect(filter.getByRole('checkbox', { name: '誤字など' })).not.toBeChecked();

        expect(await visibleTocVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.0']);

        const toggle = page.locator('#content-changelog-toggle');
        await expect(toggle).toBeVisible();
        // 件数は絞り込み後の全件（メジャー 1＋マイナー 3）
        await expect(toggle).toHaveText('すべて表示（4 件）');
        await toggle.click();
        expect(await visibleTocVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.0', 'v1.1.0']);
        await expect(toggle).toHaveText('閉じる');
        await expect(page.locator('#content-changelog-empty')).toBeHidden();
    });

    test('展開状態はフィルタを切り替えても保たれ、「閉じる」で絞り込み後の先頭 3 件に戻る', async ({ page }) => {
        const toggle = page.locator('#content-changelog-toggle');
        await toggle.click();
        await page.locator('#content-changelog-filter input[value="patch"]').click();
        expect(await visibleTocVersions(page)).toEqual(VERSIONS.map(([v]) => `v${v}`));
        await expect(toggle).toHaveText('閉じる');

        await toggle.click();
        expect(await visibleTocVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.1']);
        await expect(toggle).toHaveText(`すべて表示（${VERSIONS.length} 件）`);
    });

    test('パッチを ON にすると出る／全 OFF で空表示が出てトグルが消える', async ({ page }) => {
        const filter = page.locator('#content-changelog-filter');
        await filter.locator('input[value="patch"]').click();
        await expect(filter.getByRole('checkbox', { name: '誤字など' })).toBeChecked();
        expect(await visibleTocVersions(page)).toEqual(['v2.0.0', 'v1.3.0', 'v1.2.1']);

        await filter.locator('input[value="major"]').click();
        await filter.locator('input[value="minor"]').click();
        await filter.locator('input[value="patch"]').click();
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
        await page.locator('#title-screen-changelog-filter input[value="patch"]').click();
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

test('版種別スイッチの markup が目次とタイトルページで一致する（複製の同期検査）', async ({ page }) => {
    // スイッチは履歴があるときだけ出るので、両ページに同じ版の並びを流してから読む
    await mockJson(page, '**/changelog/content-changelog.json', CONTENT_FIXTURE);
    await mockJson(page, '**/changelog/ep01-changelog.json', EP_FIXTURE);
    // 見出し（legend）と、チェックボックスの並び・name・value・札の文字・HTML に書いた初期の checked
    const readSwitch = (sel: string) => page.locator(sel).evaluate(f => [
        f.querySelector('legend')?.textContent ?? '',
        ...[...f.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(b =>
            [b.name, b.value, b.closest('label')?.textContent ?? '', String(b.defaultChecked)].join('|')),
    ]);

    await page.goto('/lirmena/contents/01-00.html');
    await expect(page.locator('#title-screen-changelog-list .changelog-entry')).toHaveCount(VERSIONS.length);
    const titleSwitch = await readSwitch('#title-screen-changelog-filter');

    await page.goto('/lirmena/');
    await expect(page.locator('#content-changelog-list li.cl-entry')).toHaveCount(VERSIONS.length);
    const tocSwitch = await readSwitch('#content-changelog-filter');

    expect(tocSwitch).toHaveLength(4);   // 見出し＋3 つ（両方空で一致、を通さない）
    expect(titleSwitch).toEqual(tocSwitch);
});

// 目次とタイトルページで同じ作り（札の中のチェックボックス）。実ブラウザでしか決まらないことを両方で見る
for (const [label, url, sel, ready] of [
    ['目次', '/lirmena/', '#content-changelog-filter', '#content-changelog-list li.cl-entry'],
    ['タイトルページ', '/lirmena/contents/01-00.html', '#title-screen-changelog-filter', '#title-screen-changelog-list .changelog-entry'],
] as const) {
    test.describe(`${label}：版種別スイッチはチェックボックス`, () => {
        test.beforeEach(async ({ page }) => {
            await mockJson(page, '**/changelog/content-changelog.json', CONTENT_FIXTURE);
            await mockJson(page, '**/changelog/ep01-changelog.json', EP_FIXTURE);
            await page.goto(url);
            await expect(page.locator(ready)).toHaveCount(VERSIONS.length);
        });

        test('名前つきのまとまりの中に 3 つ。見出しは画面に出ない', async ({ page }) => {
            const group = page.getByRole('group', { name: '表示する変更の種類', exact: true });
            await expect(group.getByRole('checkbox')).toHaveCount(3);
            const legend = await page.locator(`${sel} legend`).boundingBox();
            expect(legend!.width).toBeLessThanOrEqual(1);
            expect(legend!.height).toBeLessThanOrEqual(1);
        });

        test('チェックボックスの箱は札と同じ大きさ（押せる範囲と輪郭線が札の形になる）', async ({ page }) => {
            const gaps = await page.locator(`${sel} label`).evaluateAll(ls => ls.map(l => {
                const a = l.getBoundingClientRect(), b = l.querySelector('input')!.getBoundingClientRect();
                return Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
            }));
            expect(gaps).toHaveLength(3);
            for (const g of gaps) expect(g).toBeLessThan(0.5);
            // 札の左端を押しても切り替わる（目次の札は角が丸いので、角でなく左端の縦の中央を押す）
            const tag = page.locator(`${sel} label`, { hasText: '誤字など' });
            await tag.click({ position: { x: 3, y: (await tag.boundingBox())!.height / 2 } });
            await expect(page.locator(`${sel} input[value="patch"]`)).toBeChecked();
        });

        test('Tab で 3 つに順に止まり、Space で切り替わる。キーボードでは輪郭線が出る', async ({ page }) => {
            const box = (v: string) => page.locator(`${sel} input[value="${v}"]`);
            await box('major').focus();
            await page.keyboard.press('Tab');
            await expect(box('minor')).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(box('patch')).toBeFocused();
            expect(await box('patch').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
            await page.keyboard.press('Space');
            await expect(box('patch')).toBeChecked();
            await expect(page.locator(`${ready}:visible`)).toHaveCount(label === '目次' ? 3 : VERSIONS.length);
            await page.keyboard.press('Space');
            await expect(box('patch')).not.toBeChecked();
        });

        test('再読み込みすると初期値に戻る（選択は保存しない）', async ({ page }) => {
            await page.locator(`${sel} input[value="patch"]`).click();
            await page.locator(`${sel} input[value="major"]`).click();
            await page.reload();
            await expect(page.locator(ready)).toHaveCount(VERSIONS.length);
            await expect(page.locator(`${sel} input[value="major"]`)).toBeChecked();
            await expect(page.locator(`${sel} input[value="minor"]`)).toBeChecked();
            await expect(page.locator(`${sel} input[value="patch"]`)).not.toBeChecked();
        });
    });
}
