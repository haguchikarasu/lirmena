/*
 * bg.test.ts
 * 対象: bg.ts の DOM 非依存な純関数（クロスフェード算出の数学）
 *   - computeP: 中心列 + 読書点 → 連続値 P（線形補間・両端クランプ・方向反転）
 *   - layerOpacities: 台形プラトー。中央は不透明度1、境界±windowPx/2 の窓だけで線形クロスフェード（境界で 0.5・和=1）
 *   - deriveCurrentScene: clamp(round(P)+1, 1, N)
 *   - computeProgress: 本文領域 [textLeft, textRight] を読書点が読み始め端→読み終わり端へ走る割合 0〜1（両端クランプ・方向反転）
 * 方針: 期待値は実装ではなく要件 06-3（台形プラトー方式の式）／06-6（本文前後の恒久余白で読書点が両端へ届く）から導出する（仕様駆動）。
 *   getBoundingClientRect / scroll に依存する _emit・init・subscribe は jsdom 不安定のため自動化しない（CLAUDE.md §7）。
 */
import { describe, expect, it } from 'vitest';
import { computeP, layerOpacities, deriveCurrentScene, sceneEdges, computeProgress, buildBgUrl } from './bg';

describe('computeP（読書点 → 連続値 P）', () => {
    // vertical-rl RTL：中心列は x 降順（scene0 が右＝最大 x）。reverse=false。
    const rtl = [400, 300, 200, 100];

    it('anchorX が中心 c_k 上のとき P = k', () => {
        expect(computeP(rtl, 400, false)).toBeCloseTo(0);
        expect(computeP(rtl, 300, false)).toBeCloseTo(1);
        expect(computeP(rtl, 200, false)).toBeCloseTo(2);
        expect(computeP(rtl, 100, false)).toBeCloseTo(3);
    });

    it('隣接中心の中点で P = k + 0.5', () => {
        expect(computeP(rtl, 350, false)).toBeCloseTo(0.5);
        expect(computeP(rtl, 150, false)).toBeCloseTo(2.5);
    });

    it('読書開始側手前は 0、終端側超えは N-1 にクランプ', () => {
        expect(computeP(rtl, 500, false)).toBeCloseTo(0);   // c0 より右
        expect(computeP(rtl, 50, false)).toBeCloseTo(3);    // c3 より左
    });

    it('reverse=true（中心列 x 昇順・方向反転）でも同じ意味になる', () => {
        const ltr = [100, 200, 300, 400];
        expect(computeP(ltr, 200, true)).toBeCloseTo(1);
        expect(computeP(ltr, 150, true)).toBeCloseTo(0.5);
        expect(computeP(ltr, 50, true)).toBeCloseTo(0);     // 開始手前
        expect(computeP(ltr, 500, true)).toBeCloseTo(3);    // 終端超え
    });

    it('シーンが0〜1枚なら P=0', () => {
        expect(computeP([], 100, false)).toBe(0);
        expect(computeP([200], 100, false)).toBe(0);
    });
});

describe('layerOpacities（台形プラトー・境界±windowPx/2 だけでクロスフェード）', () => {
    // vertical-rl RTL：中心列は x 降順。隣接中心の中点が境界（350 / 250 / 150）。窓幅40 → 境界±20。
    const rtl = [400, 300, 200, 100];
    const W = 40;

    it('シーン中央〜窓の外は当該レイヤーのみ 1（プラトー：中央が削れない）', () => {
        expect(layerOpacities(rtl, 300, W, false)).toEqual([0, 1, 0, 0]); // 中央
        expect(layerOpacities(rtl, 320, W, false)).toEqual([0, 1, 0, 0]); // 境界350から30px(>20)でも 1
    });

    it('境界上で両側 0.5・窓内は線形・和は常に 1', () => {
        const mid = layerOpacities(rtl, 350, W, false); // 境界上
        expect(mid[0]).toBeCloseTo(0.5);
        expect(mid[1]).toBeCloseTo(0.5);
        const lin = layerOpacities(rtl, 360, W, false); // 境界+10
        expect(lin[0]).toBeCloseTo(0.75);
        expect(lin[1]).toBeCloseTo(0.25);
    });

    it('窓の端で隣接シーンへ完全に切り替わる', () => {
        expect(layerOpacities(rtl, 370, W, false)).toEqual([1, 0, 0, 0]); // 境界+20
        expect(layerOpacities(rtl, 330, W, false)).toEqual([0, 1, 0, 0]); // 境界-20
    });

    it('reverse=true（x 昇順）でも中央は当該レイヤーのみ 1', () => {
        expect(layerOpacities([100, 200, 300, 400], 200, W, true)).toEqual([0, 1, 0, 0]);
    });

    it('シーン0〜1枚 / windowPx<=0 でも破綻しない', () => {
        expect(layerOpacities([], 100, W, false)).toEqual([]);
        expect(layerOpacities([200], 100, W, false)).toEqual([1]);
        const o = layerOpacities([400, 300], 350, 0, false); // 1px幅にフォールバック（0除算回避）
        expect(o[0]).toBeCloseTo(0.5);
        expect(o.every((v) => Number.isFinite(v))).toBe(true);
    });
});

describe('sceneEdges（向かい合う辺の中点＝@@BG@@ 位置）', () => {
    it('vertical-rl（先頭が右・x 降順）：連続配置なら共有辺＝後続シーンの開始辺を返す', () => {
        // scene0=[300,500]・scene1=[200,300]・scene2=[100,200]（連続）→ 共有辺 300 / 200
        const rects = [
            { left: 300, right: 500 },
            { left: 200, right: 300 },
            { left: 100, right: 200 },
        ];
        expect(sceneEdges(rects)).toEqual([300, 200]);
    });

    it('シーン幅が不揃いだと中心の中点とはズレる（境界＝@@BG@@ の実位置を返す）', () => {
        // scene0=[300,500]（幅200・中心400）・scene1=[200,300]（幅100・中心250）。共有辺=300、中心中点=325。
        const rects = [
            { left: 300, right: 500 },
            { left: 200, right: 300 },
        ];
        expect(sceneEdges(rects)).toEqual([300]); // 中心中点 325 ではなく実境界 300
    });

    it('コンテナ間に隙間があるとき隙間の中点を返す', () => {
        // scene0=[310,500]・scene1=[200,290]（290〜310 が隙間）→ (310+290)/2 = 300
        const rects = [
            { left: 310, right: 500 },
            { left: 200, right: 290 },
        ];
        expect(sceneEdges(rects)).toEqual([300]);
    });

    it('方向反転（先頭が左・x 昇順）でも向かい合う辺の中点を返す', () => {
        // scene0=[100,200]・scene1=[200,300]（連続）→ 共有辺 200
        const rects = [
            { left: 100, right: 200 },
            { left: 200, right: 300 },
        ];
        expect(sceneEdges(rects)).toEqual([200]);
    });

    it('シーン0〜1枚なら境界は無いので []', () => {
        expect(sceneEdges([])).toEqual([]);
        expect(sceneEdges([{ left: 100, right: 200 }])).toEqual([]);
    });
});

describe('layerOpacities ＋明示境界（新仕様：窓が @@BG@@ 前後に広がる）', () => {
    // vertical-rl：中心列 x 降順。中心中点は 350/250/150。窓幅40 → 境界±20。
    const rtl = [400, 300, 200, 100];
    const W = 40;

    it('境界を中点からズラすと 0.5 クロスオーバーがその境界へ移る', () => {
        // 第1境界を 350→360 に移すと、360 で両側 0.5（中点版は 360 で [0.75,0.25]）
        const b = [360, 250, 150];
        const mid = layerOpacities(rtl, 360, W, false, b);
        expect(mid[0]).toBeCloseTo(0.5);
        expect(mid[1]).toBeCloseTo(0.5);
        // 同じ anchorX を既定（中点）で見ると 0.5 ではない＝境界が確かに移動している
        const def = layerOpacities(rtl, 360, W, false);
        expect(def[0]).toBeCloseTo(0.75);
        expect(def[1]).toBeCloseTo(0.25);
    });

    it('移した境界の前後で線形にクロスフェードし、プラトーは当該レイヤーのみ 1', () => {
        const b = [360, 250, 150];
        expect(layerOpacities(rtl, 380, W, false, b)).toEqual([1, 0, 0, 0]); // 境界360+20：layer0 側へ完全
        expect(layerOpacities(rtl, 340, W, false, b)).toEqual([0, 1, 0, 0]); // 境界360-20：layer1 側へ完全
        expect(layerOpacities(rtl, 300, W, false, b)).toEqual([0, 1, 0, 0]); // 窓外プラトー
    });

    it('境界が等幅連続シーンの実辺なら中点版と一致する（等幅では @@BG@@ ＝中心中点）', () => {
        // rtl の中心に対応する等幅(100)連続コンテナ。sceneEdges → [350,250,150] ＝中点。
        const equalRects = [
            { left: 350, right: 450 },
            { left: 250, right: 350 },
            { left: 150, right: 250 },
            { left: 50, right: 150 },
        ];
        const edges = sceneEdges(equalRects);
        expect(edges).toEqual([350, 250, 150]);
        expect(layerOpacities(rtl, 360, W, false, edges)).toEqual(layerOpacities(rtl, 360, W, false));
    });

    it('境界の長さが n-1 でなければ中点へフォールバックする', () => {
        const bad = [360]; // n=4 なので 3 本必要
        expect(layerOpacities(rtl, 360, W, false, bad)).toEqual(layerOpacities(rtl, 360, W, false));
    });
});

describe('layerOpacities ＋ leadEdge（開幕の接近区間でフェードアップ・読み始め辺で全表示）', () => {
    // vertical-rl RTL：中心列 x 降順。窓幅40 → 境界±20。
    // leadEdge=460＝先頭シーンの読み始め辺（中心400より右）。leadWindowPx 省略＝窓幅 40 を流用。
    // 余白の奥（leadEdge より窓ぶん手前）で 0、leadEdge へ近づくほど 1、leadEdge 到達＝全表示（＝移動完了点）。
    const rtl = [400, 300, 200, 100];
    const W = 40;
    const LEAD = 460;

    it('読み始め辺の十分手前（先頭余白の奥）では先頭レイヤーは 0（黒・静止した開幕）', () => {
        expect(layerOpacities(rtl, 500, W, false, undefined, LEAD)[0]).toBeCloseTo(0); // 辺から窓ぶん右＝余白の奥
        expect(layerOpacities(rtl, 520, W, false, undefined, LEAD)[0]).toBeCloseTo(0); // さらに右でも 0
    });

    it('開幕の接近区間で 0→1 にフェードアップし、読み始め辺で全表示になる', () => {
        expect(layerOpacities(rtl, 480, W, false, undefined, LEAD)[0]).toBeCloseTo(0.5); // 辺から窓半分手前＝0.5
        expect(layerOpacities(rtl, 460, W, false, undefined, LEAD)[0]).toBeCloseTo(1);   // 辺ちょうど＝全表示（移動完了点）
        expect(layerOpacities(rtl, 440, W, false, undefined, LEAD)[0]).toBeCloseTo(1);   // 本文内も 1 のまま
    });

    it('leadWindowPx を渡すとフェード窓の幅を上書きできる（接近距離に合わせる）', () => {
        // 窓幅 80：辺から 80 手前で 0、40 手前で 0.5、辺で 1。
        expect(layerOpacities(rtl, 540, W, false, undefined, LEAD, 80)[0]).toBeCloseTo(0);
        expect(layerOpacities(rtl, 500, W, false, undefined, LEAD, 80)[0]).toBeCloseTo(0.5);
        expect(layerOpacities(rtl, 460, W, false, undefined, LEAD, 80)[0]).toBeCloseTo(1);
    });

    it('leadEdge 省略時は従来どおり先頭余白でも先頭レイヤーが 1（背景が出たまま）＝差分を確認', () => {
        expect(layerOpacities(rtl, 480, W, false)[0]).toBeCloseTo(1);
    });

    it('シーン1枚でも leadEdge があれば余白の奥→読み始め辺のフェードアップを適用する', () => {
        expect(layerOpacities([400], 500, W, false, undefined, 460)).toEqual([0]); // 辺から窓ぶん手前＝黒
        expect(layerOpacities([400], 460, W, false, undefined, 460)).toEqual([1]); // 辺＝全表示
        expect(layerOpacities([400], 100, W, false)).toEqual([1]);                 // leadEdge無しは従来どおり1
    });

    it('reverse=true（読み始め＝左端）でも接近区間で 0→1・読み始め辺で全表示', () => {
        const ltr = [100, 200, 300, 400];
        const lead = 80; // 先頭シーン(中心100)の読み始め辺＝左側
        expect(layerOpacities(ltr, 40, W, true, undefined, lead)[0]).toBeCloseTo(0);   // 辺から窓ぶん左＝余白の奥
        expect(layerOpacities(ltr, 60, W, true, undefined, lead)[0]).toBeCloseTo(0.5); // 辺から窓半分手前
        expect(layerOpacities(ltr, 80, W, true, undefined, lead)[0]).toBeCloseTo(1);   // 辺＝全表示
    });
});

describe('computeProgress（本文領域を読書点が走る割合 0〜1）', () => {
    // vertical-rl RTL（reverse=false）：reading-start＝右端 textRight、reading-end＝左端 textLeft。
    // 本文領域 [100, 500]（幅 400）。読書点が右端→左端へ進むほど progress 0→1。
    it('reading-start 端で 0・reading-end 端で 1・中央で 0.5', () => {
        expect(computeProgress(100, 500, 500, false)).toBeCloseTo(0); // 右端＝読み始め
        expect(computeProgress(100, 500, 100, false)).toBeCloseTo(1); // 左端＝読み終わり
        expect(computeProgress(100, 500, 300, false)).toBeCloseTo(0.5);
        expect(computeProgress(100, 500, 400, false)).toBeCloseTo(0.25);
    });

    it('本文の外（先頭/末尾の余白に読書点があるとき）は 0／1 にクランプ', () => {
        expect(computeProgress(100, 500, 600, false)).toBeCloseTo(0); // 右端より右（先頭余白）
        expect(computeProgress(100, 500, 50, false)).toBeCloseTo(1);  // 左端より左（末尾余白）
    });

    it('reverse=true（方向反転）では reading-start＝左端 textLeft', () => {
        expect(computeProgress(100, 500, 100, true)).toBeCloseTo(0);
        expect(computeProgress(100, 500, 500, true)).toBeCloseTo(1);
        expect(computeProgress(100, 500, 300, true)).toBeCloseTo(0.5);
        expect(computeProgress(100, 500, 50, true)).toBeCloseTo(0);  // 開始端より外
        expect(computeProgress(100, 500, 600, true)).toBeCloseTo(1); // 終端より外
    });

    it('本文幅 0（textLeft === textRight）なら 0', () => {
        expect(computeProgress(300, 300, 300, false)).toBe(0);
        expect(computeProgress(300, 300, 999, false)).toBe(0);
    });
});

describe('buildBgUrl（BgSource ごとに vol/ep 直下を切替）', () => {
    it('kind: ep は vol[XX]/ep[YY]/img/{ファイル名} を返す（本文モード・要件 03/05-1）', () => {
        expect(buildBgUrl({ kind: 'ep', vol: 1, ep: 2 }, 'foo.avif')).toBe('vol01/ep02/img/foo.avif');
    });

    it('kind: afterword は vol[XX]/{ファイル名} 直下を返す（あとがきモード・ep/img/ を切らず heroCard と同居・要件 03/06-3）', () => {
        expect(buildBgUrl({ kind: 'afterword', vol: 1 }, 'alley.avif')).toBe('vol01/alley.avif');
    });

    it('vol / ep は2桁ゼロ埋め（1桁を必ず補完＝命名規則と一致）', () => {
        expect(buildBgUrl({ kind: 'ep', vol: 9, ep: 3 }, 'x.avif')).toBe('vol09/ep03/img/x.avif');
        expect(buildBgUrl({ kind: 'afterword', vol: 9 }, 'x.avif')).toBe('vol09/x.avif');
    });

    it('2桁の vol / ep はそのまま連結（3桁化しない）', () => {
        expect(buildBgUrl({ kind: 'ep', vol: 12, ep: 34 }, 'z.avif')).toBe('vol12/ep34/img/z.avif');
        expect(buildBgUrl({ kind: 'afterword', vol: 12 }, 'z.avif')).toBe('vol12/z.avif');
    });

    it('BASE_URL は含まない（呼び出し側で連結する契約）', () => {
        const url = buildBgUrl({ kind: 'ep', vol: 1, ep: 1 }, 'a.avif');
        expect(url.startsWith('/')).toBe(false);
        expect(url.startsWith('vol')).toBe(true);
    });
});

describe('deriveCurrentScene = clamp(round(P)+1, 1, N)', () => {
    it('P から 1-indexed 現在シーンを導出する', () => {
        expect(deriveCurrentScene(0, 4)).toBe(1);
        expect(deriveCurrentScene(1, 4)).toBe(2);
        expect(deriveCurrentScene(0.5, 4)).toBe(2);   // round(0.5)=1 → 2
        expect(deriveCurrentScene(2.4, 4)).toBe(3);   // round(2.4)=2 → 3
        expect(deriveCurrentScene(3, 4)).toBe(4);
    });

    it('[1, N] にクランプする', () => {
        expect(deriveCurrentScene(5, 4)).toBe(4);
        expect(deriveCurrentScene(-1, 4)).toBe(1);
        expect(deriveCurrentScene(0, 0)).toBe(1);
    });
});
