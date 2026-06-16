/*
 * pan.test.ts
 * 対象: pan.ts の DOM 非依存な純関数
 *   - shouldPanFromInput: 押下イベントがパン開始条件（マウス・左ボタン・修飾キー無し）を満たすか
 *   - computePanScrollLeft: content-follows-cursor のスクロール量（負モデル・1:1）
 *   - smoothVelocity / decayVelocity / shouldStartMomentum: 慣性（momentum）の数式（離脱速度の平滑・摩擦減衰・開始判定）
 * 方針: 期待値は実装ではなく pan.ts の IF コメント／要件 06-6（左ボタン＋修飾キー無し＋マウス限定でのみパン、
 *   Shift で選択へ譲る、縦書き負モデル forward＝scrollLeft 負方向、離脱速度から摩擦で自然減速する慣性）から
 *   導出する（仕様駆動）。pointerdown 登録・setPointerCapture・rAF・closest 等の DOM/タイマ依存は jsdom 不安定の
 *   ため自動化しない（CLAUDE.md §7）。慣性も数式（純関数）のみテストし、rAF ループ自体は手動スモークで担保する。
 */
import { describe, expect, it } from 'vitest';
import {
    shouldPanFromInput,
    computePanScrollLeft,
    smoothVelocity,
    decayVelocity,
    shouldStartMomentum,
    FRAME_REF_MS,
} from './pan';

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

describe('smoothVelocity（離脱速度の指数平滑）', () => {
    it('prev*(1-weight)+instantaneous*weight を返す（weight=0.8）', () => {
        // 0*0.2 + 2*0.8 = 1.6
        expect(smoothVelocity(0, 2, 0.8)).toBeCloseTo(1.6);
        // 2*0.2 + 0*0.8 = 0.4（フリック後に止まる方向の入力で速度が縮む）
        expect(smoothVelocity(2, 0, 0.8)).toBeCloseTo(0.4);
    });

    it('weight=1 は新サンプルそのまま／weight=0 は旧値そのまま', () => {
        expect(smoothVelocity(5, -3, 1)).toBe(-3);
        expect(smoothVelocity(5, -3, 0)).toBe(5);
    });
});

describe('shouldStartMomentum（慣性を開始すべきか）', () => {
    it('閾値ちょうどは開始する（>=）', () => {
        expect(shouldStartMomentum(0.2, 0.2)).toBe(true);
    });

    it('閾値未満は開始しない（微調整ドラッグ）', () => {
        expect(shouldStartMomentum(0.19, 0.2)).toBe(false);
    });

    it('スクロール方向に依らず絶対値で判定する（負の離脱速度でも開始）', () => {
        expect(shouldStartMomentum(-0.5, 0.2)).toBe(true);
        expect(shouldStartMomentum(-0.1, 0.2)).toBe(false);
    });
});

describe('decayVelocity（摩擦によるフレームレート非依存の速度減衰）', () => {
    it('基準1フレーム（FRAME_REF_MS）経過で velocity*friction になる', () => {
        expect(decayVelocity(1, FRAME_REF_MS, 0.92)).toBeCloseTo(0.92);
        expect(decayVelocity(-2, FRAME_REF_MS, 0.9)).toBeCloseTo(-1.8);
    });

    it('dt=0 では速度は変わらない', () => {
        expect(decayVelocity(1.5, 0, 0.92)).toBe(1.5);
    });

    it('経過時間が長いほど速度は単調に減衰する（friction<1）', () => {
        const v = 1;
        const oneFrame = Math.abs(decayVelocity(v, FRAME_REF_MS, 0.92));
        const twoFrame = Math.abs(decayVelocity(v, 2 * FRAME_REF_MS, 0.92));
        expect(twoFrame).toBeLessThan(oneFrame);
    });

    it('フレームレート非依存：まとめて 2 フレーム分減衰 = 1 フレーム×2 回（合成則）', () => {
        const v = 1;
        const once = decayVelocity(v, 2 * FRAME_REF_MS, 0.92);
        const twice = decayVelocity(decayVelocity(v, FRAME_REF_MS, 0.92), FRAME_REF_MS, 0.92);
        expect(once).toBeCloseTo(twice);
    });
});
