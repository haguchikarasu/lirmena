/*
 * keyscroll.test.ts
 * 対象: keyscroll.ts（本文ページのキーボードのスクロール）
 * 方針: 期待値は要件 06-6「キーボードのスクロール」と keyscroll.ts 冒頭の IF コメントから導く。
 *   - resolveKey（キーの解釈）は純関数として表で見る
 *   - init 後の keydown は、受ける・受けない場面の切り分けと、axis へ頼む量だけを見る（実際に動くかは e2e/keyboard-scroll.spec.ts）
 * 環境: jsdom。レイアウトしないので、#main-container の大きさと scrollBy/scrollTo は差し替える。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, resolveKey, type KeyInput } from './keyscroll';

const key = (k: string, over: Partial<KeyInput> = {}): KeyInput =>
    ({ key: k, shift: false, ctrl: false, alt: false, meta: false, mode: 'horizontal', ...over });

describe('resolveKey（キーの解釈）', () => {
    it.each([
        ['ArrowDown', { kind: 'by', unit: 'line', dir: 1 }],
        ['ArrowUp', { kind: 'by', unit: 'line', dir: -1 }],
        ['PageDown', { kind: 'by', unit: 'page', dir: 1 }],
        ['PageUp', { kind: 'by', unit: 'page', dir: -1 }],
        [' ', { kind: 'by', unit: 'page', dir: 1 }],
        ['Home', { kind: 'to', edge: 'start' }],
        ['End', { kind: 'to', edge: 'end' }],
    ])('%j は両書字方向で同じ', (k, expected) => {
        expect(resolveKey(key(k, { mode: 'horizontal' }))).toEqual(expected);
        expect(resolveKey(key(k, { mode: 'vertical' }))).toEqual(expected);
    });

    it('Shift+Space は 1 画面戻る', () => {
        expect(resolveKey(key(' ', { shift: true }))).toEqual({ kind: 'by', unit: 'page', dir: -1 });
    });

    it('縦書きは ← で進み、→ で戻る', () => {
        expect(resolveKey(key('ArrowLeft', { mode: 'vertical' }))).toEqual({ kind: 'by', unit: 'line', dir: 1 });
        expect(resolveKey(key('ArrowRight', { mode: 'vertical' }))).toEqual({ kind: 'by', unit: 'line', dir: -1 });
    });

    it('横書きの ← → は受けない', () => {
        expect(resolveKey(key('ArrowLeft'))).toBeNull();
        expect(resolveKey(key('ArrowRight'))).toBeNull();
    });

    it.each(['ctrl', 'alt', 'meta'] as const)('%s と一緒のときは受けない', (mod) => {
        for (const k of ['ArrowDown', 'PageDown', ' ', 'Home', 'End']) expect(resolveKey(key(k, { [mod]: true }))).toBeNull();
    });

    it('Shift は Space 以外では受けない（Shift+矢印は文字の選択）', () => {
        for (const k of ['ArrowDown', 'ArrowUp', 'PageDown', 'Home', 'End']) expect(resolveKey(key(k, { shift: true }))).toBeNull();
    });

    it.each(['Enter', 'Tab', 'Escape', 'a'])('%s は受けない', (k) => {
        expect(resolveKey(key(k))).toBeNull();
    });
});

describe('keydown（受ける場面と、頼む量）', () => {
    let container: HTMLElement;
    let scrollTo: ReturnType<typeof vi.fn>;

    beforeAll(() => init());

    beforeEach(() => {
        document.body.innerHTML =
            '<button id="btn">ボタン</button><a id="link" href="#x">リンク</a><input id="field"><main id="main-container"><article id="scene-content"><p>本文</p></article></main>';
        container = document.getElementById('main-container')!;
        scrollTo = vi.fn();
        Object.assign(container, { scrollTo });
        // 横書き：表示長 800・全長 5000（可動域 4200）。いまの位置は 1000（scrollTo は差し替えなので動かない）
        Object.defineProperty(container, 'scrollTop', { value: 1000, writable: true, configurable: true });
        container.dispatchEvent(new Event('wheel', { bubbles: true }));   // 前のテストの行き先の覚えを消す
        Object.defineProperties(container, {
            clientHeight: { value: 800, configurable: true },
            scrollHeight: { value: 5000, configurable: true },
        });
        document.querySelector<HTMLElement>('#scene-content p')!.style.lineHeight = '36px';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        document.documentElement.className = '';
        document.documentElement.removeAttribute('data-writing-mode');
    });

    const press = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent => {
        const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(e);
        return e;
    };

    it('↓ は本文 1 行ぶん（行の高さ）進め、既定の動作を止める', () => {
        const e = press('ArrowDown');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 1036, behavior: 'smooth' });
        expect(e.defaultPrevented).toBe(true);
    });

    it('行の高さは段落から読む（#scene-content 自身の値は使わない）', () => {
        document.getElementById('scene-content')!.style.lineHeight = '99px';
        press('ArrowDown');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 1036, behavior: 'smooth' });
    });

    it('行の高さが読めないときは 40px', () => {
        document.querySelector<HTMLElement>('#scene-content p')!.style.lineHeight = 'normal';
        press('ArrowUp');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 960, behavior: 'smooth' });
    });

    it('PageDown は表示長の 0.875 倍（800 → 700）', () => {
        press('PageDown');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 1700, behavior: 'smooth' });
    });

    it('縦書きの ← は left の負へ（進む向き）', () => {
        document.documentElement.setAttribute('data-writing-mode', 'vertical');
        Object.defineProperties(container, { scrollLeft: { value: -1000, configurable: true }, clientWidth: { value: 800, configurable: true }, scrollWidth: { value: 5000, configurable: true } });
        press('ArrowLeft');
        expect(scrollTo).toHaveBeenLastCalledWith({ left: -1036, behavior: 'smooth' });
    });

    it('Home は 0 へ、End は可動域の端（4200）へ', () => {
        press('Home');
        press('End');
        expect(scrollTo.mock.calls).toEqual([[{ top: 0, behavior: 'smooth' }], [{ top: 4200, behavior: 'smooth' }]]);
    });

    it('滑らかに動いている途中の次のキーは、前の行き先から足す（2 回押せば 2 回ぶん）', () => {
        press('PageDown');
        press('PageDown');
        press('ArrowUp');
        expect(scrollTo.mock.calls.map((c) => (c[0] as ScrollToOptions).top)).toEqual([1700, 2400, 2364]);
    });

    it('着く前の scrollend（取り消された前のスクロールのもの）では、行き先の覚えを消さない', () => {
        press('PageDown');
        press('PageDown');
        container.dispatchEvent(new Event('scrollend'));
        press('PageDown');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 3100, behavior: 'smooth' });
    });

    it('行き先に着いたら（scroll）、次のキーは今の位置から測る', () => {
        press('PageDown');
        container.scrollTop = 1700;
        container.dispatchEvent(new Event('scroll'));
        container.scrollTop = 300;   // そのあと別の手段（ホイールなど）で動いた
        press('ArrowDown');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 336, behavior: 'smooth' });
    });

    it.each(['wheel', 'pointerdown', 'touchstart'])('途中で %s が来たら、次のキーは今の位置から測る', (type) => {
        press('PageDown');
        container.dispatchEvent(new Event(type, { bubbles: true }));
        container.scrollTop = 1300;   // ホイールなどで動いた先
        press('ArrowDown');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 1336, behavior: 'smooth' });
    });

    it('行き先は可動域の端（0〜4200）で止める', () => {
        for (let i = 0; i < 8; i++) press('PageDown');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 4200, behavior: 'smooth' });
        press('Home');
        press('ArrowUp');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('押しっぱなしのくり返しは滑らかにしない', () => {
        press('ArrowDown', { repeat: true });
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 1036, behavior: 'auto' });
    });

    it('ボタンにフォーカスがあるとき：矢印は受け、Space はボタンに譲る', () => {
        const btn = document.getElementById('btn')!;
        press('ArrowDown', {}, btn);
        expect(scrollTo).toHaveBeenCalledTimes(1);
        const e = press(' ', {}, btn);
        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(e.defaultPrevented).toBe(false);
    });

    it('リンクにフォーカスがあるときの Space は受ける（リンクは Space では押されない）', () => {
        const e = press(' ', {}, document.getElementById('link')!);
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 1700, behavior: 'smooth' });
        expect(e.defaultPrevented).toBe(true);
    });

    it('途中でスクロール以外のキー（Tab）が来たら、次のキーは今の位置から測る', () => {
        press('PageDown');
        press('Tab');
        container.scrollTop = 0;   // フォーカスの移動で本文が頭へ戻った
        press('ArrowDown');
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 36, behavior: 'smooth' });
    });

    it('入力欄にフォーカスがあるときは受けない', () => {
        const e = press('ArrowDown', {}, document.getElementById('field')!);
        expect(scrollTo).not.toHaveBeenCalled();
        expect(e.defaultPrevented).toBe(false);
    });

    it('鑑賞モード中は受けない', () => {
        document.documentElement.classList.add('is-immersive');
        const e = press('ArrowDown');
        expect(scrollTo).not.toHaveBeenCalled();
        expect(e.defaultPrevented).toBe(false);
    });

    it('シート（開いた dialog）があるときは受けない', () => {
        document.body.insertAdjacentHTML('beforeend', '<dialog open></dialog>');
        press('PageDown');
        expect(scrollTo).not.toHaveBeenCalled();
    });

    // 「メニューが開いているときは受けない」はここでは見ない：メニューは popover で、開いているかは :popover-open で
    // 決まる。jsdom はこの擬似クラスに一致させられないので、e2e/keyboard-scroll.spec.ts の K7 と e2e/menu.spec.ts が実物で見る

    it('ほかの処理が止めたキーは受けない', () => {
        const stop = (e: Event) => e.preventDefault();
        document.body.addEventListener('keydown', stop);
        press('ArrowDown');
        document.body.removeEventListener('keydown', stop);
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('受けないキー（Enter）は既定の動作を止めない', () => {
        expect(press('Enter').defaultPrevented).toBe(false);
    });
});
