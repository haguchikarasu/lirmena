/*
 * ui/confirm.test.ts
 * 対象: ui/confirm.ts の confirmDialog()——消す・初期値に戻す前の確認（#confirm-dialog）の結果と後始末。
 * 方針: 期待値は要件 06-4（確認の文言）・design/modules/sheet.md「確認（ui/confirm）」・confirm.ts 冒頭の IF コメントから導く
 *   （実装をなぞらない）。これから <dialog> まわり（closedby="any" の導入など）を作り替えるので、その前に今の仕様を固定する安全網。
 *   **確認を飛ばして消すことはしない**（どの閉じ方でも結果が決まる／断片が無ければ window.confirm に落ちる）がいちばん大事な不変条件。
 * 環境: jsdom。markup は実物の断片 templates/parts/confirm.html を readFileSync で読んで document.body に入れる（手で写さない）。
 *   jsdom には showModal()・close() が無いので test-support/dialog-stub の代用を置く（「代用なし」の検査だけは置かない）。
 *   getBoundingClientRect は全部 0 を返すので、器の矩形は vi.spyOn で与える。
 *   **jsdom には closedBy も無いので、背景クリックのテストは「closedby 未対応のブラウザで手書きの判定が閉じる」ことの検査になる。
 *   この判定（confirm.ts の `if (e.target === dlg) {…}`）を消すとここが赤になる。**
 *   Esc は代用では再現できないので、「Esc で閉じたとき」＝ dlg.close() で close イベントだけが出た場合として見る。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { confirmDialog } from './confirm';
import { installDialogStub } from '../test-support/dialog-stub';

const FRAGMENT = readFileSync(resolve(__dirname, '../../templates/parts/confirm.html'), 'utf-8');

// 器の矩形（画面の真ん中の小さなカード）。外＝背景、内＝器の中
const RECT = { left: 100, top: 200, right: 300, bottom: 320, width: 200, height: 120, x: 100, y: 200 };

const dlg = () => document.getElementById('confirm-dialog') as HTMLDialogElement;
const okBtn = () => dlg().querySelector<HTMLButtonElement>('[data-confirm="1"]')!;
const cancelBtn = () => dlg().querySelector<HTMLButtonElement>('[data-confirm="0"]')!;
const msgEl = () => dlg().querySelector<HTMLElement>('.confirm-msg')!;
const noteEl = () => dlg().querySelector<HTMLElement>('.confirm-note')!;

// マイクロタスクを回して、Promise が決まっていれば決まった状態にする
const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

// Promise がまだ決まっていないか（決まっていれば値を返す）
function track<T>(p: Promise<T>): { settled: () => boolean; value: () => T | undefined } {
    let done = false;
    let v: T | undefined;
    void p.then((x) => { done = true; v = x; });
    return { settled: () => done, value: () => v };
}

// dialog 自身に来るクリック（背景／器の余白）。clientX/Y を指定する
function clickDialogAt(x: number, y: number): void {
    dlg().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

describe('断片と <dialog> がある環境', () => {
    let restore: () => void;
    beforeEach(() => {
        restore = installDialogStub();
        document.body.innerHTML = FRAGMENT;
        vi.spyOn(dlg(), 'getBoundingClientRect').mockReturnValue(RECT as DOMRect);
    });
    afterEach(() => {
        restore();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    // 仕様（IF コメント「Esc・背景・『やめる』は false、確定ボタンは true」／sheet.md「確認」）
    describe('閉じ方ごとの結果', () => {
        it('確定ボタンで true になり、閉じる', async () => {
            const p = confirmDialog('しおりをすべて削除しますか？', '削除する');
            expect(dlg().open).toBe(true);
            okBtn().click();
            await expect(p).resolves.toBe(true);
            expect(dlg().open).toBe(false);
        });

        it('「やめる」で false になり、閉じる', async () => {
            const p = confirmDialog('しおりをすべて削除しますか？', '削除する');
            cancelBtn().click();
            await expect(p).resolves.toBe(false);
            expect(dlg().open).toBe(false);
        });

        it('Esc 相当（close イベントだけが出る）で false', async () => {
            const p = confirmDialog('しおりをすべて削除しますか？', '削除する');
            dlg().close();
            await expect(p).resolves.toBe(false);
        });

        it('背景（dialog 自身へのクリックで、座標が器の矩形の外）で false になり、閉じる', async () => {
            const p = confirmDialog('しおりをすべて削除しますか？', '削除する');
            clickDialogAt(10, 10);
            await expect(p).resolves.toBe(false);
            expect(dlg().open).toBe(false);
        });

        it('背景は上下左右のどの外側でも背景（右・下の外）', async () => {
            const p1 = confirmDialog('問い', '削除する');
            clickDialogAt(RECT.right + 1, 250);
            await expect(p1).resolves.toBe(false);
            const p2 = confirmDialog('問い', '削除する');
            clickDialogAt(200, RECT.bottom + 1);
            await expect(p2).resolves.toBe(false);
        });
    });

    // 仕様（IF コメント「背景は false」の裏側：器の中を押しても閉じない＝確定もやめるも選ばれていない）
    describe('器の中のクリックでは閉じない', () => {
        it('dialog 自身へのクリックでも、座標が器の矩形の内側なら閉じない（Promise は未解決）', async () => {
            const t = track(confirmDialog('問い', '削除する'));
            clickDialogAt(200, 250);
            await flush();
            expect(dlg().open).toBe(true);
            expect(t.settled()).toBe(false);
        });

        it('文言（子要素）のクリックでは閉じない', async () => {
            const t = track(confirmDialog('問い', '削除する', '添え書き'));
            msgEl().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
            noteEl().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
            await flush();
            expect(dlg().open).toBe(true);
            expect(t.settled()).toBe(false);
        });
    });

    // 仕様（IF コメント「開いたら『やめる』にフォーカスを置く（押し間違えにくい側）」）
    describe('フォーカス', () => {
        it('開いた直後のフォーカスは「やめる」', () => {
            void confirmDialog('問い', '削除する');
            expect(document.activeElement).toBe(cancelBtn());
        });
    });

    // 仕様（IF コメント「message は 1 行の問い、note は添え書き」／要件 06-4 の文言）
    describe('文言', () => {
        it('問いの文言と確定ボタンの名前が入る', () => {
            void confirmDialog('表示の設定を初期値に戻しますか？', '戻す');
            expect(msgEl().textContent).toBe('表示の設定を初期値に戻しますか？');
            expect(okBtn().textContent).toBe('戻す');
            expect(cancelBtn().textContent).toBe('やめる');
        });

        it('添え書きは渡したときだけ見え、次に添え書き無しで開くと隠れて文字も残らない', async () => {
            const p1 = confirmDialog('表示の設定を初期値に戻しますか？', '戻す', '読書点の位置も初期値に戻ります。');
            expect(noteEl().hidden).toBe(false);
            expect(noteEl().textContent).toBe('読書点の位置も初期値に戻ります。');
            cancelBtn().click();
            await p1;

            void confirmDialog('しおりをすべて削除しますか？', '削除する');
            expect(noteEl().hidden).toBe(true);
            expect(noteEl().textContent).toBe('');
            expect(okBtn().textContent).toBe('削除する');
        });

        it('最初から添え書き無しなら隠れたまま', () => {
            void confirmDialog('問い', '削除する');
            expect(noteEl().hidden).toBe(true);
        });
    });

    // 仕様（同じ器を何度も開く：前回の結果・前回のリスナーを持ち越すと、やめたのに消える／確定したのにやめる になる）
    describe('続けて開く', () => {
        it('1 回目で確定 → 2 回目で「やめる」は false', async () => {
            const p1 = confirmDialog('問い', '削除する');
            okBtn().click();
            await expect(p1).resolves.toBe(true);
            const p2 = confirmDialog('問い', '削除する');
            cancelBtn().click();
            await expect(p2).resolves.toBe(false);
        });

        it('1 回目でやめる → 2 回目で確定は true', async () => {
            const p1 = confirmDialog('問い', '削除する');
            cancelBtn().click();
            await expect(p1).resolves.toBe(false);
            const p2 = confirmDialog('問い', '削除する');
            okBtn().click();
            await expect(p2).resolves.toBe(true);
        });

        it('1 回目で確定 → 2 回目は Esc 相当で false（前回の true を持ち越さない）', async () => {
            const p1 = confirmDialog('問い', '削除する');
            okBtn().click();
            await p1;
            const p2 = confirmDialog('問い', '削除する');
            dlg().close();
            await expect(p2).resolves.toBe(false);
        });

        it('閉じたあと、開いている間に付けた click・close のリスナーはすべて外れている', async () => {
            const d = dlg();
            const added: { type: string; fn: EventListenerOrEventListenerObject }[] = [];
            const removed = new Set<EventListenerOrEventListenerObject>();
            const origAdd = d.addEventListener.bind(d);
            const origRemove = d.removeEventListener.bind(d);
            vi.spyOn(d, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) => {
                if (fn) added.push({ type, fn });
                origAdd(type, fn, o);
            });
            vi.spyOn(d, 'removeEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) => {
                if (fn) removed.add(fn);
                origRemove(type, fn, o);
            });
            // close の { once: true } は自分で外れるので、close 以外（click）が removeEventListener されたかを見る
            const p = confirmDialog('問い', '削除する');
            okBtn().click();
            await p;
            const clicks = added.filter((a) => a.type === 'click');
            expect(clicks.length).toBeGreaterThan(0);
            for (const c of clicks) expect(removed.has(c.fn)).toBe(true);

            // 閉じたあとに close が出ても、決まった結果は変わらない（2 回目の close リスナーは残っていない）
            const p2 = confirmDialog('問い', '削除する');
            cancelBtn().click();
            await expect(p2).resolves.toBe(false);
            await expect(p).resolves.toBe(true);
        });
    });
});

// 仕様（IF コメント「断片が無いページ（差し込み漏れ・単体テストの jsdom）では window.confirm() に落とす
//   ＝確認を飛ばして消すことはしない」／sheet.md「確認」）
describe('window.confirm に落ちる', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('断片が無いページでは window.confirm に落ち、戻り値（true）がそのまま返る', async () => {
        const restore = installDialogStub();
        try {
            document.body.innerHTML = '';
            const spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
            await expect(confirmDialog('しおりをすべて削除しますか？', '削除する')).resolves.toBe(true);
            expect(spy).toHaveBeenCalledWith('しおりをすべて削除しますか？');
        } finally {
            restore();
        }
    });

    it('showModal が無い環境（代用を置かない jsdom）では、断片があっても window.confirm に落ちる（false がそのまま返る）', async () => {
        document.body.innerHTML = FRAGMENT;
        const spy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await expect(confirmDialog('問い', '削除する')).resolves.toBe(false);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(document.getElementById('confirm-dialog')!.hasAttribute('open')).toBe(false);
    });

    it('添え書きは改行でつないで渡る', async () => {
        const spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        await confirmDialog('表示の設定を初期値に戻しますか？', '戻す', '読書点の位置も初期値に戻ります。');
        expect(spy).toHaveBeenCalledWith('表示の設定を初期値に戻しますか？\n読書点の位置も初期値に戻ります。');
    });
});
