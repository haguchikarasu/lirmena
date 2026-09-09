/*
 * 目次ヒーローカードの初期表示 E2E（ちらつき回避・plans/2026-09-09-toc-hero-flicker.md）。
 *
 * 守りたい不変条件：**stage 2 以上の読者に vol01 の表紙を一瞬も見せない**。
 * index.html の <img id="idx-hero-img"> は src 属性を持たず、直後の早期 <script> が localStorage
 * 'lirmena.heroCard' から相対パスを入れる。src 属性を書き戻すとプリロードスキャナが vol01 を先読みして
 * 再発するが、それを止める機械ゲートは他に無い（tsc は HTML を見ず、depcruise は import しか見ない）。
 *
 * 実データの story.json は触らず page.route で fixture に差し替える（toc-preview.spec.ts と同じ流儀）。
 * **画像も route で 1x1 PNG に差し替える**：fixture の vol02.avif は draft にしか無く、main の public では
 * 404 → onerror が vol01 へ落として観点 1 が必ず落ちるため。拡張子が .avif でもブラウザは Content-Type を
 * 見るので描画され、onerror は発火しない。
 *
 * 検証観点：
 *   1. キャッシュと read が stage 2 で整合しているとき、vol01 の画像を一度も取得しない（＝ちらつかない）
 *   2. 初回訪問（localStorage 空）は vol01 にフォールバックし、ロード後に stage 相応の値が入る
 *   3. キャッシュが古くて read と食い違うときは story.json が正で、最終的に vol02 へ収束しキャッシュも直る
 *   4. 不正値のキャッシュは読取側で弾かれ、保存し直されない（保存側と読取側の規則が同一であること）
 */

import { test, expect } from './_fixtures';
import type { Page, Route } from '@playwright/test';

// stage 2 になる最小 fixture。vol1 は ep2-sec1 が未公開＝全 sec 公開ではないので afterword:false と整合し
// （story-integrity (e')）、vol2 は最終 vol なので heroCardCompleted を持つ（(g)）。
// 通し番号は 01-01=0 / 01-02=1 / 03-01=2。read=['01-02'] で vol1 の最終公開 sec に到達し、
// 次巻冒頭 03-01 が公開済みなので stage 2 になる。
const FIXTURE_STORY = [
    {
        volume: 1,
        epRange: [1, 2],
        heroCard: { file: 'vol01.avif' },
        afterword: { published: false },
        episodes: [
            { id: 1, title: '第1話', sections: [{ id: 1, published: true }, { id: 2, published: true }] },
            { id: 2, title: '第2話', sections: [{ id: 1, published: false }] },
        ],
    },
    {
        volume: 2,
        epRange: [3, 3],
        heroCard: { file: 'vol02.avif' },
        heroCardCompleted: { file: 'vol02-fin.avif' },
        afterword: { published: false },
        episodes: [
            { id: 3, title: '第3話', sections: [{ id: 1, published: true }, { id: 2, published: false }] },
        ],
    },
];

// 1x1 透明 PNG。拡張子 .avif のリクエストにこれを返しても Content-Type が優先されるので描画される。
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

async function mockStoryJson(page: Page, story: unknown): Promise<void> {
    await page.route('**/story.json', (route: Route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(story) });
    });
}

// 表紙画像を実体から切り離す（main の public には vol02.avif が無いため）。
async function mockCoverImages(page: Page): Promise<void> {
    await page.route('**/vol0*/*.avif', (route: Route) => {
        route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    });
}

// ページが取得した表紙画像の URL を時系列で集める。
function collectCoverRequests(page: Page): string[] {
    const seen: string[] = [];
    page.on('request', (req) => {
        const url = req.url();
        if (url.includes('.avif')) seen.push(url);
    });
    return seen;
}

test.describe('目次ヒーローカードの初期表示', () => {
    test('stage 2 のキャッシュがあるとき vol01 を一度も取得しない（ちらつき回帰）', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('read', JSON.stringify(['01-02']));
            localStorage.setItem('lirmena.heroCard', 'vol02/vol02.avif');
        });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        const covers = collectCoverRequests(page);

        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // vol01 の絵が一度でも要求されていたら「一瞬見えた」ということ
        expect(covers.filter((u) => u.includes('vol01'))).toHaveLength(0);
        expect(covers.some((u) => u.includes('vol02/vol02.avif'))).toBe(true);
        await expect(page.locator('#idx-hero-img')).toHaveAttribute('src', /vol02\/vol02\.avif$/);
    });

    test('初回訪問はキャッシュが無いので vol01 で描き、ロード後に stage 相応の値が入る', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);

        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // read が空＝stage 1 なので vol01 のまま。キャッシュは stage 1 の値で埋まる
        await expect(page.locator('#idx-hero-img')).toHaveAttribute('src', /vol01\/vol01\.avif$/);
        const cached = await page.evaluate(() => localStorage.getItem('lirmena.heroCard'));
        expect(cached).toBe('vol01/vol01.avif');
    });

    test('キャッシュが read と食い違うときは story.json が正で vol02 に収束しキャッシュも直る', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('read', JSON.stringify(['01-02']));
            localStorage.setItem('lirmena.heroCard', 'vol01/vol01.avif'); // 古い（stage 1 時代の残留）
        });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);

        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // このロードでは vol01 が先に出る（＝ちらつく）が、それは想定内。story.json が最終的な正であること、
        // キャッシュが直って次回はちらつかないことを見る
        await expect(page.locator('#idx-hero-img')).toHaveAttribute('src', /vol02\/vol02\.avif$/);
        const cached = await page.evaluate(() => localStorage.getItem('lirmena.heroCard'));
        expect(cached).toBe('vol02/vol02.avif');
    });

    test('不正値のキャッシュは読取側で弾かれ、保存し直されない', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('read', JSON.stringify(['01-02']));
            localStorage.setItem('lirmena.heroCard', '../../etc/passwd');
        });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        const covers = collectCoverRequests(page);

        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // 不正値は使わず vol01 へフォールバックし、その後 applyStoryStage が正しい値で上書きする
        expect(covers.some((u) => u.includes('etc/passwd'))).toBe(false);
        const cached = await page.evaluate(() => localStorage.getItem('lirmena.heroCard'));
        expect(cached).toBe('vol02/vol02.avif');
    });

    // vol[XX]/ の中から出る値の回帰（Codex code レビュー 2026-09-09）。
    // "vol01/../vol02/..." はブラウザが vol02 として解決するので、**stage 2 の読者に完結カードが出る**
    // ＝ネタバレになる。HTML 側の早期スクリプトの正規表現を e2e で見張る（volumes.test.ts が見るのは
    // TS 側の複製だけで、HTML 側は素通りするため）。
    test('vol[XX]/ の外を指すキャッシュは弾く（正規化で未来の表紙を出させない）', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('read', JSON.stringify(['01-02']));
            localStorage.setItem('lirmena.heroCard', 'vol01/../vol02/vol02-fin.avif');
        });
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        const covers = collectCoverRequests(page);

        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        expect(covers.some((u) => u.includes('vol02-fin'))).toBe(false);
        const cached = await page.evaluate(() => localStorage.getItem('lirmena.heroCard'));
        expect(cached).toBe('vol02/vol02.avif');
    });

    // 本文ページ側でもキャッシュを書くことの回帰（Codex code レビュー P1）。
    // stage が上がるのは本文を読み終えた瞬間（nav → bookmark.recordRead）で、目次のロードより後。
    // 目次側だけで書いていると「上がった直後に初めて目次へ戻る」場面で古い表紙が一瞬見える＝
    // 直したはずのちらつきが、いちばん自然な読者体験の場面で残る。
    // ロード時の書き込みと混ざらないよう、いったん消してから pagehide だけを発火させて見る。
    test('本文ページの離脱時に表紙キャッシュが書き直される', async ({ page }) => {
        await page.goto('/lirmena/contents/01-01.html');
        // _bootstrapSec は async。ロード時の書き込みが終わるのを待ってから消さないと、初期化があとから
        // 書き直してしまい pagehide の寄与を分離できない（待たずに書いて実際に落ちた）。
        await page.waitForFunction(() => localStorage.getItem('lirmena.heroCard') !== null);
        await page.evaluate(() => localStorage.removeItem('lirmena.heroCard'));
        expect(await page.evaluate(() => localStorage.getItem('lirmena.heroCard'))).toBeNull();

        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

        const cached = await page.evaluate(() => localStorage.getItem('lirmena.heroCard'));
        expect(cached).toMatch(/^vol\d{2}\/.+$/);
    });
});

/*
 * 表紙ギャラリー（要件 06-7）。守りたいのは 2 つ：
 *   (a) 未来の巻を見せない（ネタバレ）
 *   (b) **閲覧位置と stage を混ぜない** — 過去の表紙を見ても heroCard キャッシュ・data-story-stage・
 *       favicon は現在 stage のまま。ここが崩れると過去の表紙が次回の初期表示として保存され、
 *       ちらつき修正そのものが壊れる
 */

// FIXTURE_STORY は 2 vol。read で stage を作り分ける。
const READ_STAGE2 = ['01-02'];              // vol1 の最終公開 sec に到達 → stage 2
const READ_COMPLETED = ['01-02', '03-01'];  // vol2 の最終公開 sec にも到達 → stage 3（＝物語完結）

const openSettingsFromFab = async (page: Page): Promise<void> => {
    await page.locator('#fab-toggle').click();
    await page.getByRole('menuitem', { name: '設定' }).click();
    await expect(page.locator('#settings-popup')).toBeVisible();
};

test.describe('目次ヒーローカードの表紙ギャラリー', () => {
    test('stage 1（履歴が 1 枚）ではナビもドットも出ない', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        await expect(page.locator('#idx-hero-older')).toBeHidden();
        await expect(page.locator('#idx-hero-newer')).toBeHidden();
        await expect(page.locator('.idx-hero-dot')).toHaveCount(0);
    });

    test('stage 2 では 2 枚を往復でき、両端でボタンが disabled になる', async ({ page }) => {
        await page.addInitScript((read) => {
            localStorage.setItem('read', JSON.stringify(read));
        }, READ_STAGE2);
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        const img = page.locator('#idx-hero-img');
        const older = page.locator('#idx-hero-older');
        const newer = page.locator('#idx-hero-newer');

        // 初期は最新（vol02）。新しい方向へは行けない
        await expect(img).toHaveAttribute('src', /vol02\/vol02\.avif$/);
        await expect(page.locator('.idx-hero-dot')).toHaveCount(2);
        await expect(newer).toBeDisabled();
        await expect(older).toBeEnabled();

        // 過去へ 1 枚。今度は逆側が端になる
        await older.click();
        await expect(img).toHaveAttribute('src', /vol01\/vol01\.avif$/);
        await expect(older).toBeDisabled();
        await expect(newer).toBeEnabled();

        // 戻れる（往復）
        await newer.click();
        await expect(img).toHaveAttribute('src', /vol02\/vol02\.avif$/);
        await expect(newer).toBeDisabled();
    });

    test('物語完結 stage は完結カードを起点に 3 枚を新しい順で辿れる', async ({ page }) => {
        await page.addInitScript((read) => {
            localStorage.setItem('read', JSON.stringify(read));
        }, READ_COMPLETED);
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        const img = page.locator('#idx-hero-img');
        const older = page.locator('#idx-hero-older');

        await expect(img).toHaveAttribute('src', /vol02\/vol02-fin\.avif$/);
        await older.click();
        await expect(img).toHaveAttribute('src', /vol02\/vol02\.avif$/);
        await older.click();
        await expect(img).toHaveAttribute('src', /vol01\/vol01\.avif$/);
        await expect(older).toBeDisabled();
    });

    test('未来の巻の表紙は DOM にもリクエストにも出ない', async ({ page }) => {
        await page.addInitScript((read) => {
            localStorage.setItem('read', JSON.stringify(read));
        }, READ_STAGE2);
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        const covers = collectCoverRequests(page);

        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // stage 2 の読者に完結カードは見えない。端まで遡っても取得されない
        await page.locator('#idx-hero-older').click();
        await expect(page.locator('#idx-hero-img')).toHaveAttribute('src', /vol01\/vol01\.avif$/);
        expect(covers.some((u) => u.includes('vol02-fin'))).toBe(false);
    });

    test('過去の表紙を見ても stage 由来の状態（キャッシュ・data-story-stage・favicon）は動かない', async ({ page }) => {
        await page.addInitScript((read) => {
            localStorage.setItem('read', JSON.stringify(read));
        }, READ_STAGE2);
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        const faviconBefore = await page.locator('#app-favicon').getAttribute('href');

        await page.locator('#idx-hero-older').click();
        await expect(page.locator('#idx-hero-img')).toHaveAttribute('src', /vol01\/vol01\.avif$/);

        // 表示は vol01 に変わったが、stage 由来の 3 つは stage 2 のまま
        expect(await page.evaluate(() => localStorage.getItem('lirmena.heroCard'))).toBe('vol02/vol02.avif');
        await expect(page.locator('html')).toHaveAttribute('data-story-stage', '2');
        expect(await page.locator('#app-favicon').getAttribute('href')).toBe(faviconBefore);
    });

    test('「読破状況をクリア」で履歴が縮退し、閲覧位置も最新へ戻る', async ({ page }) => {
        await page.addInitScript((read) => {
            localStorage.setItem('read', JSON.stringify(read));
        }, READ_STAGE2);
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // 過去へ移動した状態でクリアする
        await page.locator('#idx-hero-older').click();
        await expect(page.locator('#idx-hero-img')).toHaveAttribute('src', /vol01\/vol01\.avif$/);

        page.once('dialog', (d) => d.accept());
        await openSettingsFromFab(page);
        await page.locator('.settings-action', { hasText: '読破状況をクリア' }).click();

        // stage 1 に落ちる＝履歴は 1 枚。ナビは消え、表紙は現在 stage（vol01）のまま
        await expect(page.locator('#idx-hero-older')).toBeHidden();
        await expect(page.locator('#idx-hero-newer')).toBeHidden();
        await expect(page.locator('.idx-hero-dot')).toHaveCount(0);
        await expect(page.locator('#idx-hero-img')).toHaveAttribute('src', /vol01\/vol01\.avif$/);
    });

    test('applyStoryStage が再実行されてもクリックが多重発火しない（イベント登録は 1 度だけ）', async ({ page }) => {
        await page.addInitScript((read) => {
            localStorage.setItem('read', JSON.stringify(read));
        }, READ_COMPLETED);
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        // 「既読をクリア」は stage に影響しないが applyStoryStage 経路を通る描画更新を起こす。
        // ここでイベントを再登録していると、次の 1 クリックで 2 枚進んでしまう。
        page.once('dialog', (d) => d.accept());
        await openSettingsFromFab(page);
        await page.locator('.settings-action', { hasText: '既読をクリア' }).click();
        await page.locator('#settings-popup .settings-close').click();

        await page.locator('#idx-hero-older').click();
        // 1 枚だけ進んでいること（多重登録なら vol01 まで飛ぶ）
        await expect(page.locator('#idx-hero-img')).toHaveAttribute('src', /vol02\/vol02\.avif$/);
    });

    // ヒーローカードは aspect-ratio で高さを固定し overflow:hidden で外を切るので、**内側に入れて
    // いいのは表紙とナビだけ**。ギャラリー追加時に </figure> を書き落として版数バッジが中に入り、
    // 丸ごと切り取られた（2026-09-09・Codex code レビューが検出。既存 e2e は 59 件とも素通りした）。
    // 「ヒーローカードの子孫に版数バッジが無い」ことを機械で見張る。
    test('版数バッジはヒーローカードの外にある（閉じタグの書き落とし回帰）', async ({ page }) => {
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        await expect(page.locator('#idx-hero-card #idx-version-badges')).toHaveCount(0);
        await expect(page.locator('#idx-version-badges')).toBeVisible();

        // バッジの上端がヒーロー画像の下端より下にある＝カードに飲み込まれていない
        const card = await page.locator('#idx-hero-card').boundingBox();
        const badges = await page.locator('#idx-version-badges').boundingBox();
        expect(card).not.toBeNull();
        expect(badges).not.toBeNull();
        expect(badges!.y).toBeGreaterThanOrEqual(card!.y + card!.height - 1);
    });

    // 「切り替わるがスライドしない」の回帰（2026-09-09・スマホで発生）。
    // transition を有効にしたのと同じフレームで transform まで変えると、ブラウザが開始値を取り違えて
    // アニメーションを飛ばす。**画像がキャッシュ済みで decode が即返るときだけ**顕在化するので、
    // 先に 1 往復してキャッシュを温めてから測る。src の変化だけを見る検査では素通りする。
    test('表紙の切り替えで実際に transition が走る（キャッシュ済みでも飛ばない）', async ({ page }) => {
        await page.addInitScript((read) => {
            localStorage.setItem('read', JSON.stringify(read));
        }, READ_COMPLETED);
        await mockStoryJson(page, FIXTURE_STORY);
        await mockCoverImages(page);
        await page.goto('/lirmena/');
        await expect(page.locator('#episodes-area')).toBeVisible();

        const result = await page.evaluate(async () => {
            const img = document.querySelector<HTMLImageElement>('#idx-hero-img');
            const older = document.querySelector<HTMLButtonElement>('#idx-hero-older');
            const newer = document.querySelector<HTMLButtonElement>('#idx-hero-newer');
            if (!img || !older || !newer) return null;
            const wait = (ms: number): Promise<void> => new Promise((r) => { window.setTimeout(r, ms); });

            // 1 往復してブラウザキャッシュを温める（ここで decode が即返る状態を作る）
            older.click();
            await wait(600);
            newer.click();
            await wait(600);

            let fired = false;
            img.addEventListener('transitionstart', () => { fired = true; }, { once: true });
            older.click();
            // 0.3s のスライドの途中を覗く。ここで既に定位置なら「飛んでいる」＝スライドしていない。
            // transitionstart だけでは足りない：飛ぶ場合も一瞬アニメが走って発火するため。
            await wait(100);
            const matrix = window.getComputedStyle(img).transform;
            await wait(600);
            return { fired, matrix };
        });

        expect(result).not.toBeNull();
        expect(result!.fired).toBe(true);

        // matrix(a,b,c,d,tx,ty) か matrix3d(...) の平行移動成分。スライド中なら 0 から大きく離れている。
        const nums = result!.matrix.replace(/^matrix(3d)?\(/, '').replace(/\)$/, '').split(',').map(Number);
        const tx = nums.length === 16 ? nums[12] : nums[4];
        expect(Math.abs(tx)).toBeGreaterThan(5);
    });
});
