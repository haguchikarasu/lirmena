/*
 * ui/world-sheet.test.ts
 * 対象: ui/world-sheet.ts の資料シート（人物・地図・用語のタブ）の開閉、タブ切り替え、「ページで開く」の行き先、Escape の扱い。
 * 方針: 期待値は world-sheet.ts 冒頭の IF コメントと core/query.ts の withQuery から導く（仕様駆動）。
 *   markup は実物の断片 templates/parts/world.html を読んで入れる（手で写さない）。
 *   部品（characters・map・glossary）は vi.mock で差し替え、シート（ui/sheet）と core/query は実物。
 *   リファクタリング前の安全網＝今の仕様をそのまま置く。
 * 環境: jsdom。<dialog> は test-support/dialog-stub の代用。モジュールの状態（_mapMounted など）はテストごとに
 *   vi.resetModules() して動的 import し直して戻す。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDialogStub } from '../test-support/dialog-stub';

vi.mock('../characters', () => ({ render: vi.fn(), viewToHash: vi.fn() }));
vi.mock('../map', () => ({ mount: vi.fn() }));
vi.mock('../glossary', () => ({ mountPanel: vi.fn(), handleEscape: vi.fn() }));

const WORLD_HTML = readFileSync(resolve(__dirname, '../../templates/parts/world.html'), 'utf-8');

type Mods = {
    ws: typeof import('./world-sheet');
    characters: typeof import('../characters');
    map: typeof import('../map');
    glossary: typeof import('../glossary');
};

async function load(): Promise<Mods> {
    vi.resetModules();
    const ws = await import('./world-sheet');
    const characters = await import('../characters');
    const map = await import('../map');
    const glossary = await import('../glossary');
    vi.clearAllMocks();
    vi.mocked(characters.viewToHash).mockReturnValue('vol=1&id=abc');
    vi.mocked(glossary.handleEscape).mockReturnValue(true);
    return { ws, characters, map, glossary };
}

const dlg = () => document.getElementById('world-sheet') as HTMLDialogElement;
const tabBtn = (t: string) => document.querySelector<HTMLButtonElement>(`.sheet-tab[data-tab="${t}"]`)!;
const panelOf = (t: string) => document.getElementById(`${t}-overlay`)!;
const pageHref = () => document.getElementById('world-sheet-page')!.getAttribute('href');
const source = (data: unknown = [{ id: 'x' }]) => ({ characters: () => data as never, stage: () => 'stage-2' as never });
const pressEscape = () => {
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    dlg().dispatchEvent(e);
    return e;
};

let restoreDialog: () => void;
beforeEach(() => {
    restoreDialog = installDialogStub();
    document.body.innerHTML = WORLD_HTML;
    history.replaceState(null, '', '/');
});
afterEach(() => {
    restoreDialog();
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
});

describe('open とタブの表示', () => {
    it.each(['characters', 'map', 'glossary'] as const)('open(%s)：選んだタブだけ選択状態・中身が見え、シートが開く', async (tab) => {
        const { ws } = await load();
        ws.init(source());
        ws.open(tab);

        expect(ws.isOpen()).toBe(true);
        expect(dlg().dataset.tab).toBe(tab);
        for (const t of ['characters', 'map', 'glossary']) {
            expect(tabBtn(t).getAttribute('aria-selected')).toBe(String(t === tab));
            expect(panelOf(t).hidden).toBe(t !== tab);
        }
    });

    it('タブのボタンを押すと切り替わる（aria-selected と中身の hidden）', async () => {
        const { ws } = await load();
        ws.init(source());
        ws.open('characters');
        tabBtn('map').click();

        expect(dlg().dataset.tab).toBe('map');
        expect(tabBtn('map').getAttribute('aria-selected')).toBe('true');
        expect(tabBtn('characters').getAttribute('aria-selected')).toBe('false');
        expect(panelOf('map').hidden).toBe(false);
        expect(panelOf('characters').hidden).toBe(true);
    });

    it('切り替えると、タブの中身にフォーカスが移る', async () => {
        const { ws } = await load();
        ws.init(source());
        ws.open('characters');
        expect(document.activeElement).toBe(panelOf('characters'));
        tabBtn('glossary').click();
        expect(document.activeElement).toBe(panelOf('glossary'));
    });
});

describe('「ページで開く」の行き先', () => {
    it.each(['characters', 'map', 'glossary'] as const)('%s のタブは <tab>.html を指す', async (tab) => {
        const { ws } = await load();
        ws.init(source());
        ws.open(tab);
        expect(pageHref()).toBe(`/${tab}.html`);
    });

    it('URL に ?dev=1 が付いているときは引き継ぐ', async () => {
        history.replaceState(null, '', '/?dev=1');
        const { ws } = await load();
        ws.init(source());
        ws.open('map');
        expect(pageHref()).toBe('/map.html?dev=1');
        tabBtn('glossary').click();
        expect(pageHref()).toBe('/glossary.html?dev=1');
    });

    it('人物のタブで部品から onChange が来ると # ＋ viewToHash の結果が付き、別のタブへ移ると # が消える', async () => {
        history.replaceState(null, '', '/?dev=1');
        const { ws, characters } = await load();
        ws.init(source());
        ws.open('characters');
        expect(pageHref()).toBe('/characters.html?dev=1');   // 部品がまだ何も知らせていない間は # なし

        const opts = vi.mocked(characters.render).mock.calls[0][3] as { onChange: (v: unknown) => void };
        const view = { vol: 1, id: 'abc' };
        opts.onChange(view);
        expect(characters.viewToHash).toHaveBeenCalledWith(view);
        expect(pageHref()).toBe('/characters.html?dev=1#vol=1&id=abc');

        tabBtn('map').click();
        expect(pageHref()).toBe('/map.html?dev=1');
    });

    it('人物のタブを描き直すと、前の巻・人の # は一度消える', async () => {
        const { ws, characters } = await load();
        ws.init(source());
        ws.open('characters');
        const opts = vi.mocked(characters.render).mock.calls[0][3] as { onChange: (v: unknown) => void };
        opts.onChange({});
        expect(pageHref()).toBe('/characters.html#vol=1&id=abc');

        tabBtn('characters').click();   // 同じタブを選び直す＝描き直し
        expect(pageHref()).toBe('/characters.html');
    });
});

describe('部品の呼び出し', () => {
    it('人物は開くたび・選ぶたびに render が呼ばれる（Stage と器を渡す）', async () => {
        const { ws, characters } = await load();
        const data = [{ id: 'a' }];
        ws.init(source(data));
        ws.open('characters');
        expect(characters.render).toHaveBeenCalledTimes(1);
        expect(vi.mocked(characters.render).mock.calls[0][0]).toBe(panelOf('characters'));
        expect(vi.mocked(characters.render).mock.calls[0][1]).toBe(data);
        expect(vi.mocked(characters.render).mock.calls[0][2]).toBe('stage-2');

        tabBtn('map').click();
        tabBtn('characters').click();
        expect(characters.render).toHaveBeenCalledTimes(2);
        dlg().close();
        ws.open('characters');
        expect(characters.render).toHaveBeenCalledTimes(3);
    });

    it('source.characters() が null なら空の配列で描く', async () => {
        const { ws, characters } = await load();
        ws.init(source(null));
        ws.open('characters');
        expect(vi.mocked(characters.render).mock.calls[0][1]).toEqual([]);
    });

    it('地図の mount は最初の 1 回だけ', async () => {
        const { ws, map } = await load();
        ws.init(source());
        ws.open('map');
        expect(map.mount).toHaveBeenCalledTimes(1);
        expect(vi.mocked(map.mount).mock.calls[0][0]).toBe(panelOf('map'));
        tabBtn('characters').click();
        tabBtn('map').click();
        ws.open('map');
        expect(map.mount).toHaveBeenCalledTimes(1);
    });

    it('用語は glossary.mountPanel が呼ばれる', async () => {
        const { ws, glossary } = await load();
        ws.init(source());
        ws.open('glossary');
        expect(glossary.mountPanel).toHaveBeenCalledTimes(1);
        expect(vi.mocked(glossary.mountPanel).mock.calls[0][0]).toBe(panelOf('glossary'));
    });
});

describe('Escape', () => {
    it('用語のタブ：handleEscape が偽なら keydown を止める', async () => {
        const { ws, glossary } = await load();
        vi.mocked(glossary.handleEscape).mockReturnValue(false);
        ws.init(source());
        ws.open('glossary');
        const e = pressEscape();
        expect(glossary.handleEscape).toHaveBeenCalledTimes(1);
        expect(e.defaultPrevented).toBe(true);
    });

    it('用語のタブ：handleEscape が真なら止めない', async () => {
        const { ws, glossary } = await load();
        vi.mocked(glossary.handleEscape).mockReturnValue(true);
        ws.init(source());
        ws.open('glossary');
        const e = pressEscape();
        expect(glossary.handleEscape).toHaveBeenCalledTimes(1);
        expect(e.defaultPrevented).toBe(false);
    });

    it.each(['characters', 'map'] as const)('%s のタブ：handleEscape を呼ばず、止めない', async (tab) => {
        const { ws, glossary } = await load();
        vi.mocked(glossary.handleEscape).mockReturnValue(false);
        ws.init(source());
        ws.open(tab);
        const e = pressEscape();
        expect(glossary.handleEscape).not.toHaveBeenCalled();
        expect(e.defaultPrevented).toBe(false);
    });
});

describe('opener と断片の無いページ', () => {
    it('open に渡した opener へ、閉じたときにフォーカスが戻る', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        const { ws } = await load();
        ws.init(source());
        ws.open('map', opener);
        expect(document.activeElement).toBe(panelOf('map'));

        document.querySelector<HTMLElement>('[data-sheet-close]')!.click();
        expect(ws.isOpen()).toBe(false);
        expect(document.activeElement).toBe(opener);
    });

    it('断片が無いページでは init・open が何もしない（例外を出さない）。isOpen は偽', async () => {
        document.body.innerHTML = '';
        const { ws, characters, map, glossary } = await load();
        expect(() => ws.init(source())).not.toThrow();
        expect(() => ws.open('characters')).not.toThrow();
        expect(ws.isOpen()).toBe(false);
        expect(characters.render).not.toHaveBeenCalled();
        expect(map.mount).not.toHaveBeenCalled();
        expect(glossary.mountPanel).not.toHaveBeenCalled();
    });
});
