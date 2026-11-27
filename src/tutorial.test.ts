/*
 * tutorial.test.ts
 * 対象: tutorial.ts の初回ガイド（カルーセル）の開閉と送り操作。
 * 方針: 期待値は要件 06-12「初回ガイドのカルーセル」と tutorial.ts の IF コメントから導出する。
 *   <dialog> は test-support/dialog-stub の代用（open 属性の付け外しと close イベント）で動かす。
 *   代用が再現しないもの（最前面の層・Tab の閉じ込め・autofocus でフォーカスが入ること・Esc）は e2e/tutorial.spec.ts。
 *   jsdom には closedBy が無いので、背景クリックで閉じるテストは手書きの判定が働いていることの検査になる。
 *   読書点マーカー（#reading-anchor）は DOM に置かない（ここでは見ない）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDialogStub } from './test-support/dialog-stub';
import * as tutorial from './tutorial';

const KEY = 'lirmena.tutorialSeen';
// カードの矩形（jsdom は常に 0 を返すので代用する）
const RECT = { left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300, x: 100, y: 100, toJSON: () => ({}) };

let restore: () => void = () => {};

function popup(): HTMLDialogElement {
    return document.getElementById('tutorial-popup') as HTMLDialogElement;
}
function q(sel: string): HTMLElement {
    return popup().querySelector<HTMLElement>(sel)!;
}
function click(el: Element, x = 200, y = 200): void {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
}
function setup(tag = 'dialog'): void {
    document.body.innerHTML =
        '<button id="opener">メニュー</button><main id="main-container"></main>' +
        `<${tag} id="tutorial-popup" aria-labelledby="tutorial-title"></${tag}>`;
    tutorial.init();
    const el = document.getElementById('tutorial-popup')!;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(RECT as DOMRect);
}

beforeEach(() => {
    localStorage.clear();
    restore = installDialogStub();
});
afterEach(() => {
    restore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('初回ガイド：開く', () => {
    it('init() では開かない。open() で開き、1 枚目から始まる', () => {
        setup();
        expect(popup().open).toBe(false);
        tutorial.open();
        expect(popup().open).toBe(true);
        expect(q('.tutorial-title').textContent).toBe('この物語の読み方');
        expect(q('.tutorial-next').textContent).toBe('次へ');
        expect(q('.tutorial-prev').style.visibility).toBe('hidden');
        expect([...popup().querySelectorAll('.dot')].map(d => d.classList.contains('is-on'))).toEqual([true, false, false, false, false]);
    });

    it('器の名前になる見出しに id があり、開いたときのフォーカス先（次へ）に autofocus がある', () => {
        setup();
        expect(popup().getAttribute('aria-labelledby')).toBe('tutorial-title');
        expect(q('.tutorial-title').id).toBe('tutorial-title');
        expect(q('.tutorial-next').hasAttribute('autofocus')).toBe(true);
        expect(popup().querySelectorAll('[autofocus]').length).toBe(1);
    });

    it('閉じて開き直すと、また 1 枚目から始まる', () => {
        setup();
        tutorial.open();
        click(q('.tutorial-next'));
        click(q('.tutorial-close'));
        tutorial.open();
        expect(q('.tutorial-title').textContent).toBe('この物語の読み方');
    });

    it('openIfFirstVisit() は初回だけ開き、開いた時点で既読フラグを立てる', () => {
        setup();
        expect(tutorial.openIfFirstVisit()).toBe(true);
        expect(popup().open).toBe(true);
        expect(localStorage.getItem(KEY)).toBe('1');
        click(q('.tutorial-close'));
        expect(tutorial.openIfFirstVisit()).toBe(false);
        expect(popup().open).toBe(false);
    });

    it('showModal() が無い環境では開かず、既読フラグも立てない', () => {
        restore();
        restore = () => {};
        setup();
        tutorial.open();
        expect(popup().hasAttribute('open')).toBe(false);
        expect(tutorial.openIfFirstVisit()).toBe(false);
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('器が <dialog> でなければ開かず、既読フラグも立てない', () => {
        setup('section');
        tutorial.open();
        expect(document.getElementById('tutorial-popup')!.hasAttribute('open')).toBe(false);
        expect(document.getElementById('tutorial-popup')!.childElementCount).toBe(0);
        expect(tutorial.openIfFirstVisit()).toBe(false);
        expect(localStorage.getItem(KEY)).toBeNull();
    });
});

describe('初回ガイド：送る・閉じる', () => {
    beforeEach(() => {
        setup();
        tutorial.open();
    });

    it('「次へ」で進み、最後は「はじめる」になって、押すと閉じる', () => {
        const titles: (string | null)[] = [];
        for (let i = 0; i < 4; i++) {
            click(q('.tutorial-next'));
            titles.push(q('.tutorial-title').textContent);
        }
        expect(titles).toEqual(['「読書点」ってなに？', '読書点は動かせる', '右下のメニュー', 'さあ、読みはじめましょう']);
        expect(q('.tutorial-next').textContent).toBe('はじめる');
        click(q('.tutorial-next'));
        expect(popup().open).toBe(false);
    });

    it('「もどる」で前へ戻る（1 枚目では隠れている）', () => {
        click(q('.tutorial-next'));
        expect(q('.tutorial-prev').style.visibility).toBe('visible');
        click(q('.tutorial-prev'));
        expect(q('.tutorial-title').textContent).toBe('この物語の読み方');
        expect(q('.tutorial-prev').style.visibility).toBe('hidden');
    });

    it('カード地（ボタン以外の中身）を押すと次へ進む', () => {
        click(q('.tutorial-text'));
        expect(q('.tutorial-title').textContent).toBe('「読書点」ってなに？');
        expect(popup().open).toBe(true);
    });

    it('カード自身の余白（対象は dialog・座標は器の中）を押すと次へ進む', () => {
        click(popup(), 105, 105);
        expect(q('.tutorial-title').textContent).toBe('「読書点」ってなに？');
        expect(popup().open).toBe(true);
    });

    it.each([[50, 200], [600, 200], [200, 50], [200, 450]])('背景（対象は dialog・座標 %i,%i は器の外）を押すと閉じる', (x, y) => {
        click(popup(), x, y);
        expect(popup().open).toBe(false);
        expect(q('.tutorial-title').textContent).toBe('この物語の読み方');   // 進んでいない
    });

    it('× で閉じる', () => {
        click(q('.tutorial-close'));
        expect(popup().open).toBe(false);
    });
});

describe('初回ガイド：閉じたあとのフォーカス', () => {
    it('opener を渡して開くと、どの閉じ方でも閉じたあと opener にフォーカスが戻る', () => {
        setup();
        const opener = document.getElementById('opener')!;
        tutorial.open({ opener });
        click(q('.tutorial-close'));
        expect(document.activeElement).toBe(opener);

        opener.blur();
        tutorial.open({ opener });
        popup().close();   // Esc はブラウザが閉じる（close イベントだけが来る）
        expect(document.activeElement).toBe(opener);
    });

    it('opener を渡さずに開くと、閉じてもフォーカスを動かさない（ブラウザに任せる）。前の opener も残らない', () => {
        setup();
        const opener = document.getElementById('opener')!;
        tutorial.open({ opener });
        click(q('.tutorial-close'));
        opener.blur();
        tutorial.open();
        click(q('.tutorial-close'));
        expect(document.activeElement).toBe(document.body);
    });
});
