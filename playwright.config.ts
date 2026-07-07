/*
 * Playwright スモーク骨格の設定。
 *
 * ねらい：ロジック層は vitest（jsdom）で押さえ、DOM/CSS 連動の骨格導線だけを実ブラウザで撫でて
 * 「表示が丸ごと壊れた」レベルの回帰を検出する。全面 UI 網羅は狙わない（重いので）。
 *
 * 対象：`vite preview` が返す本番ビルド（base=/lirmena/、port=4174）。dev サーバの HMR は避ける。
 * webServer.command は `build && preview` で、テスト起動時にビルドを最新化する（キャッシュ効くので 2 回目以降は速い）。
 *
 * ブラウザ：chromium のみ（DL 容量を最小化）。CI 接続はしない（ローカル既定・重いので当面外す）。
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
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
