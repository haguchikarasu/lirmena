/*
 * Playwright スモーク骨格の設定。
 *
 * ねらい：ロジック層は vitest（jsdom）で押さえ、DOM/CSS 連動の骨格導線だけを実ブラウザで撫でて
 * 「表示が丸ごと壊れた」レベルの回帰を検出する。全面 UI 網羅は狙わない（重いので）。
 *
 * 対象：`vite preview` が返す本番ビルド（base=/lirmena/、port=4174）。dev サーバの HMR は避ける。
 * webServer.command は `build && preview` で、テスト起動時にビルドを最新化する（キャッシュ効くので 2 回目以降は速い）。
 *
 * ブラウザ：Chromium・Firefox（Gecko）・WebKit の 3 つで全件を回す（2026-11-26〜。それまでは chromium のみ）。
 * Chromium でしか効かない修正を見逃さないため（v4.2.3 の裏のスクロール止めが実際にそうだった）。
 * 1 つだけ回すときは `--project=chromium`（`firefox`・`webkit`）。
 * **Firefox と WebKit は、Claude の外のターミナルで入れる**（`npx playwright install firefox webkit`）。Claude の
 * デスクトップアプリの中から入れると、置き場所が振り替えられて Firefox が起動できない（`spawn UNKNOWN`）。
 * `test:e2e` のスクリプトが自動で入れるのは chromium だけ。
 * ブラウザによって今は通らない検査は、e2e/_browser-gaps.ts の表に載せて、そのブラウザでだけ飛ばす（_fixtures.ts）。
 * Playwright の WebKit は Windows 向けに組まれたもので、本物の Safari と完全には一致しない。
 * CI 接続はしない（ローカル既定・重いので当面外す）。
 *
 * 並列：ワーカー 3 本（2026-11-27〜。それまでは 1 本）。ファイル×ブラウザの単位で並べ、同じファイルの中は順番に回す
 *      （`fullyParallel: false`）。検査は 1 件ごとに新しいブラウザコンテキストで動くので、`localStorage` は検査のあいだで
 *      共有されない＝並べても干渉しない。全件を 1 本と 3 本で回し比べて、結果が同じ（842 通過・40 スキップ・失敗 0）で
 *      22.0 分が 14.6 分になることを確かめた。3 より増やさないのは、ブラウザ 3 種を同時に立てるとメモリを食うため。
 *      タイミングで揺れる検査を切り分けるときは `--workers=1` で回す。
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,
    workers: 3,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:4174/lirmena/',
        trace: 'retain-on-failure',
        video: 'off',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
    webServer: {
        // 毎回 build して preview を起動する。reuseExistingServer は false 固定：
        // true にすると port 4174 で残っている古い preview を再利用してしまい、
        // 直近のコード変更が反映されない（＝壊れが赤にならない）。ローカルで数秒余分にビルドしても
        // 「テストで検出できないバグ」より遥かにマシ。
        command: 'npm run build && npm run preview',
        url: 'http://127.0.0.1:4174/lirmena/',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
