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
    test('初めて：「第1話から読む」で最初の節の扉へ。下の行は空', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
        await expect(cta(page)).toHaveText('第1話から読む');
        await expect(cta(page)).toHaveAttribute('href', 'contents/01-00.html');
        await expect(sub(page)).toHaveText('');
        await expect(page.locator('body')).toHaveAttribute('data-reader', 'first');
    });

    test('途中：「続きから読む」・下にオートセーブの位置。押すと pendingJump を書いてその節へ', async ({ page }) => {
        await setup(page, { autosave: JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }) });
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
        await expect(cta(page)).toHaveText('続きから読む');
        await expect(sub(page)).toHaveText('第1話 #2');
        await expect(page.locator('body')).toHaveAttribute('data-reader', 'mid');

        await cta(page).click();
        await expect(page).toHaveURL(/\/lirmena\/contents\/01-02\.html$/);
    });

    test('最新まで読了：「第N話 #M を読み返す」・下に次回の更新（日本時間）', async ({ page }) => {
        await setup(page, {
            read: JSON.stringify(['01-01', '01-02', '02-01']),
            autosave: JSON.stringify({ ep: 2, sec: 1, ratio: 1, savedAt: 100 }),
        });
        await page.goto('/lirmena/');
        // 1 巻だけの fixture で最新まで読了＝物語完結の stage なので、巻カードは閉じている
        await expect(page.locator('#episodes-area .idx-vol-card').first()).toBeVisible();
        await expect(cta(page)).toHaveText('第2話 #1 を読み返す');
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
    test('FAB は無い。ヒーローを過ぎると帯になり、「▶ 第N話 #M」が読み始めるボタンと同じ行き先で出る', async ({ page }) => {
        await setup(page, { autosave: JSON.stringify({ ep: 1, sec: 2, ratio: 0.4, savedAt: 100 }) });
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
        await expect(page.locator('#fab-toggle')).toHaveCount(0);

        const resume = page.locator('#idx-topbar-resume');
        await expect(resume).toHaveText('第1話 #2');
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

    // 目次は文書そのものがスクロールする。showModal() は裏を操作できなくするが、スクロールは止めない
    // （背景 ::backdrop の上のホイールは裏の文書へ届く）。_sheet.css の ::backdrop の指定が止めている。
    // 未対応のブラウザ（Safari）では裏が動く＝この検査は Chromium での挙動を固定する
    for (const [name, btn, popup] of [['共有', '#idx-btn-share', '#share-popup'], ['設定', '#idx-btn-settings', '#settings-popup']]) {
        test(`${name}のシートを開いている間、背景の上でホイールを回しても裏のページが動かない`, async ({ page }) => {
            await setup(page);
            await page.goto('/lirmena/');
            await expect(page.locator('#episodes-area .idx-ep').first()).toBeVisible();
            await page.locator(btn).click();
            await expect(page.locator(popup)).toBeVisible();
            // 画面の左上寄り＝PC では右のパネル・右下のカードの外（背景の上）
            await page.mouse.move(200, 300);
            await page.mouse.wheel(0, 600);
            await page.waitForTimeout(400);
            expect(await page.evaluate(() => window.scrollY)).toBe(0);

            // 前提の確認：閉じたあとは同じ操作でページが動く（動かないページでは上の検査が何も見ていない）
            await page.keyboard.press('Escape');
            await expect(page.locator(popup)).toBeHidden();
            await page.mouse.wheel(0, 600);
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        });
    }

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
        await expect(page.locator('#idx-news-pos')).toHaveText('第2話 #1');
        await expect(page.locator('#idx-news-title')).toHaveText('第二の話');
        await expect(page.locator('#idx-news-next time')).toHaveText('1/1（木）20:00');
        await expect(news).toHaveAttribute('href', 'contents/02-00.html');
    });

    test('予定が残っていなければ次回の更新は出さない', async ({ page }) => {
        const story = structuredClone(FIXTURE_STORY);
        delete (story[0].episodes[1].sections[1] as { scheduledAt?: string }).scheduledAt;
        await setup(page, {}, story);
        await page.goto('/lirmena/');
        await expect(page.locator('#idx-news-pos')).toHaveText('第2話 #1');
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
            bookmarks: JSON.stringify([
                { slot: 1, ep: 1, sec: 1, scene: 1, ratio: 0.3, savedAt: 100 },
                { slot: 2, ep: 1, sec: 2, scene: 1, ratio: 0.3, savedAt: 100 },
            ]),
        });
        await page.goto('/lirmena/');
        await page.getByRole('button', { name: '栞 1を消す' }).click();
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        await expect(page.getByRole('button', { name: '栞 2を消す' })).toBeFocused();

        await page.getByRole('button', { name: '栞 2を消す' }).click();
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        // 消せる行が残っていなければ（スロット 0 に × は無い）栞の見出しへ
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

// 「最新」の DOM 上の位置：スマホ幅では話の一覧の前、PC 幅では右カラムの先頭（index.ts の initNewsPlacement。見た目だけ CSS の order で
// 入れ替えると、Tab と読み上げの順が見た目と食い違う）
test.describe('最新の位置（画面幅で DOM の位置を移す）', () => {
    const state = (page: Page) => page.evaluate(() => {
        const news = document.getElementById('idx-news')!;
        const nav = document.getElementById('idx-ep-nav')!;
        const side = document.getElementById('idx-side')!;
        return {
            beforeNav: !!(news.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING),
            aboveNav: news.getBoundingClientRect().top < nav.getBoundingClientRect().top,
            firstOfSide: side.firstElementChild === news,
            parentId: news.parentElement?.id,
        };
    });

    test('スマホ幅（390×844）：DOM でも画面でも話の一覧より前', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await setup(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#idx-news')).toBeVisible();
        const s = await state(page);
        expect(s.beforeNav).toBe(true);
        expect(s.aboveNav).toBe(true);
        expect(s.parentId).toBe('idx-main');
    });

    test('PC 幅（1280×800）：右カラムの最初の子', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await setup(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#idx-news')).toBeVisible();
        expect((await state(page)).firstOfSide).toBe(true);
    });

    test('1280 → 390 → 1280 と切り替えると、位置がそのつど追従する', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await setup(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#idx-news')).toBeVisible();
        expect((await state(page)).firstOfSide).toBe(true);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(async () => (await state(page)).beforeNav).toBe(true);
        expect((await state(page)).parentId).toBe('idx-main');
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect.poll(async () => (await state(page)).firstOfSide).toBe(true);
    });

    // 「最新」にフォーカスがあるときに幅が切り替わっても（スマホの回転など）、フォーカスを失わない。
    // moveBefore があるブラウザはそれが保つ。無いブラウザ（insertBefore に落ちる）でも保つことを、moveBefore を消して確かめる
    for (const withMoveBefore of [true, false]) {
        test(`「最新」にフォーカスがあるまま幅が切り替わっても、フォーカスが残る（moveBefore ${withMoveBefore ? 'あり' : 'なし'}）`, async ({ page }) => {
            if (!withMoveBefore) {
                await page.addInitScript(() => { delete (Element.prototype as { moveBefore?: unknown }).moveBefore; });
            }
            await page.setViewportSize({ width: 1280, height: 800 });
            await setup(page);
            await page.goto('/lirmena/');
            await expect(page.locator('#idx-news')).toBeVisible();
            const has = await page.evaluate(() => 'moveBefore' in Element.prototype);
            // moveBefore を持たないブラウザ（2026-11 時点の WebKit）では「あり」の側は試せない。「なし」の側が同じ経路を見る
            test.skip(withMoveBefore && !has, 'このブラウザは moveBefore を持たない');
            expect(has).toBe(withMoveBefore);
            await page.locator('#idx-news').focus();
            await page.setViewportSize({ width: 390, height: 844 });
            await expect.poll(async () => (await state(page)).parentId).toBe('idx-main');
            expect(await page.evaluate(() => document.activeElement?.id)).toBe('idx-news');
            await page.setViewportSize({ width: 1280, height: 800 });
            await expect.poll(async () => (await state(page)).firstOfSide).toBe(true);
            expect(await page.evaluate(() => document.activeElement?.id)).toBe('idx-news');
        });
    }
});

test.describe('リンクの名前（飾りの ↗ を読み上げに入れない）', () => {
    test('目次のリンクは「カクヨム」の名前で取れる', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/');
        const link = page.getByRole('link', { name: 'カクヨム', exact: true });
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('href', /kakuyomu\.jp/);
        expect(await link.evaluate(el => !!el.closest('#idx-links'))).toBe(true);
    });
});

// WCAG 2.4.11（フォーカスが隠れない）：Shift+Tab でさかのぼると、帯（position: fixed）の裏にある要素へフォーカスが移ることがある。
// Tab キーを送る検査は WebKit の既定（リンクに止まらない）で揃わないので、帯の裏に置いた要素へ focus() して見る
test.describe('フォーカスした要素が上の帯の裏に隠れない', () => {
    test('帯の裏にある巻の見出しへフォーカスすると、帯の下端より下へ出てくる', async ({ page }) => {
        await setup(page);
        await page.goto('/lirmena/');
        const head = page.locator('.idx-vol-head').first();
        await expect(head).toBeVisible();
        const r = await head.evaluate(async (el) => {
            const frame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            // 見出しの上端を画面の上から 8px（帯の裏）に置く
            document.scrollingElement!.scrollTop += el.getBoundingClientRect().top - 8;
            await frame();
            const before = el.getBoundingClientRect().bottom;
            (el as HTMLElement).focus();
            await frame();
            return { before, top: el.getBoundingClientRect().top, bar: document.getElementById('idx-topbar')!.getBoundingClientRect().bottom };
        });
        // 前提：フォーカスする前は見出しが丸ごと帯の裏にある
        expect(r.before).toBeLessThan(r.bar);
        expect(r.top).toBeGreaterThanOrEqual(r.bar - 0.5);
    });
});
