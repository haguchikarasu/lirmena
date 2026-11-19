/*
 * test-support/dialog-stub.ts
 * 責務: 単体テスト（jsdom）用の <dialog> の代用。jsdom は showModal()・close() を持たないので、
 *       「open 属性の付け外し」と「close イベント」だけを HTMLDialogElement.prototype に置く。
 * export: installDialogStub(): () => void … 代用を置き、元に戻す関数を返す（afterEach で呼ぶ）
 * 依存: DOM（jsdom）だけ。本体のコードからは import しない（テスト専用）。
 *
 * 代用が再現するもの：showModal() で open 属性が付く／close() で open 属性が外れ、close イベントが 1 回出る
 *   （閉じているものを close() しても何も起きない）。
 * 代用が再現しないもの：最前面の層（top layer）、フォーカスの閉じ込めと autofocus、Esc で閉じる処理、
 *   ブラウザ自身の closedby。これらは e2e（実ブラウザ）で見る。
 * jsdom には closedBy も無いので、代用を置いた jsdom は「closedby 未対応のブラウザ」と同じ条件になる
 *   ＝背景クリックで閉じるテストは、手書きの判定（フォールバック）が働いていることの検査になる。
 * 全テストに自動では置かない（setupFiles にしない）：settings.test.ts は「showModal が無ければ window.confirm に
 *   落ちる」ことを使っているので、要るテストだけが明示して置く。
 */

type DialogProto = { showModal?: () => void; close?: () => void };

// installDialogStub(): () => void
export function installDialogStub(): () => void {
    const proto = HTMLDialogElement.prototype as unknown as DialogProto;
    const hadShowModal = Object.prototype.hasOwnProperty.call(proto, 'showModal');
    const hadClose = Object.prototype.hasOwnProperty.call(proto, 'close');
    const origShowModal = proto.showModal;
    const origClose = proto.close;

    proto.showModal = function (this: HTMLDialogElement): void {
        this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement): void {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
    };

    return () => {
        if (hadShowModal) proto.showModal = origShowModal; else delete proto.showModal;
        if (hadClose) proto.close = origClose; else delete proto.close;
    };
}
