/*
 * styles エントリの薄い中継。
 * vite.config.ts の input.styles に登録されており、本番ビルドで
 * /lirmena/assets/styles.css （バンドル済み）と /lirmena/assets/styles.js（ほぼ空）を生成する。
 * シェル（public/contents/*.html ・ index.html）は <link href="/lirmena/assets/styles.css"> で参照する。
 * このファイル自身は実行時に何もしない（CSS を import するだけ）。
 */
import './index.css';
