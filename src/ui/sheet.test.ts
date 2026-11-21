/*
 * ui/sheet.test.ts
 * 対象: ui/sheet.ts——シートの器（<dialog class="sheet">）の開閉・背景・閉じるボタン・Esc の例外・フォーカスの戻り先・掴む操作。
 * 方針: 期待値は design/modules/sheet.md（設計の正典）と sheet.ts 冒頭・各関数の IF コメントから導く（実装をなぞらない）。
 *   これから <dialog> まわり（closedby="any" の導入など）を作り替えるので、その前に今の仕様を固定する安全網。
 *   **動かしたあとの click は背景の判定にもボタンにも渡さない**が、作り替えでいちばん壊しやすい所（sheet.md「掴む操作」。
 *   上限で止まった器の外で指を離すと「背景を押した」と判定されて閉じていた）。
 * 環境: jsdom。markup は実物の断片を readFileSync で読む（手で写さない）：
 *   templates/parts/share.html（fit の器）と templates/parts/world.html（half の器。見出しの帯にタブ・リンク・閉じるがある）。
 *   jsdom には showModal()・close() が無いので test-support/dialog-stub の代用を置く。
 *   **jsdom には closedBy も無いので、背景クリックのテストは「closedby 未対応のブラウザで手書きの判定が閉じる」ことの検査になる。
 *   この判定（init の背景の click リスナー）を消すとここが赤になる。**
 *   jsdom の getBoundingClientRect は全部 0 なので、器の矩形は vi.spyOn で与える（画面の下に貼り付いた板：
 *   style.height が入っていればその値、無ければ初期の高さ）。window.matchMedia は無いので代用を置き、PC 幅
 *   （(min-width: 901px)）の真／偽を切り替える。setPointerCapture も無い（本体は try で包んでいる）。
 *   Event.timeStamp と window.innerHeight は Object.defineProperty で与える。画面の高さは 800px とする。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as sheet from './sheet';
import { installDialogStub } from '../test-support/dialog-stub';

const SHARE = readFileSync(resolve(__dirname, '../../templates/parts/share.html'), 'utf-8');
const WORLD = readFileSync(resolve(__dirname, '../../templates/parts/world.html'), 'utf-8');

const VH = 800;
const W = 400;
const HALF_H = 448;   // 56dvh 相当（half の初期の高さ）
const FIT_H = 200;    // 共有シートの中身の高さ

const share = () => document.getElementById('share-popup') as HTMLDialogElement;
const world = () => document.getElementById('world-sheet') as HTMLDialogElement;
const grabOf = (d: HTMLDialogElement) => d.querySelector<HTMLElement>('.sheet-grab')!;
const closeBtnOf = (d: HTMLDialogElement) => d.querySelector<HTMLButtonElement>('[data-sheet-close]')!;

let pcWidth = false;
let restoreStub: () => void;
const origInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');

// 画面の下に貼り付いた板の矩形。style.height が入っていればその値、無ければ initialH
function stubRect(d: HTMLDialogElement, initialH: number): void {
    vi.spyOn(d, 'getBoundingClientRect').mockImplementation(() => {
        const h = d.style.height ? parseFloat(d.style.height) : initialH;
        return { left: 0, right: W, top: VH - h, bottom: VH, width: W, height: h, x: 0, y: VH - h, toJSON: () => ({}) } as DOMRect;
    });
}

// timeStamp を与えた PointerEvent を el へ投げる
function pointer(el: Element, type: string, clientY: number, t: number): void {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 200, clientY, pointerId: 1 });
    Object.defineProperty(e, 'timeStamp', { value: t });
    el.dispatchEvent(e);
}

// el の上から押し、moves（[clientY, 時刻] の列）の順に動かし、最後に離す（up）か取り消す（cancel）
function drag(el: Element, y0: number, moves: [number, number][], finish: 'up' | 'cancel', finishT?: number): void {
    const d = el.closest('dialog')!;
    pointer(el, 'pointerdown', y0, 0);
    for (const [y, t] of moves) pointer(d, 'pointermove', y, t);
    const last = moves.length ? moves[moves.length - 1] : [y0, 0];
    pointer(d, finish === 'up' ? 'pointerup' : 'pointercancel', last[0], finishT ?? last[1] + 10);
}

// ゆっくり dy（正＝下へ）動かして離す（1 秒かけて動かす＝払ったことにならない）
function slowDrag(el: Element, dy: number): void {
    drag(el, 500, [[500 + dy / 2, 500], [500 + dy, 1000]], 'up');
}

const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });

beforeEach(() => {
    restoreStub = installDialogStub();
    pcWidth = false;
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (q: string) => ({
            matches: q === '(min-width: 901px)' ? pcWidth : false,
            media: q, onchange: null,
            addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
            dispatchEvent: () => false,
        }),
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VH });
    document.body.innerHTML = `<button id="opener-a" type="button">A</button><button id="opener-b" type="button">B</button>${SHARE}${WORLD}`;
    stubRect(share(), FIT_H);
    stubRect(world(), HALF_H);
});

afterEach(() => {
    restoreStub();
    vi.restoreAllMocks();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    if (origInnerHeight) Object.defineProperty(window, 'innerHeight', origInnerHeight);
    document.body.innerHTML = '';
});

// 仕様（open の IF コメント「detent を省くと器の data-detent のまま（無ければ half）。開いているものを開き直すと段だけ変わる」
//   ／ open の中のコメント「掴んで止めた高さより、明示された段を優先する」）
describe('open', () => {
    it('開く。段を省けば HTML の段のまま（fit）', () => {
        sheet.init(share());
        sheet.open(share());
        expect(share().open).toBe(true);
        expect(share().dataset.detent).toBe('fit');
    });

    it('HTML にも段が無ければ half', () => {
        share().removeAttribute('data-detent');
        sheet.init(share());
        sheet.open(share());
        expect(share().dataset.detent).toBe('half');
    });

    it('detent を渡すとその段になり、掴んで止めた style.height が消える', () => {
        sheet.init(world());
        world().style.height = '300px';
        sheet.open(world(), { detent: 'full' });
        expect(world().dataset.detent).toBe('full');
        expect(world().style.height).toBe('');
    });

    it('開いているものを開き直すと段だけ変わる（開いたまま）', () => {
        sheet.init(world());
        sheet.open(world());
        sheet.open(world(), { detent: 'full' });
        expect(world().open).toBe(true);
        expect(world().dataset.detent).toBe('full');
    });

    it('今と同じ段を渡しても、掴んで止めた style.height が消える（明示された段を優先する）', () => {
        sheet.init(world());
        sheet.open(world());
        world().style.height = '300px';
        sheet.open(world(), { detent: 'half' });
        expect(world().dataset.detent).toBe('half');
        expect(world().style.height).toBe('');
    });

    it('段を省いて開き直したときは、掴んで止めた style.height を残す', () => {
        sheet.init(world());
        sheet.open(world());
        world().style.height = '300px';
        sheet.open(world());
        expect(world().style.height).toBe('300px');
    });
});

// 仕様（init の IF コメント「背景・閉じるボタン」／sheet.ts 冒頭「[data-sheet-close] … 閉じるボタン」）
describe('背景と閉じるボタン', () => {
    beforeEach(() => {
        sheet.init(world());
        sheet.open(world());
    });

    it('背景（dialog 自身へのクリックで、座標が器の矩形の外）で閉じる', () => {
        world().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 10 }));
        expect(world().open).toBe(false);
    });

    it('dialog 自身へのクリックでも、座標が器の矩形の内側なら閉じない', () => {
        world().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: VH - 100 }));
        expect(world().open).toBe(true);
    });

    it('器の中の子要素のクリックでは閉じない（座標に関わらず）', () => {
        world().querySelector('.sheet-tab')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
        world().querySelector('#characters-overlay')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
        expect(world().open).toBe(true);
    });

    it('[data-sheet-close] で閉じる', () => {
        closeBtnOf(world()).click();
        expect(world().open).toBe(false);
    });
});

// 仕様（sheet.ts 冒頭「Esc の例外：opts.onEscape が false を返すと、その Esc では閉じない（keydown の preventDefault）」）
describe('Esc の例外（onEscape）', () => {
    const esc = (key = 'Escape') => {
        const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        world().dispatchEvent(e);
        return e;
    };

    it('onEscape が false を返した Escape の keydown は止める（defaultPrevented）', () => {
        sheet.init(world(), { onEscape: () => false });
        sheet.open(world());
        expect(esc().defaultPrevented).toBe(true);
    });

    it('onEscape が true を返したら止めない', () => {
        sheet.init(world(), { onEscape: () => true });
        sheet.open(world());
        expect(esc().defaultPrevented).toBe(false);
    });

    it('Escape 以外のキーでは onEscape を呼ばない', () => {
        const fn = vi.fn(() => false);
        sheet.init(world(), { onEscape: fn });
        sheet.open(world());
        expect(esc('Enter').defaultPrevented).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });

    it('onEscape を渡さなければ何もしない', () => {
        sheet.init(world());
        sheet.open(world());
        expect(esc().defaultPrevented).toBe(false);
    });
});

// 仕様（_openers のコメント「閉じたときにフォーカスを戻す先。呼び出し側が渡す。渡されなければ開く直前のフォーカス先」
//   ／ sheet.md「フォーカスの戻り先は呼び出し側が渡す」）
describe('閉じたらフォーカスが戻る', () => {
    const a = () => document.getElementById('opener-a') as HTMLButtonElement;
    const b = () => document.getElementById('opener-b') as HTMLButtonElement;
    beforeEach(() => { sheet.init(world()); });

    it('opener を渡せばそこへ戻る', () => {
        a().focus();
        sheet.open(world(), { opener: b() });
        closeBtnOf(world()).focus();
        sheet.close(world());
        expect(document.activeElement).toBe(b());
    });

    it('opener を省けば、開く直前にフォーカスがあった要素へ戻る', () => {
        a().focus();
        sheet.open(world());
        closeBtnOf(world()).focus();
        sheet.close(world());
        expect(document.activeElement).toBe(a());
    });

    it('戻り先が DOM から外れていたら何もしない（例外を出さない）', () => {
        sheet.open(world(), { opener: b() });
        closeBtnOf(world()).focus();
        b().remove();
        expect(() => sheet.close(world())).not.toThrow();
        expect(world().open).toBe(false);
        expect(document.activeElement).not.toBe(b());
    });
});

// 仕様（close／isOpen／anyOpen の IF コメント）
describe('close・isOpen・anyOpen', () => {
    it('閉じているものを close しても close イベントは出ない', () => {
        sheet.init(world());
        const onClose = vi.fn();
        world().addEventListener('close', onClose);
        sheet.close(world());
        expect(onClose).not.toHaveBeenCalled();
        sheet.open(world());
        sheet.close(world());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('isOpen は開閉に従い、null では false', () => {
        sheet.init(world());
        expect(sheet.isOpen(null)).toBe(false);
        expect(sheet.isOpen(world())).toBe(false);
        sheet.open(world());
        expect(sheet.isOpen(world())).toBe(true);
    });

    it('anyOpen はページのどれかの <dialog> が開いている間だけ true', () => {
        sheet.init(world());
        sheet.init(share());
        expect(sheet.anyOpen()).toBe(false);
        sheet.open(share());
        expect(sheet.anyOpen()).toBe(true);
        sheet.open(world());
        sheet.close(share());
        expect(sheet.anyOpen()).toBe(true);
        sheet.close(world());
        expect(sheet.anyOpen()).toBe(false);
    });
});

// 仕様（_wireDrag のコメント／sheet.md「段（detent）と PC のパネル」：スマホでは掴む所か見出しの帯を動かすと高さが指について
//   きて離した所で止まる。上限は画面の 92%、fit は中身より伸ばさない。画面の 3 割未満（小さな fit は中身の半分の方が低ければ
//   そちら）で離すか、下へ 0.8px/ms 以上で払うと閉じる。100ms 以上止めてから離したら払ったとみなさない。8 割以上なら full）
describe('掴む操作（スマホ幅）', () => {
    describe('高さが指についてくる', () => {
        it('掴む所を上へ動かすと高さが増える', () => {
            sheet.init(world());
            sheet.open(world());
            pointer(grabOf(world()), 'pointerdown', 500, 0);
            pointer(world(), 'pointermove', 400, 500);
            expect(world().style.height).toBe(`${HALF_H + 100}px`);
        });

        it('上限は画面の 92%', () => {
            sheet.init(world());
            sheet.open(world());
            pointer(grabOf(world()), 'pointerdown', 700, 0);
            pointer(world(), 'pointermove', -500, 500);
            expect(world().style.height).toBe(`${VH * 0.92}px`);
        });

        it('fit は中身の高さより伸びない', () => {
            sheet.init(share());
            sheet.open(share());
            pointer(grabOf(share()), 'pointerdown', 700, 0);
            pointer(share(), 'pointermove', 500, 500);
            expect(share().style.height).toBe(`${FIT_H}px`);
        });
    });

    describe('離した所で閉じる／止まる', () => {
        it('画面の高さの 30% 未満で離すと閉じる', () => {
            sheet.init(world());
            sheet.open(world());
            slowDrag(grabOf(world()), HALF_H - VH * 0.3 + 10);   // 230px で離す
            expect(world().open).toBe(false);
        });

        it('30% 以上で離すと閉じずにそこで止まる（half のまま）', () => {
            sheet.init(world());
            sheet.open(world());
            slowDrag(grabOf(world()), HALF_H - VH * 0.3 - 10);   // 250px で離す
            expect(world().open).toBe(true);
            expect(world().style.height).toBe(`${VH * 0.3 + 10}px`);
            expect(world().dataset.detent).toBe('half');
        });

        it('小さな fit は、30% の線より低くても中身の半分以上なら閉じない', () => {
            sheet.init(share());
            sheet.open(share());
            slowDrag(grabOf(share()), 80);   // 120px（30%＝240px 未満・中身の半分＝100px 以上）
            expect(share().open).toBe(true);
        });

        it('小さな fit は、中身の半分未満で離すと閉じる', () => {
            sheet.init(share());
            sheet.open(share());
            slowDrag(grabOf(share()), 120);   // 80px
            expect(share().open).toBe(false);
        });

        it('下へ勢いよく払って離すと、高さに関わらず閉じる', () => {
            sheet.init(world());
            sheet.open(world());
            // 60px を 20ms で（3px/ms）。離した高さ 388px は 30% の線より十分高い
            drag(grabOf(world()), 500, [[530, 10], [560, 20]], 'up', 25);
            expect(world().open).toBe(false);
        });

        it('払っても、100ms 以上止まってから離したら閉じない', () => {
            sheet.init(world());
            sheet.open(world());
            drag(grabOf(world()), 500, [[530, 10], [560, 20]], 'up', 20 + 150);
            expect(world().open).toBe(true);
            expect(world().style.height).toBe(`${HALF_H - 60}px`);
        });

        it('画面の 80% 以上で離すと full', () => {
            sheet.init(world());
            sheet.open(world());
            slowDrag(grabOf(world()), -(VH * 0.8 - HALF_H));   // ちょうど 640px
            expect(world().dataset.detent).toBe('full');
        });

        it('80% 未満で離すと half（full から下げても half）', () => {
            sheet.init(world());
            sheet.open(world(), { detent: 'full' });
            world().style.height = `${VH * 0.92}px`;
            slowDrag(grabOf(world()), VH * 0.92 - (VH * 0.8 - 10));   // 630px で離す
            expect(world().open).toBe(true);
            expect(world().dataset.detent).toBe('half');
        });

        it('fit は離しても fit のまま', () => {
            sheet.init(share());
            sheet.open(share());
            slowDrag(grabOf(share()), 30);
            expect(share().open).toBe(true);
            expect(share().dataset.detent).toBe('fit');
        });

        it('pointercancel では閉じない（30% の線より下でも）', () => {
            sheet.init(world());
            sheet.open(world());
            drag(grabOf(world()), 500, [[700, 500], [800, 1000]], 'cancel');
            expect(world().open).toBe(true);
        });
    });

    // 仕様（sheet.md「動かしたあとの click は、掴み始めた場所に関係なく取り消す」「見出しの帯のボタンの上から動かし始めても
    //   よい：縦に 8px 動いたら掴んでそのボタンの click を取り消す（ただ押しただけならボタンとして働く）」）
    describe('動かしたあとの click', () => {
        it('掴む所から上限まで引き上げ、器の外で指を離しても、そのあとの click で閉じない（背景の判定に渡らない）', () => {
            sheet.init(world());
            sheet.open(world());
            drag(grabOf(world()), 700, [[300, 500], [-200, 1000]], 'up');
            const top = VH - VH * 0.92;
            world().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: top - 20 }));
            expect(world().open).toBe(true);
        });

        it('閉じるボタンの上から 8px 以上動かしたら、そのボタンは押されない', () => {
            sheet.init(world());
            sheet.open(world());
            drag(closeBtnOf(world()), 500, [[480, 500]], 'up');
            closeBtnOf(world()).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            expect(world().open).toBe(true);
            expect(world().style.height).toBe(`${HALF_H + 20}px`);
        });

        it('タブの上から 8px 以上動かしたら、そのタブの click はタブに届かない', () => {
            sheet.init(world());
            sheet.open(world());
            const tab = world().querySelector<HTMLButtonElement>('.sheet-tab')!;
            const onTab = vi.fn();
            tab.addEventListener('click', onTab);
            drag(tab, 500, [[490, 500]], 'up');
            tab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            expect(onTab).not.toHaveBeenCalled();
            expect(world().style.height).toBe(`${HALF_H + 10}px`);
        });

        it('ボタンの上から押して 8px 未満しか動かさなければ、ボタンとして働く（閉じるボタンなら閉じる）', () => {
            sheet.init(world());
            sheet.open(world());
            drag(closeBtnOf(world()), 500, [[495, 500]], 'up');
            expect(world().style.height).toBe('');
            closeBtnOf(world()).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            expect(world().open).toBe(false);
        });

        it('掴んだあと click が来なくても、流れが終わったら（setTimeout 0 の後）次のキーボード由来の click は飲まれない', async () => {
            sheet.init(world());
            sheet.open(world());
            drag(closeBtnOf(world()), 500, [[480, 500]], 'up');   // click は来なかった
            await tick();
            // キーボードの Enter／Space は pointerdown を伴わない click
            closeBtnOf(world()).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            expect(world().open).toBe(false);
        });
    });

    // 仕様（_wireDrag のコメント「入力欄とリンクの上からは掴まない」／sheet.ts 冒頭「PC（幅 901px 以上）は掴む操作は無い」）
    describe('掴まない所', () => {
        it('見出しの帯のリンク（「ページで開く」）の上からは掴まない', () => {
            sheet.init(world());
            sheet.open(world());
            const link = world().querySelector('#world-sheet-page svg')!;
            drag(link, 500, [[400, 500]], 'up');
            expect(world().style.height).toBe('');
        });

        it('見出しの帯の入力欄の上からは掴まない', () => {
            // 実物では用語の検索欄が帯に乗りうる。断片には無いので 1 つ足す
            const input = document.createElement('input');
            world().querySelector('.sheet-head')!.appendChild(input);
            sheet.init(world());
            sheet.open(world());
            drag(input, 500, [[400, 500]], 'up');
            expect(world().style.height).toBe('');
        });

        it('本文（.sheet-body）の上からは掴まない', () => {
            sheet.init(world());
            sheet.open(world());
            drag(world().querySelector('#characters-overlay')!, 500, [[400, 500]], 'up');
            expect(world().style.height).toBe('');
        });

        it('PC 幅（901px 以上）では掴まない', () => {
            pcWidth = true;
            sheet.init(world());
            sheet.open(world());
            drag(grabOf(world()), 500, [[400, 500]], 'up');
            expect(world().style.height).toBe('');
            expect(world().open).toBe(true);
        });
    });

    // 仕様（_wireDrag のコメント「止めた高さは style.height に持ち、閉じたら消す」／sheet.md「閉じたら HTML に書いた段へ戻す」）
    describe('閉じたら持ち越さない', () => {
        it('掴んで full にして閉じると style.height が消え、開き直すと HTML の段（half）', () => {
            sheet.init(world());
            sheet.open(world());
            slowDrag(grabOf(world()), -300);   // 748px → 上限 736px
            expect(world().dataset.detent).toBe('full');
            sheet.close(world());
            expect(world().style.height).toBe('');
            expect(world().dataset.detent).toBe('half');
            sheet.open(world());
            expect(world().dataset.detent).toBe('half');
        });

        it('HTML に段が無い器も、掴んで full にして閉じると、開き直したとき half（open の IF コメント「無ければ half」）', () => {
            world().removeAttribute('data-detent');
            sheet.init(world());
            sheet.open(world());
            slowDrag(grabOf(world()), -300);
            expect(world().dataset.detent).toBe('full');
            sheet.close(world());
            sheet.open(world());
            expect(world().dataset.detent).toBe('half');
        });

        it('fit で止めた高さも閉じたら消え、開き直すとまた中身の高さが上限になる', () => {
            sheet.init(share());
            sheet.open(share());
            slowDrag(grabOf(share()), 50);
            expect(share().style.height).toBe(`${FIT_H - 50}px`);
            sheet.close(share());
            expect(share().style.height).toBe('');
            sheet.open(share());
            pointer(grabOf(share()), 'pointerdown', 500, 0);
            pointer(share(), 'pointermove', 300, 500);
            expect(share().style.height).toBe(`${FIT_H}px`);
        });
    });
});
