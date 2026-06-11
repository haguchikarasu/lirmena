/*
 * transition.ts
 * 【責務（Phase 4 目標）】ページ離脱フェードの共有ヘルパー（fade-out → location.href）。
 *   遷移の種類（タイトル⇄本文 / sec・ep 境界）に応じて CSS 変数セット（--fade-scene-* / --fade-section-*）を
 *   切り替え、遷移先のフェードインはロード時 CSS で行う。nav.ts / title.ts / menu.ts から呼ばれる。
 * 【依存】なし
 *
 * 【実装状況】マルチページ移行（Phase 1）でシーン遷移調停（DOM 差し替え・背景切替・既読記録）は解体した。
 *   現状ページ境界の移動は各エントリ（nav.ts / title.ts / menu.ts）が location.href を直接使う（フェードなし）。
 *   離脱フェードの実装・結線は Phase 4 で行う。本ファイルはその時点まで空モジュール。
 */

export {};
