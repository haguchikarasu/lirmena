/*
 * ui/confirm.ts
 * 責務: 消す・初期値に戻す操作の前の確認（#confirm-dialog）。markup は差し込みの断片 templates/parts/confirm.html。
 * export: confirmDialog(message: string, okLabel: string, note?: string): Promise<boolean>
 * 依存: DOM（#confirm-dialog）。ui 層＝reader 層を import しない。
 *       呼び出し元：ui/settings-panel（記録の消去 3 つと「設定を初期値に戻す」）、index.ts（目次の FAB の記録の消去）。
 *
 * 振る舞い（要件 06-4）：
 *   - showModal() で開く＝シートの上にも重なり、裏は操作できない
 *   - 開いたら「やめる」にフォーカスを置く（押し間違えにくい側。Enter で押されるのもこちら）。
 *     マウスで開いても枠が見えるよう、CSS は :focus で枠を出す（:focus-visible だけだとクリックでは出ない）
 *   - Esc・背景・「やめる」は false、確定ボタンは true
 *   - 断片が無いページ（差し込み漏れ・単体テストの jsdom）では window.confirm() に落とす＝確認を飛ばして消すことはしない
 */

// confirmDialog(message: string, okLabel: string, note?: string): Promise<boolean>
// message は 1 行の問い、note は添え書き（「初期値に戻す」の「読書点の位置も初期値に戻ります。」など）。
export function confirmDialog(message: string, okLabel: string, note?: string): Promise<boolean> {
    const dlg = document.getElementById('confirm-dialog');
    if (!(dlg instanceof HTMLDialogElement) || typeof dlg.showModal !== 'function') {
        return Promise.resolve(window.confirm(note ? `${message}\n${note}` : message));
    }
    const msg = dlg.querySelector<HTMLElement>('.confirm-msg');
    const noteEl = dlg.querySelector<HTMLElement>('.confirm-note');
    const cancel = dlg.querySelector<HTMLButtonElement>('[data-confirm="0"]');
    const ok = dlg.querySelector<HTMLButtonElement>('[data-confirm="1"]');
    if (msg) msg.textContent = message;
    if (noteEl) {
        noteEl.textContent = note ?? '';
        noteEl.hidden = !note;
    }
    if (ok) ok.textContent = okLabel;

    return new Promise((resolve) => {
        let result = false;
        const onClick = (e: MouseEvent): void => {
            const b = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-confirm]');
            if (b) {
                result = b.dataset.confirm === '1';
                dlg.close();
                return;
            }
            // 背景（::backdrop）を押したときのクリックは dialog 自身に来る。器の外なら背景
            if (e.target === dlg) {
                const r = dlg.getBoundingClientRect();
                if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
            }
        };
        const onClose = (): void => {
            dlg.removeEventListener('click', onClick);
            resolve(result);
        };
        dlg.addEventListener('click', onClick);
        dlg.addEventListener('close', onClose, { once: true });
        dlg.showModal();
        cancel?.focus();
    });
}
