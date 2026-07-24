/*
 * 目次ページの予告表示 E2E（要件 06-7「予告 vol」「予告 ep」・vol.preview / ep.preview）。
 * 実データの story.json を触らず page.route で `/lirmena/story.json` を fixture に差し替えて検証する
 * （実データ回帰は他 spec が担当）。
 *
 * 検証観点：
 *   1. vol.preview を持つ vol は summary のみのカードとして表示され、pill が予告テキストになる
 *      （<details> ではなく <section class="idx-vol-card--notice">・chev は視覚的に非表示・body なし）
 *   2. ep.preview を持つ ep（公開 sec ゼロ）は sec chip を持たず .idx-ep-notice を持つ
 *   3. どちらも持たない未着手 vol はカードごと非表示（既存挙動維持）
 */

import { test, expect } from './_fixtures';
import type { Route } from '@playwright/test';

// テスト用 story.json fixture。vol1=通常公開 vol、vol2=vol.preview を持つ予告 vol、
// vol3=最終 vol（heroCardCompleted 必須）で ep8 だけ ep.preview を持ち残りは未着手。
// story-integrity の (a)〜(l) を全部満たす（未執筆 ep は末尾から欠落＝(a) OK、preview 整合も OK）。
const FIXTURE_STORY = [
    {
        volume: 1,
        epRange: [1, 4],
        heroCard: { file: 'vol01.avif' },
        afterword: { published: false },
        episodes: [
            {
                id: 1,
                title: '太陽の行く先',
                sections: [
                    { id: 1, published: true },
                    { id: 2, published: true },
                ],
            },
        ],
    },
    {
        volume: 2,
        epRange: [5, 7],
        heroCard: { file: 'vol02.avif' },
        afterword: { published: false },
        preview: { text: '2026年11月ごろ開始予定' },
        episodes: [],
    },
    {
        volume: 3,
        epRange: [8, 10],
        heroCard: { file: 'vol03.avif' },
        heroCardCompleted: { file: 'vol03-fin.avif' },
        afterword: { published: false },
        episodes: [
            {
                id: 8,
                title: '予告タイトル',
                preview: { text: '2026/7/31 より順次投稿予定' },
                sections: [{ id: 1, published: false }],
            },
        ],
    },
];

// 空 text preview を持つ fixture。「事前配置テンプレは preview 無しと同じ扱いで非表示」
// になることを検証するため、vol2 に空 vol.preview、vol3.ep8 に空 ep.preview を仕込む。
// どちらも目次には現れず、vol2 はカードごと非表示・vol3 も visibleEps ゼロで非表示になるはず。
const FIXTURE_STORY_EMPTY_PREVIEW = [
    {
        volume: 1,
        epRange: [1, 4],
        heroCard: { file: 'vol01.avif' },
        afterword: { published: false },
        episodes: [
            {
                id: 1,
                title: '太陽の行く先',
                sections: [{ id: 1, published: true }],
            },
        ],
    },
    {
        volume: 2,
        epRange: [5, 7],
        heroCard: { file: 'vol02.avif' },
        afterword: { published: false },
        preview: { text: '' },
        episodes: [],
    },
    {
        volume: 3,
        epRange: [8, 10],
        heroCard: { file: 'vol03.avif' },
        heroCardCompleted: { file: 'vol03-fin.avif' },
        afterword: { published: false },
        episodes: [
            {
                id: 8,
                title: '（未執筆）',
                preview: { text: '   ' },
                sections: [{ id: 1, published: false }],
            },
        ],
    },
];

// vol.preview / ep.preview を全く持たない fixture（未着手 vol の非表示回帰確認用）。
// vol2 は epRange 全域 未着手・preview 無し → カード自体が出ないことを検証する。
const FIXTURE_STORY_NO_PREVIEW = [
    {
        volume: 1,
        epRange: [1, 4],
        heroCard: { file: 'vol01.avif' },
        afterword: { published: false },
        episodes: [
            {
                id: 1,
                title: '太陽の行く先',
                sections: [{ id: 1, published: true }],
            },
        ],
    },
    {
        volume: 2,
        epRange: [5, 7],
        heroCard: { file: 'vol02.avif' },
        heroCardCompleted: { file: 'vol02-fin.avif' },
        afterword: { published: false },
        episodes: [],
    },
];

// story.json fetch を fixture に差し替えるヘルパ。goto 前に呼ぶ。
async function mockStoryJson(page: import('@playwright/test').Page, story: unknown): Promise<void> {
    await page.route('**/story.json', (route: Route) => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(story),
        });
    });
}

test.describe('目次ページ 予告表示（vol.preview / ep.preview）', () => {
    test('vol.preview を持つ vol は summary のみのカードで pill が予告テキストになる', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // 予告 vol は <section class="idx-vol-card idx-vol-card--notice">
        const noticeCard = page.locator('section.idx-vol-card--notice');
        await expect(noticeCard).toHaveCount(1);

        // ヘッダに vol 見出しと予告 pill が入っている
        await expect(noticeCard.locator('.idx-vol-k')).toHaveText('第2巻');
        const noticePill = noticeCard.locator('.idx-vol-pill--notice');
        await expect(noticePill).toHaveText('2026年11月ごろ開始予定');

        // body（詳細部）が生成されていない＝summary のみ
        await expect(noticeCard.locator('.idx-vol-body')).toHaveCount(0);

        // 予告 vol の中には ep ブロックも sec chip も無い
        await expect(noticeCard.locator('.idx-ep')).toHaveCount(0);
        await expect(noticeCard.locator('.idx-chip')).toHaveCount(0);
    });

    test('ep.preview を持つ ep は sec chip を持たず .idx-ep-notice を持つ', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // vol3（最終 vol）は details として出る（ep.preview があるので visibleEps.length > 0）
        // 予告 ep はカード内の details パスで描画される（<summary> ある通常カード内）
        const previewEp = page.locator('.idx-ep--preview');
        await expect(previewEp).toHaveCount(1);

        // ep タイトルは表示（applyRuby 経由）
        await expect(previewEp.locator('.idx-ep-title')).toContainText('第8話');
        await expect(previewEp.locator('.idx-ep-title')).toContainText('予告タイトル');

        // sec chip は無い（.idx-chip はゼロ）／代わりに .idx-ep-notice が1つ
        await expect(previewEp.locator('.idx-chip')).toHaveCount(0);
        const notice = previewEp.locator('.idx-ep-notice');
        await expect(notice).toHaveCount(1);
        await expect(notice).toHaveText('2026/7/31 より順次投稿予定');
    });

    test('preview を持たない未着手 vol はカードごと非表示（既存挙動維持）', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY_NO_PREVIEW);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // vol1 だけが表示される（第1巻の見出しが1つだけ）
        const volHeads = page.locator('.idx-vol-k');
        await expect(volHeads).toHaveCount(1);
        await expect(volHeads.first()).toHaveText('第1巻');
    });

    test('空 text preview は「preview 無し」扱いで vol/ep ともに非表示（事前配置テンプレ回帰）', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY_EMPTY_PREVIEW);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // 空 preview の vol2・vol3 はカードごと非表示、vol1 だけ出る
        const volHeads = page.locator('.idx-vol-k');
        await expect(volHeads).toHaveCount(1);
        await expect(volHeads.first()).toHaveText('第1巻');

        // 予告 vol/ep 用 DOM は一切生成されない（空 text は無扱い）
        await expect(page.locator('section.idx-vol-card--notice')).toHaveCount(0);
        await expect(page.locator('.idx-ep--preview')).toHaveCount(0);
        await expect(page.locator('.idx-ep-notice')).toHaveCount(0);
    });
});
