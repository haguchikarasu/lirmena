/*
 * 骨格 E2E ⑤：目次側の記録の消去（栞・既読・読破）が独立に対応キーだけを削除し、設定を初期値に戻せる。
 * 要件 06-4「栞・既読・読破の 3 つの消去は独立で、それぞれ栞（bookmarks とオートセーブ）／既読（reached）／読破（read）のみを削除する。
 * どれも取り消せないので、実行前に確認（ui/confirm の <dialog>）を出し、「やめる」・Esc・背景なら何もしない」。
 * 目次 index.ts は unit テストを持たないため、確認 × localStorage 整合の担保はここに置く。
 * 導線は上の帯の ⚙ から開く設定シート（以前の FAB の 3 項目の行き先）と、栞の欄の各行の ×（1 件ずつ・確認つき）。
 */

import { test, expect } from './_fixtures';

// 目次を開く前に localStorage に3種を seed する fixture 拡張。
const seedStorage = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('reached', JSON.stringify(['01-01', '02-02']));
            localStorage.setItem('read', JSON.stringify(['01-01']));
            localStorage.setItem('bookmarks', JSON.stringify([
                { slot: 1, ep: 1, sec: 1, scene: 0, ratio: 0.3, savedAt: 100 },
            ]));
            localStorage.setItem('sceneRead', JSON.stringify(['01-01-00']));
            localStorage.setItem('schemaVersion', '5'); // 移行を走らせない
        } catch { /* noop */ }
    });
};

const readStorage = async (page: import('@playwright/test').Page) => {
    return await page.evaluate(() => ({
        reached: localStorage.getItem('reached'),
        read: localStorage.getItem('read'),
        bookmarks: localStorage.getItem('bookmarks'),
        sceneRead: localStorage.getItem('sceneRead'),
    }));
};

const openSettings = async (page: import('@playwright/test').Page) => {
    await page.locator('#idx-btn-settings').click();
    await expect(page.locator('#settings-popup')).toBeVisible();
};

// 確認の <dialog> が出て「やめる」にフォーカスがあることを確かめてから、okLabel（「削除する」「戻す」）か「やめる」を押す。
const answerConfirm = async (page: import('@playwright/test').Page, button: string): Promise<void> => {
    const dlg = page.locator('#confirm-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'やめる' })).toBeFocused();
    await dlg.getByRole('button', { name: button }).click();
    await expect(dlg).toBeHidden();
};

test.describe('設定シート経由の 3 つの消去 × 確認', () => {
    test.beforeEach(async ({ page }) => {
        await seedStorage(page);
    });

    test('「栞をすべて消す」＋「削除する」で bookmarks とオートセーブを削除・既読・読破は温存', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('autosave', JSON.stringify({ ep: 1, sec: 2, ratio: 0.5, savedAt: 200 })); } catch { /* noop */ }
        });
        await page.goto('/lirmena/');
        await expect(page.locator('#idx-cta-btn')).toHaveText('続きから読む');
        await openSettings(page);
        await page.locator('.settings-action', { hasText: '栞をすべて消す' }).click();
        await expect(page.locator('#confirm-msg')).toHaveText('保存した栞とオートセーブをすべて削除しますか？');
        await answerConfirm(page, '削除する');

        const s = await readStorage(page);
        expect(s.bookmarks).toBeNull();
        // 1 回読むだけだと、負荷の高いときに消える前の値を読んで落ちた（2026-11-03）＝消えるまで待つ
        await expect.poll(() => page.evaluate(() => localStorage.getItem('autosave'))).toBeNull();
        // 目次の「続きから読む」もその場で初めての状態に戻る
        await expect(page.locator('#idx-cta-btn')).toHaveText('第一話から読む');
        expect(s.reached).not.toBeNull();
        expect(s.read).not.toBeNull();
        expect(s.sceneRead).not.toBeNull();
        // 確認を閉じても設定シートは開いたまま（確認はシートの上に重なっていた）
        await expect(page.locator('#settings-popup')).toBeVisible();
    });

    test('「既読を消す」＋「削除する」で reached と sceneRead のみ削除・他は温存', async ({ page }) => {
        await page.goto('/lirmena/');
        await openSettings(page);
        await page.locator('.settings-action', { hasText: '既読を消す' }).click();
        await answerConfirm(page, '削除する');

        const s = await readStorage(page);
        expect(s.reached).toBeNull();
        expect(s.sceneRead).toBeNull();
        expect(s.read).not.toBeNull();
        expect(s.bookmarks).not.toBeNull();
    });

    test('「読破を消す」＋「削除する」で read と sceneRead を削除・reached / bookmarks は温存', async ({ page }) => {
        await page.goto('/lirmena/');
        await openSettings(page);
        await page.locator('.settings-action', { hasText: '読破を消す' }).click();
        await answerConfirm(page, '削除する');

        const s = await readStorage(page);
        expect(s.read).toBeNull();
        // sceneRead も削除（loadReadSections が完了マーカーから読破を復活させないため）
        expect(s.sceneRead).toBeNull();
        expect(s.reached).not.toBeNull();
        expect(s.bookmarks).not.toBeNull();
    });

    test('「やめる」・Esc・背景なら 3 つのどれを押しても何も消えない', async ({ page }) => {
        await page.goto('/lirmena/');
        await openSettings(page);
        const dlg = page.locator('#confirm-dialog');

        await page.locator('.settings-action', { hasText: '栞をすべて消す' }).click();
        await answerConfirm(page, 'やめる');

        await page.locator('.settings-action', { hasText: '既読を消す' }).click();
        await expect(dlg).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
        // Esc は確認だけを閉じる（一番上の <dialog> から閉じる）。設定シートは残る
        await expect(page.locator('#settings-popup')).toBeVisible();

        await page.locator('.settings-action', { hasText: '読破を消す' }).click();
        await expect(dlg).toBeVisible();
        await page.mouse.click(5, 5);   // 確認の外＝背景
        await expect(dlg).toBeHidden();

        const s = await readStorage(page);
        expect(s.bookmarks).not.toBeNull();
        expect(s.reached).not.toBeNull();
        expect(s.read).not.toBeNull();
        expect(s.sceneRead).not.toBeNull();
    });

    test('「設定を初期値に戻す」は確認に読書点の添え書きを出し、「戻す」で設定のキーを消す', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lirmena.writingMode', 'vertical'); } catch { /* noop */ }
        });
        await page.goto('/lirmena/');
        await openSettings(page);
        await page.locator('.settings-action', { hasText: '設定を初期値に戻す' }).click();
        await expect(page.locator('#confirm-note')).toHaveText('読書点の位置も初期値に戻ります。');
        await answerConfirm(page, '戻す');
        expect(await page.evaluate(() => localStorage.getItem('lirmena.writingMode'))).toBeNull();
    });
});

test.describe('栞の欄の × × 確認（1 件ずつ消す）', () => {
    test.beforeEach(async ({ page }) => {
        await seedStorage(page);
        await page.addInitScript(() => {
            try { localStorage.setItem('autosave', JSON.stringify({ ep: 1, sec: 2, ratio: 0.5, savedAt: 200 })); } catch { /* noop */ }
        });
    });

    test('手動栞の行の × ＋「削除する」でその栞だけ消え、行は空きに戻る', async ({ page }) => {
        await page.goto('/lirmena/');
        const del = page.getByRole('button', { name: '栞 1を消す' });
        await del.click();
        await expect(page.locator('#confirm-msg')).toHaveText('栞 1（第1話#1）を削除しますか？');
        await answerConfirm(page, '削除する');

        const s = await readStorage(page);
        expect(s.bookmarks).toBeNull();
        expect(s.reached).not.toBeNull();
        expect(await page.evaluate(() => localStorage.getItem('autosave'))).not.toBeNull();
        await expect(page.locator('#bookmark-slots .idx-bm-slot--empty')).toHaveCount(3);
    });

    test('オートセーブの行の × ＋「やめる」なら消えず、「削除する」で消えて「続きから読む」も無くなる', async ({ page }) => {
        await page.goto('/lirmena/');
        await expect(page.locator('#idx-cta-btn')).toHaveText('続きから読む');
        const del = page.getByRole('button', { name: 'オートセーブを消す' });
        await del.click();
        await answerConfirm(page, 'やめる');
        expect(await page.evaluate(() => localStorage.getItem('autosave'))).not.toBeNull();

        await del.click();
        await answerConfirm(page, '削除する');
        // 1 回読むだけだと、負荷の高いときに消える前の値を読んで落ちた（2026-11-03）＝消えるまで待つ
        await expect.poll(() => page.evaluate(() => localStorage.getItem('autosave'))).toBeNull();
        await expect(page.locator('#bookmark-slots .idx-bm-slot--auto')).toHaveCount(0);
        await expect(page.locator('#idx-cta-btn')).toHaveText('第一話から読む');
    });
});
