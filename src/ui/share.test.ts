/*
 * ui/share.test.ts
 * 対象: ui/share.ts の共有シート（リンクをコピー／X でポスト／LINE でシェア）の結線と open / close / isOpen。
 * 方針: 期待値は share.ts 冒頭の IF コメントから導く（仕様駆動）。
 *   共有 URL は ?dev 等のクエリと # を落とした正規 URL（location.origin + location.pathname）。
 *   押したらまずシートを閉じてから動作する。markup は実物の断片 templates/parts/share.html を読んで入れる。
 *   リファクタリング前の安全網＝今の仕様をそのまま置く。
 * 環境: jsdom。<dialog> は test-support/dialog-stub の代用。モジュールの状態（_popup）はテストごとに
 *   vi.resetModules() して動的 import し直して戻す。navigator.clipboard は jsdom に無いので置く。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDialogStub } from '../test-support/dialog-stub';

const SHARE_HTML = readFileSync(resolve(__dirname, '../../templates/parts/share.html'), 'utf-8');

async function load(): Promise<typeof import('./share')> {
    vi.resetModules();
    return import('./share');
}

const btn = (kind: string) => document.querySelector<HTMLButtonElement>(`[data-share="${kind}"]`)!;
const OPEN_ARGS = ['_blank', 'noopener,noreferrer'];

let restoreDialog: () => void;
let writeText: ReturnType<typeof vi.fn>;
let openSpy: ReturnType<typeof vi.fn>;
const origOpen = window.open;

beforeEach(() => {
    restoreDialog = installDialogStub();
    document.body.innerHTML = SHARE_HTML;
    history.replaceState(null, '', '/contents/vol01-ep01-sec01.html?dev=1#scene2');
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    openSpy = vi.fn(() => null);
    window.open = openSpy as unknown as typeof window.open;
});
afterEach(() => {
    restoreDialog();
    window.open = origOpen;
    Reflect.deleteProperty(navigator, 'clipboard');
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
});

const SHARE_URL = () => location.origin + '/contents/vol01-ep01-sec01.html';

describe('3 つの動作', () => {
    it('リンクをコピー：writeText に origin + pathname が渡る（?dev=1 と # は落ちる）', async () => {
        const share = await load();
        share.init();
        btn('copy').click();
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith(SHARE_URL());
    });

    it('リンクをコピー：writeText が reject しても例外が外に漏れない', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        writeText.mockImplementation(() => Promise.reject(new Error('denied')));
        const share = await load();
        share.init();
        expect(() => btn('copy').click()).not.toThrow();
        await new Promise((r) => setTimeout(r, 0));
        expect(unhandled).not.toHaveBeenCalled();
        process.off('unhandledRejection', unhandled);
    });

    it('X でポスト：window.open に intent の URL・_blank・noopener,noreferrer', async () => {
        const share = await load();
        share.init();
        btn('x').click();
        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(openSpy).toHaveBeenCalledWith(`https://x.com/intent/tweet?url=${encodeURIComponent(SHARE_URL())}`, ...OPEN_ARGS);
    });

    it('LINE でシェア：window.open に lineit の URL・_blank・noopener,noreferrer', async () => {
        const share = await load();
        share.init();
        btn('line').click();
        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(openSpy).toHaveBeenCalledWith(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(SHARE_URL())}`, ...OPEN_ARGS);
    });

    it('どのボタンも、動作の時点ではシートが先に閉じている', async () => {
        const share = await load();
        share.init();
        let openAtCall: boolean[] = [];
        writeText.mockImplementation(() => { openAtCall.push(share.isOpen()); return Promise.resolve(); });
        openSpy.mockImplementation(() => { openAtCall.push(share.isOpen()); return null; });

        for (const kind of ['copy', 'x', 'line']) {
            share.open();
            expect(share.isOpen()).toBe(true);
            btn(kind).click();
        }
        expect(openAtCall).toEqual([false, false, false]);
        expect(share.isOpen()).toBe(false);
    });
});

describe('open / close / isOpen', () => {
    it('open で開き、close で閉じる', async () => {
        const share = await load();
        share.init();
        expect(share.isOpen()).toBe(false);
        share.open();
        expect(share.isOpen()).toBe(true);
        share.close();
        expect(share.isOpen()).toBe(false);
    });

    it('閉じると opener へフォーカスが戻る', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        const share = await load();
        share.init();
        share.open(opener);
        share.close();
        expect(document.activeElement).toBe(opener);
    });

    it('閉じるボタンでも閉じ、opener へフォーカスが戻る', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        const share = await load();
        share.init();
        share.open(opener);
        document.querySelector<HTMLElement>('[data-sheet-close]')!.click();
        expect(share.isOpen()).toBe(false);
        expect(document.activeElement).toBe(opener);
    });
});

describe('断片の無いページ', () => {
    it('init・open・close が何もしない（例外を出さない）。isOpen は偽', async () => {
        document.body.innerHTML = '';
        const share = await load();
        expect(() => share.init()).not.toThrow();
        expect(() => share.open()).not.toThrow();
        expect(() => share.close()).not.toThrow();
        expect(share.isOpen()).toBe(false);
    });
});
