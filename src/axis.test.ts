/*
 * axis.test.ts
 * 対象: axis.ts の進行軸ユーティリティ（vertical-rl ⇔ horizontal-tb の写像）
 * 方針: 期待値は axis.ts の IF コメント＝計画 A-2 の軸対応表から導出する（仕様駆動・実装ミラー禁止）。
 *   - forward は常に 0 起点・正値。vertical は scrollLeft が負へ伸び、horizontal は scrollTop が正へ伸びる
 *   - 期待値の根拠（対応表）:
 *       getProgress      vertical=|scrollLeft|            horizontal=scrollTop
 *       setProgress      vertical: scrollLeft=-v          horizontal: scrollTop=v
 *       getProgressRange vertical: scrollWidth-clientW    horizontal: scrollHeight-clientH
 *       getAnchorPx      vertical: right - ratio*width    horizontal: top + ratio*height
 * 環境: jsdom。書字方向は <html data-writing-mode> 属性で切替える（axis の唯一の真実源）。
 *   scroll 系プロパティはレイアウトしない jsdom で 0 固定のため、プレーンなスタブ要素を HTMLElement として渡す。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    getMode,
    isReverse,
    sign,
    getProgress,
    setProgress,
    getProgressRange,
    getClientSize,
    getProgressFromEvent,
    getAnchorPx,
} from './axis';

// 書字方向を <html> 属性で設定する。null は属性削除（＝既定の縦書き）。
function setMode(m: 'vertical' | 'horizontal' | null): void {
    if (m === null) document.documentElement.removeAttribute('data-writing-mode');
    else document.documentElement.setAttribute('data-writing-mode', m);
}

// scroll 系プロパティを持つだけのスタブ要素（jsdom はレイアウトしないため実 DOM では検証できない）。
function stubEl(props: Partial<Record<keyof HTMLElement, number>>): HTMLElement {
    return { ...props } as unknown as HTMLElement;
}

afterEach(() => {
    document.documentElement.removeAttribute('data-writing-mode');
});

describe('getMode / isReverse / sign（書字方向の判定）', () => {
    it('属性なし → 既定の縦書き（reverse=true, sign=-1）', () => {
        setMode(null);
        expect(getMode()).toBe('vertical');
        expect(isReverse()).toBe(true);
        expect(sign()).toBe(-1);
    });

    it('horizontal → 横書き（reverse=false, sign=+1）', () => {
        setMode('horizontal');
        expect(getMode()).toBe('horizontal');
        expect(isReverse()).toBe(false);
        expect(sign()).toBe(1);
    });

    it('不正値 → 既定の縦書きへ倒す', () => {
        document.documentElement.setAttribute('data-writing-mode', 'sideways');
        expect(getMode()).toBe('vertical');
        expect(isReverse()).toBe(true);
    });
});

describe('getProgress（forward 現在位置・0 起点・正値）', () => {
    it('vertical: |scrollLeft|（負値を正の forward へ）', () => {
        setMode('vertical');
        expect(getProgress(stubEl({ scrollLeft: -150 }))).toBe(150);
        expect(getProgress(stubEl({ scrollLeft: 0 }))).toBe(0);
    });

    it('horizontal: scrollTop をそのまま', () => {
        setMode('horizontal');
        expect(getProgress(stubEl({ scrollTop: 150 }))).toBe(150);
        expect(getProgress(stubEl({ scrollTop: 0 }))).toBe(0);
    });
});

describe('setProgress（forward 位置を生 scroll 座標へ）', () => {
    it('vertical: scrollLeft = -v（負方向へ）', () => {
        setMode('vertical');
        const el = stubEl({ scrollLeft: 0 });
        setProgress(el, 150);
        expect(el.scrollLeft).toBe(-150);
    });

    it('horizontal: scrollTop = v（正方向へ）', () => {
        setMode('horizontal');
        const el = stubEl({ scrollTop: 0 });
        setProgress(el, 150);
        expect(el.scrollTop).toBe(150);
    });

    it('v=0 はどちらのモードでも原点（先頭）に戻す', () => {
        setMode('vertical');
        const v = stubEl({ scrollLeft: -99 });
        setProgress(v, 0);
        expect(v.scrollLeft).toBe(-0);

        setMode('horizontal');
        const h = stubEl({ scrollTop: 99 });
        setProgress(h, 0);
        expect(h.scrollTop).toBe(0);
    });

    it('getProgress と往復で一致する（forward 量が保存される）', () => {
        setMode('vertical');
        const el = stubEl({ scrollLeft: 0 });
        setProgress(el, 320);
        expect(getProgress(el)).toBe(320);
    });
});

describe('getProgressRange / getClientSize（進行軸の可動域とビューポート長）', () => {
    it('vertical: scrollWidth-clientWidth / clientWidth', () => {
        setMode('vertical');
        const el = stubEl({ scrollWidth: 1000, clientWidth: 400 });
        expect(getProgressRange(el)).toBe(600);
        expect(getClientSize(el)).toBe(400);
    });

    it('horizontal: scrollHeight-clientHeight / clientHeight', () => {
        setMode('horizontal');
        const el = stubEl({ scrollHeight: 1000, clientHeight: 400 });
        expect(getProgressRange(el)).toBe(600);
        expect(getClientSize(el)).toBe(400);
    });
});

describe('getProgressFromEvent（wheel → forward 増分・係数適用前）', () => {
    it('縦ホイール deltaY は両モードとも forward 増分に一致する', () => {
        setMode('vertical');
        expect(getProgressFromEvent({ deltaY: 120 } as WheelEvent)).toBe(120);
        setMode('horizontal');
        expect(getProgressFromEvent({ deltaY: 120 } as WheelEvent)).toBe(120);
    });
});

describe('getAnchorPx（--reading-anchor 比率 → 進行軸の絶対 px）', () => {
    // rect: right=1000(width=800 → left=200), top=100(height=800 → bottom=900), ratio=0.45
    const rect = { right: 1000, width: 800, top: 100, height: 800 } as DOMRect;

    it('vertical: right - ratio*width = 1000 - 360 = 640（右端から内側へ）', () => {
        setMode('vertical');
        expect(getAnchorPx(rect, 0.45)).toBeCloseTo(640);
    });

    it('horizontal: top + ratio*height = 100 + 360 = 460（上端から下へ）', () => {
        setMode('horizontal');
        expect(getAnchorPx(rect, 0.45)).toBeCloseTo(460);
    });
});
