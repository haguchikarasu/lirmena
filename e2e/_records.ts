/*
 * 記録まわり（オートセーブ・続きから・もどる・保留・札）の e2e 共通手順。
 *
 * 公開状態と本文の長さを固定する（story.json・本文は route で差し替える）。ページの器は本番ビルドにある番号だけを使う：
 *   第 1 巻：01-01・01-02・02-01・02-02・02-03（巻末）。あとがき公開
 *   第 2 巻：05-01・05-02（最新）。05-03 は未公開
 * あとがきのページは本番の story.json では未公開でビルドに無いので、01-01 のページの body の属性だけ書き換えて返す
 * （同じテンプレート・同じ JS を通るので専用のビルドは要らない）。
 *
 * 記録の準備は seed の 1 回だけ（addInitScript は遷移のたびに入れ直すので、複数ページの流れに使えない）。
 * サイト内の移動は実際のリンクのクリックで行う（document.referrer が判定の入力なので goto で代用しない）。
 */

import { expect, type Page } from '@playwright/test';

export const pad = (n: number): string => String(n).padStart(2, '0');

export type StoryOptions = { unpublish?: string[]; publish?: string[]; afterword?: boolean };

// fixture の story.json を組む。unpublish / publish は "EP-SEC"。
export function buildStory(opts: StoryOptions = {}): unknown {
    const isPub = (ep: number, sec: number, base: boolean): boolean => {
        const key = `${pad(ep)}-${pad(sec)}`;
        if (opts.unpublish?.includes(key)) return false;
        if (opts.publish?.includes(key)) return true;
        return base;
    };
    const ep = (id: number, secs: Array<[number, boolean]>) => ({
        id,
        title: `第${id}話の題`,
        sections: secs.map(([s, base]) => ({ id: s, published: isPub(id, s, base) })),
    });
    return [
        {
            volume: 1,
            epRange: [1, 2],
            afterword: { published: opts.afterword ?? true },
            episodes: [ep(1, [[1, true], [2, true]]), ep(2, [[1, true], [2, true], [3, true]])],
        },
        {
            volume: 2,
            epRange: [5, 5],
            afterword: { published: false },
            episodes: [ep(5, [[1, true], [2, true], [3, false]])],
        },
    ];
}

const BODY = Array.from({ length: 240 }, (_, i) => `本文の${i + 1}行目。読み進めるための長さを持たせる文を置いている。`).join('\n');

// story.json・本文・あとがきのページを差し替える。storyOpts を変えて呼び直すと公開状態を変えられる（後勝ち）。
export async function setupRoutes(page: Page, storyOpts: StoryOptions = {}): Promise<void> {
    await page.route('**/story.json', (r) => r.fulfill({ json: buildStory(storyOpts) }));
    await page.route(/\/vol\d+\/ep\d+\/txt\/[^/]+\.txt/, (r) => r.fulfill({ contentType: 'text/plain; charset=utf-8', body: BODY }));
    await page.route(/\/vol\d+\/vol\d+-afterword\.txt/, (r) => r.fulfill({ contentType: 'text/plain; charset=utf-8', body: BODY }));
    await page.route('**/contents/vol01-afterword.html*', async (r) => {
        const res = await r.fetch({ url: new URL('01-01.html', r.request().url()).href });
        const html = (await res.text()).replace(/<body[^>]*>/, '<body data-vol="1" data-kind="afterword">');
        await r.fulfill({ response: res, body: html });
    });
}

export type Seed = {
    reached?: string[];
    read?: string[];
    autosave?: { ep: number; sec: number; ratio: number };
    extra?: Record<string, string>;
};

// 目次を開いて記録を 1 回だけ入れ、目次を開き直す（最後に目次にいる）。
export async function seed(page: Page, rec: Seed = {}): Promise<void> {
    await page.goto('/lirmena/');
    await page.evaluate((r) => {
        localStorage.setItem('schemaVersion', '5');
        if (r.reached) localStorage.setItem('reached', JSON.stringify(r.reached));
        if (r.read) localStorage.setItem('read', JSON.stringify(r.read));
        if (r.autosave) localStorage.setItem('autosave', JSON.stringify({ ...r.autosave, savedAt: 100 }));
        for (const [k, v] of Object.entries(r.extra ?? {})) localStorage.setItem(k, v);
    }, rec);
    await gotoToc(page);
}

export type Records = {
    reached: string[];
    read: string[];
    autosave: { ep: number; sec: number; ratio: number } | null;
    pendingScrollEnd: unknown;
    pendingJump: unknown;
    stage: string | null;
    schemaVersion: string | null;
};

export async function records(page: Page): Promise<Records> {
    return page.evaluate(() => {
        const j = (k: string): unknown => JSON.parse(localStorage.getItem(k) ?? 'null');
        return {
            reached: (j('reached') ?? []) as string[],
            read: (j('read') ?? []) as string[],
            autosave: j('autosave') as { ep: number; sec: number; ratio: number } | null,
            pendingScrollEnd: j('pendingScrollEnd'),
            pendingJump: j('pendingJump'),
            stage: localStorage.getItem('lirmena.storyStage'),
            schemaVersion: localStorage.getItem('schemaVersion'),
        };
    });
}

// 本文ページの準備が整う（読み込みが終わり、読了検知が有効になる）まで待つ。
export async function waitReader(page: Page): Promise<void> {
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#scene-content .scene').first()).toBeAttached();
    await page.evaluate(() => new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => res())));
    }));
}

// 目次の巻カードをすべて開く（stage の巻だけ開いているので、他の巻のチップは押せない）。
export async function openVolumes(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.querySelectorAll<HTMLDetailsElement>('details.idx-vol-card').forEach((d) => { d.open = true; });
    });
}

// タイトルページの「本文を読む」で本文へ入る。
export async function enterFromTitle(page: Page, ep: number): Promise<void> {
    await page.locator('#btn-title-enter').click();
    await page.waitForURL(new RegExp(`${pad(ep)}-01\\.html`));
    await waitReader(page);
}

// 目次の節のチップを押す。sec 1 は扉（EE-00）へ行くので「本文を読む」まで進める。
export async function openFromToc(page: Page, ep: number, sec: number): Promise<void> {
    await openVolumes(page);
    const file = `${pad(ep)}-${sec === 1 ? '00' : pad(sec)}.html`;
    await page.locator(`#episodes-area a.idx-chip[href*="contents/${file}"]`).click();
    await page.waitForURL(new RegExp(file));
    if (sec === 1) {
        await enterFromTitle(page, ep);
        return;
    }
    await waitReader(page);
}

export async function openAfterwordFromToc(page: Page, vol = 1): Promise<void> {
    await openVolumes(page);
    await page.locator(`#episodes-area a.idx-chip[href*="vol${pad(vol)}-afterword.html"]`).click();
    await page.waitForURL(new RegExp(`vol${pad(vol)}-afterword`));
    await waitReader(page);
}

// 目次を開く（結果を読むための移動。直接開くが、目次は referrer を判定に使わない）。
export async function gotoToc(page: Page): Promise<void> {
    await page.goto('/lirmena/');
    // stage が 2 以上だと第 1 巻は閉じているので「見える」では待たない
    await expect(page.locator('#episodes-area .idx-chip').first()).toBeAttached();
}

export type Pos = { progress: number; range: number; client: number; ratio: number };

// 進行軸の現在位置。書字方向の差は axis.ts と同じ式で吸収する。
export async function position(page: Page): Promise<Pos> {
    return page.evaluate(() => {
        const c = document.querySelector<HTMLElement>('#main-container')!;
        const v = document.documentElement.getAttribute('data-writing-mode') === 'vertical';
        const progress = v ? Math.abs(c.scrollLeft) : c.scrollTop;
        const range = v ? c.scrollWidth - c.clientWidth : c.scrollHeight - c.clientHeight;
        const client = v ? c.clientWidth : c.clientHeight;
        return { progress, range, client, ratio: range > 0 ? progress / range : 0 };
    });
}

// 進行軸の forward 位置を書く（scroll イベントが飛ぶ）。
export async function scrollForward(page: Page, forward: number): Promise<void> {
    await page.evaluate((f) => {
        const c = document.querySelector<HTMLElement>('#main-container')!;
        if (document.documentElement.getAttribute('data-writing-mode') === 'vertical') c.scrollLeft = -f;
        else c.scrollTop = f;
    }, forward);
    await page.evaluate(() => new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => res()));
    }));
}

export async function scrollToRatio(page: Page, ratio: number): Promise<void> {
    const { range } = await position(page);
    await scrollForward(page, range * ratio);
}

// 読了ライン（本文の末尾）を越えるまでスクロールする。
export async function readToEnd(page: Page): Promise<void> {
    const { range } = await position(page);
    await scrollForward(page, range);
}

// 読了ラインを越えない少しのスクロール。元の不具合は着地が読了ラインより先で、これだけで読破が付いた。
export async function nudge(page: Page): Promise<void> {
    const { progress } = await position(page);
    await scrollForward(page, progress + 10);
}

export async function expectAtHead(page: Page): Promise<void> {
    await expect.poll(async () => (await position(page)).progress, { message: '先頭へ着地' }).toBeLessThanOrEqual(4);
}

// 本文の末尾（読了ラインの先）へ着地している。
export async function expectAtEnd(page: Page): Promise<void> {
    await expect.poll(async () => {
        const p = await position(page);
        return p.progress - (p.range - p.client);
    }, { message: '末尾へ着地' }).toBeGreaterThanOrEqual(-4);
}

export async function goBackByOpening(page: Page, toFile: string): Promise<void> {
    const back = page.locator('#opening-back');
    await expect(back).toBeVisible();
    await back.click();
    await page.waitForURL(new RegExp(toFile));
    await waitReader(page);
}

// 外部流入で本文・あとがきを開く（referer を渡さなければ referrer は空）。name は "01-02" や "vol01-afterword"。
export async function openExternal(page: Page, name: string, referer?: string): Promise<void> {
    await page.goto(`/lirmena/contents/${name}.html`, referer ? { referer } : undefined);
    await waitReader(page);
}

// このタブの保留の記憶（core/record-hold のキー）。
export async function openHold(page: Page): Promise<string | null> {
    return page.evaluate(() => sessionStorage.getItem('lirmena.recordHold'));
}

// 「記録されない」を確かめる前に、記録が走る機会を与える（スロットルを越えてスクロールする）。
export async function tryToRecord(page: Page): Promise<void> {
    await page.waitForTimeout(600);
    await scrollToRatio(page, 0.3);
    await page.waitForTimeout(100);
}

// 指定の位置までスクロールして、autosave に書かれるまで待つ（reader.ts のスロットル 500ms を越える）。
export async function scrollAndSave(page: Page, ratio: number): Promise<void> {
    await page.waitForTimeout(600);
    await scrollToRatio(page, ratio);
    await expect.poll(async () => (await records(page)).autosave?.ratio ?? -1).toBeCloseTo(ratio, 1);
}

// 目次の「続きから読む」の表示。読み始めるボタン・下の行・上の帯・スロット 0・チップの枠がすべて同じ地点を指すことを見る。
// here はチップの href の番号（sec 1 は扉 "EE-00"）。null は枠なし。省略した項目は見ない。
export async function expectResume(page: Page, want: {
    button: string;
    sub?: string;
    slot0?: { loc: string; ratio: number } | null;
    here?: string | null;
}): Promise<void> {
    await expect(page.locator('#idx-cta-btn')).toHaveText(want.button);
    if (want.sub !== undefined) {
        await expect(page.locator('#idx-cta-sub')).toHaveText(want.sub);
        if (want.sub) await expect(page.locator('#idx-topbar-resume span')).toHaveText(want.sub);
    }
    const slot = page.locator('#bookmark-slots .idx-bm-slot--auto');
    if (want.slot0 === null) {
        await expect(slot).toHaveCount(0);
    } else if (want.slot0) {
        await expect(slot.locator('.idx-bm-loc')).toHaveText(want.slot0.loc);
        const ratio = await slot.locator('.idx-bm-ratio').evaluate((m) => (m as HTMLMeterElement).value);
        expect(ratio).toBeCloseTo(want.slot0.ratio, 1);
    }
    const here = page.locator('#episodes-area .idx-chip--here');
    if (want.here === null) {
        await expect(here).toHaveCount(0);
    } else if (want.here) {
        await expect(here).toHaveCount(1);
        await expect(here).toHaveAttribute('href', new RegExp(`${want.here}\\.html`));
        await expect(here).toHaveAttribute('aria-label', /続きから$/);
    }
}

// 書字方向を先に決める（seed の前に呼ぶ。全ページで効く）。
export async function setWritingMode(page: Page, mode: 'vertical' | 'horizontal'): Promise<void> {
    await page.addInitScript((m) => {
        try { localStorage.setItem('lirmena.writingMode', m); } catch { /* noop */ }
    }, mode);
}
