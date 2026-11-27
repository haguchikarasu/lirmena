/*
 * WebKit のときだけ、AVIF の絵の要求を横取りして PNG の中身を返す（e2e 専用）。
 *
 * 理由：Windows 版の Playwright WebKit は AVIF を復号できない（microsoft/playwright#22781・#37708。macOS・Linux 版と
 * 本物の Safari 16 以降は読める）。そのままでは絵が届いても naturalWidth が 0 のままで、「絵が届いた」を見る検査が落ちる。
 * URL は .avif のまま、中身だけ小さい PNG（1×1）に差し替える。WebKit は Content-Type を見て PNG として読む。
 *
 * **WebKit では代用の絵なので、見ているのは「その URL への要求が出て、絵として読めた」ことまで**。本物の AVIF が
 * 壊れていないか・404 でないかは、Chromium と Firefox が見る（両者は差し替えない）。
 *
 * IF:
 *   routeAvifAsPngOnWebKit(page, browserName) … browserName が 'webkit' のときだけ route を張る。他は何もしない
 * 依存: @playwright/test（Page の型だけ）
 */

import type { Page } from '@playwright/test';

// 1×1 の透明な PNG
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/**
 * WebKit のときだけ、.avif への要求に PNG の中身を返す。
 * @param page        対象のページ（goto の前に呼ぶ）
 * @param browserName Playwright の browserName
 */
export async function routeAvifAsPngOnWebKit(page: Page, browserName: string): Promise<void> {
    if (browserName !== 'webkit') return;
    await page.route(/\.avif(\?.*)?$/, (r) => r.fulfill({ contentType: 'image/png', body: PNG_1PX }));
}
