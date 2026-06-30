/*
 * pan.test.ts
 * 対象: pan.ts の DOM 非依存な純関数
 *   - shouldPanFromInput: 押下イベントがパン開始条件（マウス・左ボタン・修飾キー無し）を満たすか
 *   - computePanForward: content-follows-cursor の forward 位置（進行符号 sign で軸・向きを吸収・1:1）
 *   - smoothVelocity / decayVelocity / shouldStartMomentum: 慣性（momentum）の数式（離脱速度の平滑・摩擦減衰・開始判定）
 * 方針: 期待値は実装ではなく pan.ts の IF コメント／要件 06-6（左ボタン＋修飾キー無し＋マウス限定でのみパン、
 *   Shift で選択へ譲る、forward＝読み進め方向の正値・進行軸ポインタ移動に対し forward は -sign 倍、離脱速度から
 *   摩擦で自然減速する慣性）から導出する（仕様駆動）。pointerdown 登録・setPointerCapture・rAF・closest 等の
 *   DOM/タイマ依存は jsdom 不安定のため自動化しない（CLAUDE.md §7）。慣性も数式（純関数）のみテストし、rAF ループ自体は手動スモークで担保する。
 */
import { describe, expect, it } from 'vitest';
import {
    shouldPanFromInput,
    computePanForward,
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

describe('computePanForward（content-follows-cursor の forward 位置）', () => {
    it('縦書き(sign=-1)：進行軸ポインタを正方向へ（右ドラッグ・+60）で forward は増える', () => {
        // start=0, startP=100, curP=160 → 0 - (-1)*60 = +60
        expect(computePanForward(0, 100, 160, -1)).toBe(60);
    });

    it('縦書き(sign=-1)：進行軸ポインタを負方向へ（左ドラッグ・-40）で forward は減る（backward）', () => {
        // start=200, startP=100, curP=60 → 200 - (-1)*(-40) = 160
        expect(computePanForward(200, 100, 60, -1)).toBe(160);
    });

    it('横書き(sign=+1)：進行軸ポインタを正方向へ（下ドラッグ・+60）で forward は減る（backward）', () => {
        // start=300, startP=100, curP=160 → 300 - (1)*60 = 240
        expect(computePanForward(300, 100, 160, 1)).toBe(240);
    });

    it('移動しなければ起点の forward のまま（両モード）', () => {
        expect(computePanForward(123, 100, 100, -1)).toBe(123);
        expect(computePanForward(123, 100, 100, 1)).toBe(123);
    });

    it('移動量と forward の変化は 1:1（絶対値一致・符号は sign 依存）', () => {
        expect(Math.abs(computePanForward(500, 300, 550, -1) - 500)).toBe(250);
        expect(Math.abs(computePanForward(500, 300, 550, 1) - 500)).toBe(250);
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
