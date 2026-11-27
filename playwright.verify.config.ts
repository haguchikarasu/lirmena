/*
 * 検証用の Playwright 設定（2026-11-27〜）。`playwright.config.ts` と同じ検査を、別のビルド・別のポートに向けて回す。
 *
 * ねらい：e2e を、作者の目視（`起動.bat` の 4174・5173）と同時に回せるようにする。
 *   - 既定の設定は 4174 を使い、毎回 `dist/` をビルドし直す。4174 は `起動.bat` の preview が使っているので、
 *     同時には回せない。`dist/` も共有なので、検査の最中にビルドすると見ているページが変わる。
 *   - この設定は `dist-verify/`（追跡しない）を 4186 で配信したものを見る。`dist/` と 4174 には触らない。
 *
 * 使い方（`lirmena/` で）：
 *   npm run build:verify     … 型検査のあと dist-verify/ にビルドする
 *   npm run preview:verify   … dist-verify/ を 4186 で配信する（終わったら止める）
 *   npm run test:e2e:verify  … この設定で e2e を回す（ファイル名や --project を後ろに付けられる）
 * 見た目の比較（tool/visual-baseline/capture.mjs）も既定で 4186 を見るので、同じ preview を相手に同時に回せる。
 *
 * サーバは立てない（webServer を外す）＝先に preview:verify を立てておく。ビルドし直したら preview は立て直さなくてよい
 * （`vite preview` は配信のたびにファイルを読む）が、検査の最中にはビルドしない。
 */

import base from './playwright.config';

export default {
    ...base,
    use: { ...base.use, baseURL: 'http://127.0.0.1:4186/lirmena/' },
    webServer: undefined,
};
