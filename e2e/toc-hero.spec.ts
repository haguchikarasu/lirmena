/*
 * 目次のヒーロー E2E：巻の素材の初期表示（ちらつき回避）と表紙ギャラリー（要件 06-7）。
 *
 * 守りたい不変条件：**stage 2 以上の読者に第1巻の絵を一瞬も見せない**。
 * index.html の <img id="idx-hero-img">（とロゴ・背景）は src 属性を持たず、直後の早期 <script> が端末の stage
 * （lirmena.storyStage）から core/theme.ts の規約どおり URL を組んで入れる。src 属性を書き戻すとプリロードスキャナが
 * 第1巻を先読みして再発するが、それを止める機械ゲートは他に無い（tsc は HTML を見ず、depcruise は import しか見ない）。
 * 早期スクリプトの「stage → 素材の組」は core/theme.ts の themeKeyForStage の複製なので、ここで照合する。
 *
 * 実データの story.json は触らず page.route で fixture に差し替える（toc-preview.spec.ts と同じ流儀）。
 * **素材も route で 1x1 PNG に差し替える**：main の public には第2巻・完結の素材が無い（404 → onerror が第1巻へ落とす）。
 * 拡張子が .avif でもブラウザは Content-Type を見るので描画され、onerror は発火しない。
 *
 * 検証観点：
 *   1. キャッシュと read が stage 2 で整合しているとき、第1巻の絵を一度も取得しない（＝ちらつかない）
 *   2. 初回訪問は第1巻で描き、ロード後に stage がキャッシュされる。食い違うキャッシュは story.json が正
 *   3. 早期スクリプトの対応（1〜4 → volNN、5 → final、不正値 → 第1巻）が core/theme.ts の規約と同じ
 *   4. 表紙ギャラリー：未来の巻を見せない・閲覧位置と stage を混ぜない・ボタン／ドット／払う操作で移れる
 *   5. 隣の巻の絵の先読み（R17）：落ち着いたら 1 つ前の巻を取得しておく。遅い回線でも黒い板を見せない
 */

import { test, expect } from './_fixtures';
import type { Page, Route } from '@playwright/test';

// stage 2 になる最小 fixture。vol1 は ep2-sec1 が未公開＝全 sec 公開ではないので afterword:false と整合する
// （story-integrity (e')）。通し番号は 01-01=0 / 01-02=1 / 03-01=2。read=['01-02'] で vol1 の最終公開 sec に到達し、
// 次巻冒頭 03-01 が公開済みなので stage 2。read に 03-01 も足すと最終巻の最終公開 sec に達して stage 3＝物語完結
// （2 巻の fixture なので完結は stage 3。実データでは 5）
const FIXTURE_STORY = [
    {
        volume: 1,
        epRange: [1, 2],
        afterword: { published: false },
        episodes: [
            { id: 1, title: '第1話', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
            { id: 2, title: '第2話', sections: [{ id: 1, published: false }] },
        ],
    },
    {
        volume: 2,
        epRange: [3, 3],
        afterword: { published: false },
        episodes: [
            { id: 3, title: '第3話', sections: [{ id: 1, published: true }, { id: 2, published: false }] },
        ],
    },
];
const READ_STAGE2 = ['01-02'];
const READ_COMPLETED = ['01-02', '03-01'];

// 1x1 透明 PNG。拡張子 .avif / .webp のリクエストにこれを返しても Content-Type が優先されるので描画される。
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

async function mockStoryJson(page: Page, story: unknown): Promise<void> {
    await page.route('**/story.json', (route: Route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(story) });
    });
}

// 巻の素材（*/theme/*）を実体から切り離す。delayFor に当たる URL だけ遅らせる（遅い回線の模擬）
async function mockThemeFiles(page: Page, delayFor?: { match: string; ms: number }): Promise<void> {
    await page.route('**/theme/*', async (route: Route) => {
        if (delayFor && route.request().url().includes(delayFor.match)) {
            await new Promise((r) => setTimeout(r, delayFor.ms));
        }
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    });
}

// ページが取得したヒーローの絵の URL を時系列で集める
function collectHeroRequests(page: Page): string[] {
    const seen: string[] = [];
    page.on('request', (req) => {
        const url = decodeURI(req.url());
        if (url.includes('/theme/hero-wide')) seen.push(url);
    });
    return seen;
}

async function seed(page: Page, items: Record<string, string>): Promise<void> {
    await page.addInitScript((kv) => {
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, items);
}

const img = (page: Page) => page.locator('#idx-hero-img');

test.describe('目次のヒーロー：巻の素材の初期表示', () => {
    test('stage 2 のキャッシュがあるとき第1巻の絵を一度も取得しない（ちらつき回帰）', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2), 'lirmena.storyStage': '2' });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        const heroes = collectHeroRequests(page);

        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-vol-card').first()).toBeVisible();

        // 第1巻の絵が先に要求されていたら「一瞬見えた」ということ（落ち着いたあとの先読みは別。最初の 1 枚を見る）
        expect(heroes[0]).toMatch(/\/vol02\/theme\/hero-wide\.avif$/);
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        await expect(page.locator('#idx-hero-logo')).toHaveAttribute('src', /vol02\/theme\/logo\.webp$/);
        await expect(page.locator('#idx-page-bg')).toHaveAttribute('src', /vol02\/theme\/page-bg\.avif$/);
    });

    test('初回訪問は第1巻で描き、ロード後に stage がキャッシュされる', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-vol-card').first()).toBeVisible();

        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);
        expect(await page.evaluate(() => localStorage.getItem('lirmena.storyStage'))).toBe('1');
    });

    test('キャッシュが read と食い違うときは story.json が正で、第2巻の素材に収束しキャッシュも直る', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2), 'lirmena.storyStage': '1' });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');

        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        await expect(page.locator('#idx-hero-logo')).toHaveAttribute('src', /vol02\/theme\/logo\.webp$/);
        expect(await page.evaluate(() => localStorage.getItem('lirmena.storyStage'))).toBe('2');
    });

    // 早期スクリプトだけの振る舞いを見る：story.json を返さない（index.ts が stage を算出し直さない）
    for (const [stage, dir] of [['3', 'vol03'], ['5', 'final'], ['9', 'vol01'], ['', 'vol01']] as const) {
        test(`早期スクリプト：キャッシュ "${stage}" → ${dir}/theme（core/theme.ts の規約と同じ対応）`, async ({ page }) => {
            if (stage) await seed(page, { 'lirmena.storyStage': stage });
            await page.route('**/story.json', (route) => route.abort());
            await mockThemeFiles(page);
            await page.goto('/lirmena/');
            await expect(img(page)).toHaveAttribute('src', new RegExp(`(^|/)${dir}/theme/hero-wide\\.avif$`));
            await expect(page.locator('#idx-hero-logo')).toHaveAttribute('src', new RegExp(`(^|/)${dir}/theme/logo\\.webp$`));
            await expect(page.locator('#idx-page-bg')).toHaveAttribute('src', new RegExp(`(^|/)${dir}/theme/page-bg\\.avif$`));
        });
    }

    test('廃止した表紙の URL のキャッシュ（lirmena.heroCard）は起動時に消える', async ({ page }) => {
        await seed(page, { 'lirmena.heroCard': 'vol01/vol01.avif' });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-vol-card').first()).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('lirmena.heroCard'))).toBeNull();
    });
});

/*
 * 表紙ギャラリー（要件 06-7）。守りたいのは 2 つ：
 *   (a) 未来の巻を見せない（ネタバレ）
 *   (b) **閲覧位置と stage を混ぜない** — 過去の表紙を見てもロゴ・data-story-stage・favicon・lirmena.storyStage は
 *       今の stage のまま。ここが崩れると過去の表紙が次回の初期表示になり、ちらつき修正そのものが壊れる
 */
test.describe('目次のヒーロー：表紙ギャラリー', () => {
    test('stage 1（履歴が 1 枚）ではナビもドットも出ない', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area .idx-vol-card').first()).toBeVisible();

        await expect(page.locator('#idx-hero-older')).toBeHidden();
        await expect(page.locator('#idx-hero-newer')).toBeHidden();
        await expect(page.locator('#idx-hero-dots')).toBeHidden();
    });

    test('stage 2 では 2 枚を往復でき、両端で向きのボタンが disabled になる', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');

        const older = page.locator('#idx-hero-older');
        const newer = page.locator('#idx-hero-newer');
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        await expect(page.locator('#idx-hero-dots button')).toHaveCount(2);
        await expect(newer).toBeDisabled();
        await expect(older).toBeEnabled();

        await older.click();
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);
        await expect(img(page)).toHaveAttribute('alt', '第1巻の表紙');
        await expect(older).toBeDisabled();
        await expect(newer).toBeEnabled();
        await expect(page.locator('#idx-hero-dots button').nth(1)).toHaveAttribute('aria-current', 'true');

        await newer.click();
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        await expect(newer).toBeDisabled();
    });

    test('物語完結は final の絵を起点に、ドットで離れた巻へ直接移れる', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_COMPLETED) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');

        await expect(img(page)).toHaveAttribute('src', /final\/theme\/hero-wide\.avif$/);
        const dots = page.locator('#idx-hero-dots button');
        await expect(dots).toHaveCount(3);
        await expect(dots.nth(0)).toHaveAttribute('aria-label', '完結の表紙');
        // 2 巻離れた第1巻へ 1 回で（隣の第2巻の絵を挟まない）
        await dots.nth(2).click();
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);
        await expect(page.locator('#idx-hero-status')).toHaveText('第1巻の表紙（3 / 3）');
    });

    test('未来の巻の絵は DOM にもリクエストにも出ない', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        const heroes = collectHeroRequests(page);
        await page.goto('/lirmena/');

        await page.locator('#idx-hero-older').click();
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);
        expect(heroes.some((u) => u.includes('/final/'))).toBe(false);
    });

    test('送りボタンの連打（動き出す前の 2 回目）は 1 巻ぶんしか進まない', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);

        // Playwright の click() は 1 回ごとに落ち着くのを待つので、同じタスクで 2 回押して「_commit 前の 2 回目」を作る
        await page.evaluate(() => {
            const b = document.getElementById('idx-hero-older') as HTMLButtonElement;
            b.click(); b.click();
        });
        await expect(page.locator('#idx-hero-status')).toHaveText('第1巻の表紙（2 / 2）');
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);
        // 範囲の外へ出ていなければ、新しい方へ 1 回で戻れる
        await page.locator('#idx-hero-newer').click();
        await expect(page.locator('#idx-hero-status')).toHaveText('第2巻の表紙（1 / 2）');
    });

    test('過去の表紙を見ても stage 由来の状態（ロゴ・data-story-stage・favicon・キャッシュ）は動かない', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        const faviconBefore = await page.locator('#app-favicon').getAttribute('href');

        await page.locator('#idx-hero-older').click();
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);

        await expect(page.locator('#idx-hero-logo')).toHaveAttribute('src', /vol02\/theme\/logo\.webp$/);
        await expect(page.locator('html')).toHaveAttribute('data-story-stage', '2');
        expect(await page.locator('#app-favicon').getAttribute('href')).toBe(faviconBefore);
        expect(await page.evaluate(() => localStorage.getItem('lirmena.storyStage'))).toBe('2');
    });

    test('「読破を消す」で履歴が縮退し、閲覧位置も今の stage へ戻る', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');
        await page.locator('#idx-hero-older').click();
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);

        await page.locator('#idx-btn-settings').click();
        await page.locator('.settings-action', { hasText: '読破を消す' }).click();
        await page.locator('#confirm-dialog').getByRole('button', { name: '削除する' }).click();
        await page.locator('#settings-popup').getByRole('button', { name: '閉じる' }).click();

        await expect(page.locator('#idx-hero-older')).toBeHidden();
        await expect(page.locator('#idx-hero-dots')).toBeHidden();
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);
        await expect(page.locator('#idx-hero-logo')).toHaveAttribute('src', /vol01\/theme\/logo\.webp$/);
    });

    test('指で左へ払うと過去の巻へ、右へ払うと戻る（横の動きだけを拾う）', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);

        const art = page.locator('#idx-hero-art');
        const swipe = async (dx: number, dy = 0): Promise<void> => {
            const o = { pointerType: 'touch', pointerId: 7, isPrimary: true };
            await art.dispatchEvent('pointerdown', { ...o, clientX: 300, clientY: 300 });
            await art.dispatchEvent('pointermove', { ...o, clientX: 300 + dx / 2, clientY: 300 + dy / 2 });
            await art.dispatchEvent('pointermove', { ...o, clientX: 300 + dx, clientY: 300 + dy });
            await art.dispatchEvent('pointerup', { ...o, clientX: 300 + dx, clientY: 300 + dy });
        };
        // 縦の動きのほうが大きい＝スクロール。表紙は替わらない
        await swipe(-40, -200);
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        await swipe(-260);
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);
        await swipe(260);
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
    });

    test('落ち着いたら 1 つ前の巻の絵を先読みする（押す前に取得している。R17）', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        const heroes = collectHeroRequests(page);
        await page.goto('/lirmena/');
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        await expect.poll(() => heroes.some((u) => u.includes('/vol01/theme/hero-wide.avif')), { timeout: 5000 }).toBe(true);
    });

    test('遅い回線：隣の絵が届く前に動かしても、枠の地に今の絵をぼかして敷く（黒い板を見せない。R17）', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_STAGE2) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page, { match: '/vol01/theme/hero-wide', ms: 2500 });
        await page.goto('/lirmena/');
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);

        await page.locator('#idx-hero-older').click();
        const peer = page.locator('#idx-hero-slide-peer');
        // 隣の絵の枠に、今の巻（第2巻）の絵が地として渡っている
        await expect.poll(() => peer.evaluate((el) => el.style.getPropertyValue('--fallback'))).toMatch(/vol02\/theme\/hero-wide\.avif/);
        // 届いたら第1巻へ替わりきる
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/, { timeout: 6000 });
        await expect(peer).toBeHidden();
    });

    test('キーボード：ドットや送りボタンで移っても、フォーカスはヒーローの中に留まり ← → で続けて移れる', async ({ page }) => {
        await seed(page, { read: JSON.stringify(READ_COMPLETED) });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page);
        await page.goto('/lirmena/');
        await expect(img(page)).toHaveAttribute('src', /final\/theme\/hero-wide\.avif$/);

        const dots = page.locator('#idx-hero-dots button');
        await dots.nth(1).focus();
        await page.keyboard.press('Enter');
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        // ドットは作り直さない＝押したドットにフォーカスが残る
        await expect(dots.nth(1)).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(img(page)).toHaveAttribute('src', /vol01\/theme\/hero-wide\.avif$/);

        // 端まで来て押せなくなったボタンからは、反対向きのボタンへ移る
        await page.locator('#idx-hero-newer').focus();
        await page.keyboard.press('Enter');
        await expect(img(page)).toHaveAttribute('src', /vol02\/theme\/hero-wide\.avif$/);
        await page.keyboard.press('Enter');
        await expect(img(page)).toHaveAttribute('src', /final\/theme\/hero-wide\.avif$/);
        await expect(page.locator('#idx-hero-older')).toBeFocused();
    });

    test('ヒーローの絵が届くまで、背景・ロゴ・ボタンを隠して読み込み中の印を出す', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY);
        await mockThemeFiles(page, { match: '/vol01/theme/hero-wide', ms: 1500 });
        // 既定の goto は load（画像の到着）まで待つ＝絵が届いた後になる。DOM ができた時点で止める
        await page.goto('/lirmena/', { waitUntil: 'domcontentloaded' });
        const loading = () => page.evaluate(() => document.documentElement.hasAttribute('data-hero-loading'));
        expect(await loading()).toBe(true);
        await expect(page.locator('#idx-hero-loading')).toBeVisible();
        await expect(page.locator('#idx-page-bg')).toHaveCSS('opacity', '0');
        // 届いたら外れる
        await expect.poll(loading, { timeout: 5000 }).toBe(false);
        await expect(page.locator('#idx-hero-loading')).toBeHidden();
    });
});
