// @vitest-environment node
/*
 * core/record-hold.test.ts
 * 記録の保留（要件 06-5）。タブごとの記憶の読み書きと、新たに保留を付ける遷移の判定を、DOM の無い環境で確かめる。
 * 期待は要件から書く：外部サイト・直接アクセス（referrer が空・別オリジン）だけが対象で、新たに付けるのは通常の遷移のときだけ。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as hold from './record-hold';

function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
        get length() { return map.size; },
        clear: () => map.clear(),
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => { map.delete(k); },
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
    };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('タブの記憶', () => {
    beforeEach(() => { vi.stubGlobal('sessionStorage', memoryStorage()); });

    it('付けるまでは保留でない。付ければ保留、解除すれば保留でない', () => {
        expect(hold.isHeld()).toBe(false);
        hold.setHeld();
        expect(hold.isHeld()).toBe(true);
        hold.clearHeld();
        expect(hold.isHeld()).toBe(false);
    });
});

describe('sessionStorage が例外を投げる環境', () => {
    beforeEach(() => {
        vi.stubGlobal('sessionStorage', {
            getItem() { throw new Error('blocked'); },
            setItem() { throw new Error('blocked'); },
            removeItem() { throw new Error('blocked'); },
        });
    });

    it('どの操作も例外を外へ出さない。読めないときは保留でない', () => {
        expect(() => hold.setHeld()).not.toThrow();
        expect(() => hold.clearHeld()).not.toThrow();
        expect(hold.isHeld()).toBe(false);
    });
});

describe('isExternalReferrer', () => {
    const origin = 'https://example.github.io';

    it('空は外部', () => { expect(hold.isExternalReferrer('', origin)).toBe(true); });
    it('別オリジンは外部', () => { expect(hold.isExternalReferrer('https://t.co/abc', origin)).toBe(true); });
    it('解釈できない値は外部', () => { expect(hold.isExternalReferrer('not a url', origin)).toBe(true); });
    it('同じオリジンは外部でない', () => { expect(hold.isExternalReferrer(`${origin}/lirmena/`, origin)).toBe(false); });
});

describe('startsHold（新たに保留を付ける遷移か）', () => {
    const origin = 'https://example.github.io';

    it('通常の遷移で外部から', () => {
        expect(hold.startsHold('', origin, 'navigate')).toBe(true);
        expect(hold.startsHold('https://t.co/abc', origin, 'navigate')).toBe(true);
    });

    it('サイト内の遷移では付けない', () => {
        expect(hold.startsHold(`${origin}/lirmena/`, origin, 'navigate')).toBe(false);
    });

    it('リロード・戻る/進むでは付けない（referrer は元の外部のまま）', () => {
        expect(hold.startsHold('https://t.co/abc', origin, 'reload')).toBe(false);
        expect(hold.startsHold('https://t.co/abc', origin, 'back_forward')).toBe(false);
        expect(hold.startsHold('', origin, 'reload')).toBe(false);
    });
});
