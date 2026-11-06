/*
 * ui/hold-badge.ts
 * 責務: 記録を止めているときの札（#badge-hold）と、その説明のシート（#hold-popup）の結線（要件 06-6「記録を止めているときの札」）。
 *       markup は templates/reader.html、見た目は _misc.css。出すかどうかは main.ts が決める（本文ページだけ。あとがきでは呼ばれない）。
 * export: init(): void / setVisible(on: boolean): void
 * 依存: ui/sheet（説明のシートの器）。DOM。ui 層＝reader 層を import しない。
 */

import * as sheet from './sheet';

// 札を押すと説明を開くように結ぶ。main.ts が本文モードの起動時に 1 度だけ呼ぶ。
// init(): void
export function init(): void {
    const badge = document.getElementById('badge-hold');
    const popup = document.getElementById('hold-popup');
    if (!badge || !(popup instanceof HTMLDialogElement)) return;
    sheet.init(popup);
    badge.addEventListener('click', () => sheet.open(popup, { opener: badge }));
}

// 札の表示を切り替える。保留中で最前線でない本文ページのときだけ出す。
// setVisible(on: boolean): void
export function setVisible(on: boolean): void {
    const badge = document.getElementById('badge-hold');
    if (badge) badge.hidden = !on;
}
