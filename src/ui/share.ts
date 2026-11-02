/*
 * ui/share.ts
 * 責務: 共有シート（#share-popup）の結線。markup は差し込みの断片 templates/parts/share.html が持ち、
 *       ここは「リンクをコピー／X でシェア／LINE でシェア」の 3 つだけを結ぶ（開閉・背景・閉じるボタン・Escape は ui/sheet）。
 * export: init(): void / open(opener?: HTMLElement | null): void / close(): void / isOpen(): boolean
 * 依存: ui/sheet。DOM（#share-popup と断片の data-share 属性）。ui 層＝reader 層を import しない。
 *       呼び出し元：menu.ts（本文の FAB）、index.ts（目次の FAB）。
 *
 * 共有 URL は ?dev 等のクエリを落として自ページの正規 URL を出す（dev フラグを読者に渡さないため）。
 * 押したらまずポップアップを閉じてから動作する（別タブが開いても戻ったときに残らない）。
 */

import * as sheet from './sheet';

let _popup: HTMLDialogElement | null = null;

// #share-popup の断片に結線する。器が無いページでは何もしない。
// init(): void
export function init(): void {
    const el = document.getElementById('share-popup');
    _popup = el instanceof HTMLDialogElement ? el : null;
    if (!_popup) return;
    const popup = _popup;
    sheet.init(popup);

    const shareUrl = (): string => location.origin + location.pathname;
    const actions: Record<string, () => void> = {
        copy: () => { navigator.clipboard.writeText(shareUrl()).catch(() => {}); },
        x: () => {
            window.open(`https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl())}`, '_blank', 'noopener,noreferrer');
        },
        line: () => {
            window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl())}`, '_blank', 'noopener,noreferrer');
        },
    };
    for (const btn of popup.querySelectorAll<HTMLButtonElement>('[data-share]')) {
        const run = actions[btn.dataset.share ?? ''];
        if (!run) continue;
        btn.addEventListener('click', () => { close(); run(); });
    }
}

// open(opener?: HTMLElement | null): void / close(): void / isOpen(): boolean
// opener には閉じたときにフォーカスを戻す要素を渡す（メニューの項目は閉じたパネルの中にいる）。
export function open(opener?: HTMLElement | null): void {
    if (_popup) sheet.open(_popup, { opener });
}

export function close(): void {
    if (_popup) sheet.close(_popup);
}

export function isOpen(): boolean {
    return sheet.isOpen(_popup);
}
