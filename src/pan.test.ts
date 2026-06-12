/*
 * pan.test.ts
 * 対象: pan.ts の DOM 非依存な純関数
 *   - shouldPanFromInput: 押下イベントがパン開始条件（マウス・左ボタン・修飾キー無し）を満たすか
 *   - computePanScrollLeft: content-follows-cursor のスクロール量（負モデル・1:1）
 * 方針: 期待値は実装ではなく pan.ts の IF コメント／要件 06-1（左ボタン＋修飾キー無し＋マウス限定でのみパン、
 *   Shift で選択へ譲る、縦書き負モデル forward＝scrollLeft 負方向）から導出する（仕様駆動）。
 *   pointerdown 登録・setPointerCapture・closest 等の DOM 依存は jsdom 不安定のため自動化しない（CLAUDE.md §7）。
 */
import { describe, expect, it } from 'vitest';
import { shouldPanFromInput, computePanScrollLeft } from './pan';

// 修飾キー無し・左ボタン・マウスの基準入力。各テストで1項目だけ崩して検証する。
const base = {
    pointerType: 'mouse',
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
};

describe('shouldPanFromInput（パン開始条件の判定）', () => {
    it('マウス＋左ボタン＋修飾キー無し → true', () => {
        expect(shouldPanFromInput(base)).toBe(true);
    });

    it('タッチ・ペンは対象外 → false（ネイティブスクロールに委ねる）', () => {
        expect(shouldPanFromInput({ ...base, pointerType: 'touch' })).toBe(false);
        expect(shouldPanFromInput({ ...base, pointerType: 'pen' })).toBe(false);
    });

    it('左ボタン以外は対象外 → false（中:1・右:2 はコンテキストメニュー等を温存）', () => {
        expect(shouldPanFromInput({ ...base, button: 1 })).toBe(false);
        expect(shouldPanFromInput({ ...base, button: 2 })).toBe(false);
    });

    it('修飾キーが押されていれば対象外 → false（Shift=選択／他はブラウザへ委譲）', () => {
        expect(shouldPanFromInput({ ...base, shiftKey: true })).toBe(false);
        expect(shouldPanFromInput({ ...base, ctrlKey: true })).toBe(false);
        expect(shouldPanFromInput({ ...base, metaKey: true })).toBe(false);
        expect(shouldPanFromInput({ ...base, altKey: true })).toBe(false);
    });
});

describe('computePanScrollLeft（content-follows-cursor のスクロール量）', () => {
    it('マウスを右へ動かす（currentX 増）と scrollLeft は減る（負モデル forward）', () => {
        // start=0, startX=100, currentX=160（右へ +60）→ 0 - 60 = -60
        expect(computePanScrollLeft(0, 100, 160)).toBe(-60);
    });

    it('マウスを左へ動かす（currentX 減）と scrollLeft は増える（backward）', () => {
        // start=-200, startX=100, currentX=60（左へ -40）→ -200 - (-40) = -160
        expect(computePanScrollLeft(-200, 100, 60)).toBe(-160);
    });

    it('移動しなければ起点の scrollLeft のまま', () => {
        expect(computePanScrollLeft(-123, 100, 100)).toBe(-123);
    });

    it('移動量と scrollLeft の変化は 1:1（絶対値一致）', () => {
        const start = -500;
        const startX = 300;
        const moved = computePanScrollLeft(start, startX, startX + 250);
        expect(Math.abs(moved - start)).toBe(250);
    });
});
