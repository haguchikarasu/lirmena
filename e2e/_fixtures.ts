/*
 * e2e 共通 fixture。plan Phase 3 の骨格スモークでは初回訪問扱いのチュートリアルポップアップが
 * ほぼ全ページでオーバーレイし、メニュー・末尾ボタンのクリックを阻害する。初回導線そのものを
 * テストするわけではないので、addInitScript で `lirmena.tutorialSeen=1` を先付けて回避する。
 * 初回の読み方ダイアログ（firstrun.ts）も同じ理由で `lirmena.presetAsked=1` を先付ける。
 * 各 spec は `@playwright/test` の代わりにこのファイルから test/expect を import する。
 * **初回導線そのものを見る `firstrun.spec.ts` だけは、この fixture を使わず `@playwright/test` を直接 import する。**
 *
 * もう 1 つの役目：**ブラウザごとの「未対応」の検査を飛ばす**（browserGap。自動で全検査に掛かる）。
 * e2e は Chromium・Firefox・WebKit の 3 つで回す。_browser-gaps.ts の表に載っている検査は、載っているブラウザでだけ
 * fixme になる（理由はレポートに出る）。直したら表から行を消す。`firstrun.spec.ts` にはこの仕組みは掛からない
 * （表に載せる必要が出たら、そのファイルの中で同じ判定を呼ぶ）。
 * 依存: ./_browser-gaps（表と検索）
 */

import { test as base, expect } from '@playwright/test';
import { findBrowserGap } from './_browser-gaps';

export const test = base.extend<{ browserGap: void }>({
    page: async ({ page }, use) => {
        await page.addInitScript(() => {
            try {
                localStorage.setItem('lirmena.tutorialSeen', '1');
                localStorage.setItem('lirmena.presetAsked', '1');
            } catch { /* noop */ }
        });
        await use(page);
    },
    // 表に載っている検査を、該当のブラウザでだけ fixme にする。auto＝各検査が名指ししなくても掛かる
    browserGap: [async ({ browserName }, use, testInfo) => {
        const gap = findBrowserGap(testInfo.file, testInfo.title, browserName);
        testInfo.fixme(gap !== undefined, gap ? `${browserName} では未対応：${gap.reason}` : undefined);
        await use();
    }, { auto: true }],
});

export { expect };
