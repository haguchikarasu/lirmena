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
 * 並列：既定オフ（`fullyParallel: false`）。E2E 側で `localStorage` を書き換えるため、
 *      共有ストレージ由来の干渉を避ける（本数が少ないので順次で十分）。
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,
    workers: 1,
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
