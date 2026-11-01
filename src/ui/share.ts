/*
 * ui/share.ts
 * 責務: 共有ポップアップ（#share-popup）の結線。markup は差し込みの断片 templates/parts/share.html が持ち、
 *       ここは「リンクをコピー／X でシェア／LINE でシェア」と閉じる操作（閉じるボタン・背景クリック）だけを結ぶ。
 * export: init(): void / open(): void / close(): void / isOpen(): boolean
 * 依存: DOM（#share-popup と断片の data-share 属性）。ui 層＝reader 層を import しない。
 *       呼び出し元：menu.ts（本文の FAB）、index.ts（目次の FAB）。Escape で閉じる順番は呼び出し側のキー処理が決める
 *       （このモジュールは Escape を拾わない）。
 *
 * 共有 URL は ?dev 等のクエリを落として自ページの正規 URL を出す（dev フラグを読者に渡さないため）。
 * 押したらまずポップアップを閉じてから動作する（別タブが開いても戻ったときに残らない）。
 */

let _popup: HTMLElement | null = null;

// #share-popup の断片に結線する。器が無いページでは何もしない。
// init(): void
export function init(): void {
    _popup = document.getElementById('share-popup');
    if (!_popup) return;
    const popup = _popup;

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

    popup.querySelector('.settings-close')?.addEventListener('click', () => close());
    popup.addEventListener('click', (e) => {
        if (e.target === popup) close();
    });
}

// open(): void / close(): void / isOpen(): boolean
export function open(): void {
    if (_popup) _popup.hidden = false;
}

export function close(): void {
    if (_popup) _popup.hidden = true;
}

export function isOpen(): boolean {
    return _popup !== null && !_popup.hidden;
}
