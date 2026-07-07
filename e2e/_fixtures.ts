/*
 * e2e 共通 fixture。plan Phase 3 の骨格スモークでは初回訪問扱いのチュートリアルポップアップが
 * ほぼ全ページでオーバーレイし、メニュー・末尾ボタンのクリックを阻害する。初回導線そのものを
 * テストするわけではないので、addInitScript で `lirmena.tutorialSeen=1` を先付けて回避する。
 * 各 spec は `@playwright/test` の代わりにこのファイルから test/expect を import する。
 */

import { test as base, expect } from '@playwright/test';

export const test = base.extend({
    page: async ({ page }, use) => {
        await page.addInitScript(() => {
            try {
                localStorage.setItem('lirmena.tutorialSeen', '1');
            } catch { /* noop */ }
        });
        await use(page);
    },
});

export { expect };
