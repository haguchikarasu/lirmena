/*
 * 目次の E2E（要件 06-7）：読み始めるボタン・上の帯・右カラムの「最新」・節のチップの状態・設定の見本。
 * ヒーローの絵と表紙ギャラリーは toc-hero.spec.ts、予告・巻カードの開閉は toc-preview.spec.ts、変更履歴は
 * changelog-filter.spec.ts、消去は clear-buttons.spec.ts、世界のタイルは characters-popup.spec.ts が見る。
 *
 * story.json は page.route で fixture に差し替える（読者の記録と組み合わせて状態を作り分けるため）。
 * 見るのは「どの状態でどの文字・行き先・印になるか」で、寸法・色は手動スモークに残す。
 */

import { test, expect } from './_fixtures';
import type { Page, Route } from '@playwright/test';

// 1 巻・2 話。最新の公開済みの節は 02-01。02-02 は未公開で、遠い先の公開予定を持つ（次回の更新に出る）
const FIXTURE_STORY = [
    {
        volume: 1,
        epRange: [1, 2],
        afterword: { published: false },
        episodes: [
            { id: 1, title: '|太陽《たいよう》の行く先', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
            { id: 2, title: '第二の話', sections: [{ id: 1, published: true }, { id: 2, published: false, scheduledAt: '2099-01-01T20:00+09:00' }] },
        ],
    },
];

async function setup(page: Page, items: Record<string, string> = {}, story: unknown = FIXTURE_STORY): Promise<void> {
    await page.addInitScript((kv) => {
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, { schemaVersion: '5', ...items });
    await page.route('**/story.json', (route: Route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(story) });
    });
}

const cta = (page: Page) => page.locator('#idx-cta-btn');
const sub = (page: Page) => page.locator('#idx-cta-sub');

test.describe('読み始めるボタン（ヒーロー）', () => {
    test('初めて：「第一話から読む」で最初の節の扉へ。下の行は空', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
        await expect(cta(page)).toHaveText('第一話から読む');
        await expect(cta(page)).toHaveAttribute('href', 'contents/01-00.html');
        await expect(sub(page)).toHaveText('');
        await expect(page.locator('body')).toHaveAttribute('data-reader', 'first');
    });

    test('途中：「続きから読む」・下にオートセーブの位置。押すと pendingJump を書いてその節へ', async ({ page }) => {
        await setup(page, { autosave: JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }) });
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
        await expect(cta(page)).toHaveText('続きから読む');
        await expect(sub(page)).toHaveText('第1話#2');
        await expect(page.locator('body')).toHaveAttribute('data-reader', 'mid');

        await cta(page).click();
        await expect(page).toHaveURL(/\/lirmena\/contents\/01-02\.html$/);
    });

    test('最新まで読了：「第N話#M を読み返す」・下に次回の更新（日本時間）', async ({ page }) => {
        await setup(page, {
            read: JSON.stringify(['01-01', '01-02', '02-01']),
            autosave: JSON.stringify({ ep: 2, sec: 1, ratio: 1, savedAt: 100 }),
        });
        await page.goto('/lirmena/');
        // 1 巻だけの fixture で最新まで読了＝物語完結の stage なので、巻カードは閉じている
        await expect(page.locator('#episodes-area .idx-vol-card').first()).toBeVisible();
        await expect(cta(page)).toHaveText('第2話#1 を読み返す');
        await expect(cta(page)).toHaveAttribute('href', 'contents/02-00.html');
        await expect(sub(page).locator('time')).toHaveText('1/1（木）20:00');
        await expect(page.locator('body')).toHaveAttribute('data-reader', 'caught');
    });

    test('?dev はボタンの行き先にも引き継ぐ', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/?dev');
        await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
        await expect(cta(page)).toHaveAttribute('href', 'contents/01-00.html?dev');
    });
});

test.describe('上の帯（FAB の代わり）', () => {
    test('FAB は無い。ヒーローを過ぎると帯になり、「▶ 第N話#M」が読み始めるボタンと同じ行き先で出る', async ({ page }) => {
        await setup(page, { autosave: JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }) });
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
        await expect(page.locator('#fab-toggle')).toHaveCount(0);

        const resume = page.locator('#idx-topbar-resume');
        await expect(resume).toHaveText('第1話#2');
        await expect(resume).toHaveAttribute('href', 'contents/01-02.html');
        await expect(page.locator('body')).not.toHaveAttribute('data-past-hero', 'true');
        await page.locator('#idx-links').scrollIntoViewIfNeeded();
        await expect(page.locator('body')).toHaveAttribute('data-past-hero', 'true');
        await expect(resume).toBeVisible();
    });

    test('共有は上の帯から開く', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/');
        await page.locator('#idx-btn-share').click();
        await expect(page.locator('#share-popup')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#share-popup')).toBeHidden();
        await expect(page.locator('#idx-btn-share')).toBeFocused();
    });

    test('ヒーローの上では、透明なタイトルと「▶」に Tab で止まらない（過ぎると止まる）', async ({ page }) => {
        await setup(page, { autosave: JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }) });
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
        for (const id of ['#idx-topbar-mark', '#idx-topbar-resume']) {
            await expect(page.locator(id)).toHaveCSS('visibility', 'hidden');
        }
        await page.locator('#idx-links').scrollIntoViewIfNeeded();
        await expect(page.locator('#idx-topbar-resume')).toHaveCSS('visibility', 'visible');
    });
});

test.describe('右カラム・足もと', () => {
    test('最新：最後に公開した節と次回の更新。押すとその節へ', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/');
        const news = page.locator('#idx-news');
        await expect(news).toBeVisible();
        await expect(page.locator('#idx-news-pos')).toHaveText('第2話#1');
        await expect(page.locator('#idx-news-title')).toHaveText('第二の話');
        await expect(page.locator('#idx-news-next time')).toHaveText('1/1（木）20:00');
        await expect(news).toHaveAttribute('href', 'contents/02-00.html');
    });

    test('予定が残っていなければ次回の更新は出さない', async ({ page }) => {
        const story = structuredClone(FIXTURE_STORY);
        delete (story[0].episodes[1].sections[1] as { scheduledAt?: string }).scheduledAt;
        await setup(page, {}, story);
        await page.goto('/lirmena/');
        await expect(page.locator('#idx-news-pos')).toHaveText('第2話#1');
        await expect(page.locator('#idx-news-next')).toBeHidden();
    });

    test('足もとに本文とサイトの版だけを出す（開発モードの印は上の帯の札だけ）', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/');
        // テストのホストは本番ではない（127.0.0.1）＝ data-dev が付くが、足もとには何も足さない
        await expect(page.locator('#idx-foot-ver')).toHaveText(/^本文 v\d+\.\d+\.\d+ ・ サイト v\d+\.\d+\.\d+$/);
    });

    test('最新の扉絵が見つからないときは、壊れた画像の印を出さず絵の列ごと畳む', async ({ page }) => {
        await setup(page);
        await page.route('**/vol01/ep02/title.avif', (route) => route.fulfill({ status: 404, body: '' }));
        await page.goto('/lirmena/');
        await expect(page.locator('#idx-news')).toHaveClass(/idx-news--nocover/);
        await expect(page.locator('#idx-news-cover')).toBeHidden();
    });

    test('栞の行を × で消したあと、フォーカスは残った行の × に移る（ページの外へ落ちない）', async ({ page }) => {
        await setup(page, {
            autosave: JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }),
            bookmarks: JSON.stringify([{ slot: 1, ep: 1, sec: 1, scene: 1, ratio: 0.3, savedAt: 100 }]),
        });
        await page.goto('/lirmena/');
        await page.getByRole('button', { name: 'オートセーブを消す' }).click();
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        await expect(page.getByRole('button', { name: '栞 1を消す' })).toBeFocused();

        await page.getByRole('button', { name: '栞 1を消す' }).click();
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        // 消せる行が残っていなければ栞の見出しへ
        await expect(page.locator('#idx-bm-label')).toBeFocused();
        await expect(page.locator('#bookmark-slots .idx-bm-slot--empty').first()).toContainText('空き');
    });
});

test.describe('節のチップの状態（B 案）', () => {
    test('到達・読了・オートセーブの位置が class と読み上げの名前に出る', async ({ page }) => {
        await setup(page, {
            reached: JSON.stringify(['01-01', '01-02']),
            read: JSON.stringify(['01-01']),
            autosave: JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }),
        });
        await page.goto('/lirmena/');
        const chips = page.locator('.idx-ep').first().locator('a.idx-chip');
        await expect(chips.nth(0)).toHaveClass(/idx-chip--read/);
        await expect(chips.nth(0)).toHaveAttribute('aria-label', '01 読破');
        await expect(chips.nth(1)).toHaveClass(/idx-chip--here/);
        await expect(chips.nth(1)).not.toHaveClass(/idx-chip--read/);
        await expect(chips.nth(1)).toHaveAttribute('aria-label', '02 既読 続きから');
        // 未到達のチップは名前を足さない（数字だけ）
        await expect(page.locator('.idx-ep').nth(1).locator('a.idx-chip').first()).not.toHaveAttribute('aria-label', /.+/);
    });

    test('話のバナーには扉絵（タイトルページと同じ絵）を敷く', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/');
        await expect(page.locator('.idx-ep').first().locator('.idx-ep-cover')).toHaveAttribute('src', /\/vol01\/ep01\/title\.avif$/);
    });
});

test.describe('設定シート（上の帯の ⚙）', () => {
    test('PC：開いている間ページ全体を本文の見本にし、選んだ設定が見本に写る。閉じると見本も消える', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await setup(page);
        await page.goto('/lirmena/');
        const preview = page.locator('#idx-preview');
        await expect(preview).toBeHidden();
        await page.locator('#idx-btn-settings').click();
        await expect(page.locator('#settings-popup')).toBeVisible();
        await expect(preview).toBeVisible();
        const text = page.locator('#idx-preview-text');
        await expect(text).toHaveAttribute('data-writing-mode', 'horizontal');
        await page.locator('#settings-popup .settings-opt[data-key="writingMode"][data-value="vertical"]').click();
        await expect(text).toHaveAttribute('data-writing-mode', 'vertical');
        // 目次そのものは縦書きにならない（保存だけ）
        await expect(page.locator('html')).toHaveAttribute('data-writing-mode', 'horizontal');

        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-popup')).toBeHidden();
        await expect(preview).toBeHidden();
    });

    test('スマホ：見本は出さず、シートを全画面で開く', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 800 });
        await setup(page);
        await page.goto('/lirmena/');
        await page.locator('#idx-btn-settings').click();
        await expect(page.locator('#settings-popup')).toHaveAttribute('data-detent', 'full');
        await expect(page.locator('#idx-preview')).toBeHidden();
    });
});
