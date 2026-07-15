/*
 * bg.ts
 * 責務: sec 内の全シーン背景を #bg-stack 内の N 枚 .bg-layer（<img>）として構築し、スクロールに連動して
 *       隣接レイヤー間を連続クロスフェードする。あわせて現在シーンと本文領域基準の連続進捗を導出し、結果をコールバックで通知する。
 * export: init(), subscribe() ＋ テスト用純関数（computeP / layerOpacities / deriveCurrentScene / computeProgress）
 * 依存: axis.ts（書字方向の進行軸解決。bg は本来リーフだが、横書き対応で axis のみ例外的に依存する＝両者ともリーフ
 *       同士なので疎結合は維持。design/module-responsibilities.md の依存マトリクスに bg→axis を明示）。
 *       他モジュールは import しない。読書点は CSS 変数 --reading-anchor を読むのみ。
 *       現在シーン・既読・進捗・オートセーブの利用は通知を受けた reader.ts 側で行う）
 *
 * クロスフェード（台形プラトー方式・要件 06-3）:
 *   - 各シーンコンテナ（#scene-content .scene・DOM 順＝読書順）の getBoundingClientRect() を進行軸へ投影し中心 c_k を読む
 *     （縦書き=水平 [left,right]／横書き=垂直 [top,bottom]。投影と書字方向反転は axis が解決する）
 *   - 読書点 anchor（axis.getAnchorPx＝--reading-anchor 比率を進行軸の絶対 px へ）が中心列のどこに落ちるかを線形補間し
 *     連続値 P を得る（現在シーン導出用。anchor === c_k のとき P = k）
 *   - 各レイヤーの不透明度はシーン中央付近で 1 のまま安定し、隣接シーンとの境界付近の
 *     CROSSFADE_PX 幅(px)だけで線形にクロスフェードする（境界で両側 0.5・和は常に 1）。文字サイズには連動しない
 *   - クロスフェードの境界基準は CROSSFADE_BOUNDARY で切替える:
 *       'scene-edge'（既定）   = シーンコンテナの境界辺（＝@@BG@@ 位置）。窓が BG タグ前後に広がる
 *       'center-midpoint'（旧） = 隣接シーン中心の中点。窓が BG タグ手前に寄る
 *   - 現在シーン = clamp(round(P) + 1, 1, N)（1-indexed）。CROSSFADE_BOUNDARY に依存せず常に中心ベース（computeP）
 *   - スクロール監視は rAF スロットル。登録直後に1回 emit（初期表示で進捗 0% / 現在シーン 1 を出すため）
 *
 * 背景表示ルール（要件 06-3）:
 *   - bgFile === null（@@BG@@・先頭テキスト）は src 未設定の黒レイヤー（#bg-stack の黒地が見える）
 *   - 先頭の黒い恒久余白は静止時は黒：先頭レイヤーは開幕の接近区間（読書点〜画面の読み始め端）で 0→1 に
 *     フェードアップし、読書点が本文の読み始め辺（leadEdge）に到達した時点で全表示になる（＝「読み進める」の
 *     移動完了とともに先頭背景が出そろう）。窓は接近距離に収め CROSSFADE_PX を上限とする（leadEdge と
 *     leadWindow を layerOpacities へ渡して実現。静止した開幕 scrollLeft 0 では必ず黒のまま）
 *   - bgPositionX は縦長画面（innerWidth < innerHeight）のときのみ object-position: X% center を適用
 *   - 画像ロードは現在シーン ±PRIORITY_RADIUS を優先、空き時間に残りをプリフェッチ（二重ロードは防ぐ）
 *
 * CONFIG: CROSSFADE_PX（クロスフェード窓の幅(px)・狭めると境界の切替が鋭い）/ CROSSFADE_BOUNDARY（境界基準：
 *   シーン境界辺=BGタグ位置 / 隣接中心の中点）/ ANCHOR（--reading-anchor 取得失敗時のデフォルト比率）。
 *   書字方向（進行軸・読み進め向き）は axis が解決するため bg 固有の方向定数は持たない。
 */

import * as axis from './axis';
import type { ScrollNotification, BgLayerSpec } from './types';

// ── CONFIG（実機で調整する定数）─────────────────────────────────────
const CROSSFADE_PX = 32*3;          // クロスフェード窓の幅(px)。境界 ±CROSSFADE_PX/2 だけで切替。約1〜2行分（既定フォントで1行≒32px）
// クロスフェード窓の境界基準。現在シーン導出（computeP→deriveCurrentScene）は本定数に依存せず常に中心ベース。
//   'scene-edge'（新・既定）  : シーンコンテナの境界辺＝@@BG@@ 位置を境界とし、窓が BG タグ前後に広がる
//   'center-midpoint'（旧）   : 隣接シーン中心の中点を境界とし、窓が BG タグ手前に寄る
const CROSSFADE_BOUNDARY: 'scene-edge' | 'center-midpoint' = 'scene-edge';
const ANCHOR = 0.45;              // --reading-anchor が読めないときのフォールバック比率（0〜1）
const PRIORITY_RADIUS = 2;        // 現在シーン ±この数を優先ロード

let _specs: BgLayerSpec[] = [];
let _layers: HTMLImageElement[] = [];
let _vol = 1;
let _ep = 1;
let _loaded = new Set<number>();
let _idleScheduled = false;

let _scrollCb: ((n: ScrollNotification) => void) | null = null;
let _rafId = 0;

const _pad = (n: number) => String(n).padStart(2, '0');

// #bg-stack を空にし、シーン数ぶんの <img class="bg-layer"> を生成する。
// 黒レイヤー（bgFile null）は src を持たない。縦長画面では bgPositionX を object-position に反映する。
// 背景画像のパス組み立てには vol と ep の両方が要る（public/vol[YY]/ep[XX]/img/... 構造）ため、
// main.ts が state.getCurrentVolume() から vol を取り出して渡す。あとがきモードは vol=当 vol、ep=0
// でよい（bg 側は bgFile === null の黒レイヤーのみ描画する前提で ep パスは使わない）。
// main.ts が renderScenes() の後に呼ぶ（scene 数と layer 数を一致させるため）。
// init(layers: BgLayerSpec[], vol: number, ep: number): void
export function init(layers: BgLayerSpec[], vol: number, ep: number): void {
  _specs = layers;
  _vol = vol;
  _ep = ep;
  _loaded = new Set();
  _idleScheduled = false;

  const stack = document.getElementById('bg-stack');
  if (!stack) return;
  stack.replaceChildren();

  const portrait = window.innerWidth < window.innerHeight;
  _layers = layers.map((spec) => {
    const img = document.createElement('img');
    img.className = 'bg-layer';
    img.alt = '';
    img.decoding = 'async';
    img.style.opacity = '0';
    img.style.objectPosition = (spec.bgPositionX && portrait) ? `${spec.bgPositionX} center` : 'center center';
    stack.appendChild(img);
    return img;
  });

  // 先頭付近（初期表示の現在シーン 1 周辺）を先読みする。
  _prefetchAround(0);
}

// #main-container のスクロールを rAF スロットルで購読し、クロスフェード適用＋通知を行う。
// 登録直後に1回 emit する。main.ts が起動時に bg.subscribe(reader.handleScroll) で結線する。
// subscribe(cb: (n: ScrollNotification) => void): void
export function subscribe(cb: (n: ScrollNotification) => void): void {
  _scrollCb = cb;
  const container = document.getElementById('main-container');
  if (!container) return;
  container.addEventListener('scroll', () => {
    if (_rafId) return;
    _rafId = requestAnimationFrame(() => {
      _rafId = 0;
      _emit(container);
    });
  }, { passive: true });
  _emit(container);
}

// 現在のスクロール量・読書点からクロスフェードを適用し、ScrollNotification を通知する。
function _emit(container: HTMLElement): void {
  const scenes = document.querySelectorAll<HTMLElement>('#scene-content .scene');
  const n = Math.min(scenes.length, _layers.length);

  let currentScene = 1;
  let progress = 0;
  if (n > 0) {
    // 純関数の reverse 引数：進行に対し座標が降順なら false（vertical-rl の水平 x）、昇順なら true（horizontal-tb の垂直 y）。
    // axis.isReverse()（vertical=true）とは逆の意味になるため反転して渡す。
    const reverse = !axis.isReverse();
    const containerRect = container.getBoundingClientRect();
    // 読書点を進行軸の絶対 px へ（縦書き=水平 x／横書き=垂直 y）。
    const anchor = axis.getAnchorPx(containerRect, _readAnchorRatio());

    const centers: number[] = [];
    const rects: { left: number; right: number }[] = [];
    let textStart = Infinity, textEnd = -Infinity; // 進行軸座標の最小/最大（縦書き=左右端／横書き=上下端）
    for (let k = 0; k < n; k++) {
      const r = scenes[k].getBoundingClientRect();
      // シーン矩形を進行軸へ投影（縦書き=[left,right]／横書き=[top,bottom]）。純関数の rects は {left=lo, right=hi} で受ける。
      const lo = axis.isReverse() ? r.left : r.top;
      const hi = axis.isReverse() ? r.right : r.bottom;
      centers.push((lo + hi) / 2);
      rects.push({ left: lo, right: hi });
      if (lo < textStart) textStart = lo;
      if (hi > textEnd) textEnd = hi;
    }

    // 'scene-edge' は @@BG@@ 位置（シーン境界辺）を境界に使い、窓を BG タグ前後に広げる。'center-midpoint' は隣接中心の中点（layerOpacities 既定）。
    const boundaries = CROSSFADE_BOUNDARY === 'scene-edge' ? sceneEdges(rects) : undefined;
    // 先頭の黒い恒久余白：本文の読み始め辺（縦書き=右端＝座標最大 textEnd／横書き=上端＝座標最小 textStart）を仮想境界に渡し、
    // 開幕の接近区間で黒→先頭背景へフェードアップし、読書点が読み始め辺に到達した時点で全表示にする（移動完了＝全表示）。
    const leadEdge = axis.isReverse() ? textEnd : textStart;
    // フェード窓＝接近距離（開幕余白を詰める距離＝「読み進める」移動量 ＝ 比率 × 進行軸ビューポート長）。
    // CROSSFADE_PX を上限に収めることで、静止した開幕（forward 0）では必ず黒、狭い画面でも開幕に背景が漏れない。
    const approach = _readAnchorRatio() * axis.getClientSize(container);
    const leadWindow = Math.min(CROSSFADE_PX, Math.max(0, approach));
    const opacities = layerOpacities(centers, anchor, CROSSFADE_PX, reverse, boundaries, leadEdge, leadWindow);
    for (let k = 0; k < _layers.length; k++) {
      _layers[k].style.opacity = String(k < opacities.length ? opacities[k] : 0);
    }
    currentScene = deriveCurrentScene(computeP(centers, anchor, reverse), n);
    // 進捗は本文領域（全シーンの外接区間 [textStart, textEnd]）を読書点が走る割合。前後の空白余白では 0/1 に固定。
    progress = computeProgress(textStart, textEnd, anchor, reverse);
    _prefetchAround(currentScene - 1);
  }

  const forward = axis.getProgress(container);      // forward 進行 px（0 起点・正値）
  const range = axis.getProgressRange(container);   // 進行軸の可動域（0〜range）
  _scrollCb?.({
    scrollLeft: forward, // フィールド名は後方互換で据置だが生 scrollLeft ではない
    ratio: range > 0 ? forward / range : 0, // スクロール範囲比（0〜1・書字方向非依存）。オートセーブ／履歴の位置記録用
    scrollWidth: container.scrollWidth,
    clientWidth: container.clientWidth,
    currentScene,
    progress,
  });
}

// --reading-anchor（"45%" など）を 0〜1 の比率に解析する。読めなければ ANCHOR を返す。
function _readAnchorRatio(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--reading-anchor');
  const pct = parseFloat(raw);
  if (!Number.isFinite(pct)) return ANCHOR;
  return Math.min(1, Math.max(0, pct / 100));
}

// 現在シーン中心の ±PRIORITY_RADIUS を即ロードし、残りを空き時間にプリフェッチする。
function _prefetchAround(idx: number): void {
  for (let d = 0; d <= PRIORITY_RADIUS; d++) {
    _setSrc(idx - d);
    _setSrc(idx + d);
  }
  if (_idleScheduled) return;
  _idleScheduled = true;
  const run = () => {
    _idleScheduled = false;
    for (let k = 0; k < _specs.length; k++) _setSrc(k);
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (typeof ric === 'function') ric(run);
  else setTimeout(run, 400);
}

// レイヤー k の画像を1度だけロードする。黒レイヤー（bgFile null）はロード対象外。
function _setSrc(k: number): void {
  if (k < 0 || k >= _specs.length) return;
  if (_loaded.has(k)) return;
  _loaded.add(k);
  const spec = _specs[k];
  if (!spec.bgFile) return; // 黒背景：src を持たない
  _layers[k].src = `${import.meta.env.BASE_URL}vol${_pad(_vol)}/ep${_pad(_ep)}/img/${spec.bgFile}`;
}

// ── 純関数（DOM 非依存・テスト対象）────────────────────────────────

// 中心列 centers（読書順・index 昇順）と読書点 anchorX から連続値 P を線形補間で求める。
// anchorX === centers[k] のとき P = k。読書開始側手前は 0、終端側超えは N-1 にクランプ。
// reverse=false は vertical-rl RTL（centers は x 降順）、true は方向反転（x 昇順）に対応する。
// computeP(centers: number[], anchorX: number, reverse: boolean): number
export function computeP(centers: number[], anchorX: number, reverse: boolean): number {
  const n = centers.length;
  if (n <= 1) return 0;
  // 読書が進むほど増加する座標系に正規化する（x_k は k 昇順で単調増加）。
  const sign = reverse ? 1 : -1;
  const ax = sign * anchorX;
  const x = centers.map((c) => sign * c);

  if (ax <= x[0]) return 0;
  if (ax >= x[n - 1]) return n - 1;
  for (let k = 0; k < n - 1; k++) {
    if (ax >= x[k] && ax <= x[k + 1]) {
      const span = x[k + 1] - x[k];
      return span > 0 ? k + (ax - x[k]) / span : k;
    }
  }
  return n - 1;
}

// 隣り合うシーンコンテナの「向かい合う辺」の中点（raw x）を境界として返す（長さ rects.length-1）。
// 連続配置なら共有辺＝@@BG@@（後続シーンの開始辺）に一致する。中心の左右で向きを判定するので
// vertical-rl（先頭が右）も方向反転も扱える。rects が 0〜1 枚なら境界は無いので []。
// sceneEdges(rects: { left: number; right: number }[]): number[]
export function sceneEdges(rects: { left: number; right: number }[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < rects.length - 1; k++) {
    const a = rects[k], b = rects[k + 1];
    const aRight = (a.left + a.right) / 2 > (b.left + b.right) / 2; // a が高い x 側＝先に読む側か
    out.push(aRight ? (a.left + b.right) / 2 : (a.right + b.left) / 2);
  }
  return out;
}

// 各レイヤーの不透明度を台形（プラトー）クロスフェードで求める（中心列 centers と読書点 anchorX は px）。
// シーン中央付近は 1 で安定し、隣接シーンとの境界 ±windowPx/2 の窓だけで線形にクロスフェードする
// （境界で両側 0.5・通常和は 1）。窓を狭めるほど切替が鋭い。端レイヤーは外側に隣接が無いので外側はフェードしない。
// シーン幅が窓より狭い縮退時はピークが 1 未満になるが破綻はしない（クロスフェードが緩むだけ）。
// 境界 boundaries（raw x・長さ n-1）省略時は隣接中心の中点を境界に使う（旧仕様）。明示時はその境界を使う
// （新仕様＝@@BG@@ 位置）。長さが n-1 でなければ中点へフォールバックする。
// leadEdge（raw x・省略可）を与えると先頭レイヤーは「先頭の黒い余白」を表現する：読書点が leadEdge（＝本文の
// 読み始め辺）の手前 leadWindowPx の地点で 0（黒）、そこから leadEdge まで線形に 1 へフェードアップし、leadEdge
// 到達時に全表示になる（要件 06-3。開幕の接近区間で黒から立ち上がり、移動完了＝全表示。leadEdge を越えた本文内は 1）。
// leadWindowPx（省略可）はフェード窓の幅。省略時は windowPx に揃える。leadEdge も省略なら端＝1（フェードなし）。
// layerOpacities(centers: number[], anchorX: number, windowPx: number, reverse: boolean, boundaries?: number[], leadEdge?: number, leadWindowPx?: number): number[]
export function layerOpacities(centers: number[], anchorX: number, windowPx: number, reverse: boolean, boundaries?: number[], leadEdge?: number, leadWindowPx?: number): number[] {
  const n = centers.length;
  if (n === 0) return [];
  // 読書が進むほど増加する座標系に正規化する（computeP と同じ向き）。
  const sign = reverse ? 1 : -1;
  const ax = sign * anchorX;
  const x = centers.map((c) => sign * c);
  const half = (windowPx > 0 ? windowPx : 1) / 2; // 境界 ± half でクロスフェード

  // 境界 b[k]（layer k と k+1 の間・長さ n-1）。明示境界が無効なら隣接中心の中点を使う。
  const b = boundaries && boundaries.length === n - 1
    ? boundaries.map((v) => sign * v)
    : Array.from({ length: n - 1 }, (_, k) => (x[k] + x[k + 1]) / 2);

  // 先頭の黒い恒久余白を表現する仮想境界（要件 06-3）。leadEdge があれば先頭レイヤーのフェードアップに使う。
  const leadB = leadEdge !== undefined ? sign * leadEdge : undefined;
  // フェード窓の幅（leadEdge の手前 leadW から leadEdge までで 0→1）。省略時はクロスフェード窓 2*half に揃える。
  const leadW = leadWindowPx !== undefined && leadWindowPx > 0 ? leadWindowPx : 2 * half;

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    // 手前（境界 b[k-1]）からのフェードイン／先（境界 b[k]）へのフェードアウト。端は隣接が無いので 1。
    // ただし先頭レイヤーは leadB があれば「余白（黒）→読み始め辺で全表示」に切り替える（leadEdge の手前 leadW で立ち上げる）。
    const fadeIn = k > 0
      ? clamp01((ax - (b[k - 1] - half)) / (2 * half))
      : (leadB !== undefined ? clamp01((ax - (leadB - leadW)) / leadW) : 1);
    const fadeOut = k < n - 1 ? clamp01(((b[k] + half) - ax) / (2 * half)) : 1;
    out.push(Math.min(fadeIn, fadeOut));
  }
  return out;
}

// 現在シーン（1-indexed）= clamp(round(P) + 1, 1, N)。
// deriveCurrentScene(p: number, n: number): number
export function deriveCurrentScene(p: number, n: number): number {
  if (n <= 0) return 1;
  return Math.min(n, Math.max(1, Math.round(p) + 1));
}

// 本文領域（全シーンの外接区間 [textLeft, textRight]・px）に対し、読書点 anchorX が
// 読み始めの端（reading-start edge）→ 読み終わりの端（reading-end edge）を走る割合 0〜1 を返す。
// reverse=false（vertical-rl RTL）は reading-start＝右端（textRight）／reading-end＝左端（textLeft）、true は左右反転。
// 端の外（先頭/末尾の恒久余白に読書点があるとき）は 0／1 にクランプされ、本文幅が 0 なら 0。
// computeProgress(textLeft: number, textRight: number, anchorX: number, reverse: boolean): number
export function computeProgress(textLeft: number, textRight: number, anchorX: number, reverse: boolean): number {
  // 読書が進むほど増加する座標系に正規化する（computeP と同じ向き）。
  const sign = reverse ? 1 : -1;
  const uStart = Math.min(sign * textLeft, sign * textRight); // reading-start edge（進捗 0）
  const uEnd = Math.max(sign * textLeft, sign * textRight);   // reading-end edge（進捗 1）
  const span = uEnd - uStart;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (sign * anchorX - uStart) / span));
}
