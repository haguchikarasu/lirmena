/*
 * 背景の取得の優先度 E2E（bg.ts の _prefetchAround）。
 *
 * 背景は全レイヤーが画面いっぱいに重なっているので、ブラウザからはどれも「見えている絵」に見える。
 * 指定が無いと、空き時間に先読みする遠くの絵も、いま読んでいる場面の絵と同じ優先度に上がって回線を取り合う。
 * そこで、いまの場面の近く（±PRIORITY_RADIUS）以外には fetchpriority="low" を付けて取得する。
 * jsdom は画像を取得しないので、付いた属性と、実際に取得が起きたことを実ブラウザで見る。
 */

import { test, expect } from './_fixtures';

test('本文ページ：いまの場面の近くの背景は既定の優先度、空き時間に先読みする背景は fetchpriority="low" で取得する', async ({ page }) => {
    await page.goto('/lirmena/contents/01-01.html');
    await expect(page.locator('#main-container')).toBeVisible();

    // 空き時間の先読みが始まり（low の付いた絵がある）、絵を持つレイヤーが全部読み込まれるまで待つ。
    // 黒いレイヤーは src を持たない。背景の初期化（bg.init）は本文が見えた後に走ることがあるので、
    // 「絵がまだ 1 枚も無い」「近くの絵だけ届いた」状態を読み込み済みと見なさない
    const layers = page.locator('#bg-stack .bg-layer');
    await expect.poll(async () => layers.evaluateAll((els) => {
        const withSrc = (els as HTMLImageElement[]).filter((el) => el.getAttribute('src'));
        return withSrc.some((el) => el.getAttribute('fetchpriority') === 'low')
            && withSrc.every((el) => el.complete && el.naturalWidth > 0);
    }), { timeout: 15_000 }).toBe(true);

    const state = await layers.evaluateAll((els) => (els as HTMLImageElement[])
        .filter((el) => el.getAttribute('src'))
        .map((el) => el.getAttribute('fetchpriority')));
    // 開幕（場面 1）の近くの絵は指定なし、残りは low。両方があること（01-01 は場面が十分に多い）
    expect(state.filter((p) => p === null).length).toBeGreaterThan(0);
    expect(state.filter((p) => p === 'low').length).toBeGreaterThan(0);
    // 近くの絵が先に並ぶ（開幕では先頭側が近い）
    expect(state.indexOf('low')).toBeGreaterThan(state.lastIndexOf(null));
});
