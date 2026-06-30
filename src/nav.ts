/*
 * nav.ts
 * 責務: 本文ページの末尾ボタン（進行 #btn-next）のイベント登録と表示更新、
 *       戻る遷移 goPrev()（開幕アフォーダンスの「もどる」から呼ばれる）、および sec 末尾到達の検知と読了記録。
 * export: init(), update(), goPrev(), arm()
 * 依存: axis.ts / state.ts / bookmark.ts / transition.ts
 *
 * 遷移（マルチページ・ハッシュ廃止。離脱フェードは transition.leave 経由）:
 *   進行 #btn-next（エリア D・読み終わり端。縦横とも日本語ラベル）:
 *     - state.getNextUrl() があれば「次へ」ラベルで transition.leave 遷移（次 sec 本文／ep 境界は次 ep タイトル）
 *     - null（次 ep が無い・未公開）なら「目次へ戻る」ラベルに変え、押下で目次へ即遷移（フェードなし・要件 06-1）
 *   戻る goPrev()（端の戻るボタンは廃止。開幕アフォーダンスの「もどる」＝opening.ts が呼ぶ）:
 *     - state.getPrevUrl()（前 sec 本文／当 ep 先頭 sec は当 ep タイトル）へ transition.leave で遷移
 *     - 前 sec 本文へ戻るときは、その sec の「本文末（読み終わり側）」へ着地させる pendingScrollEnd を遷移前に書く
 *       （タイトル「戻る」と同じ仕組み。先頭 sec→ep タイトルは本文末が無いため書かない）
 *
 * 読了記録（Phase 2）:
 *   #main-container のスクロールを監視し、本文末（末尾の恒久余白の手前＝axis.getProgress ≥ range − 進行軸ビューポート長）へ
 *   到達した時点で bookmark.recordRead(ep, sec) を1回だけ呼ぶ（フラグでガード）。末尾には本文表示幅ぶんの
 *   恒久余白（btn-container-end）があるため、絶対終端ではなく余白の手前を閾値にする（最終行で止まる読者を取りこぼさない）。
 *   ボタンの「端でのみ表示」はスクロールコンテンツ両端配置のレイアウトで実質達成済みのため、表示制御はせず検知のみ行う。
 *   ★ 検知は arm() で有効化されるまで no-op。main.ts が初期スクロール復元（pendingScrollEnd の本文末着地・
 *     オートセーブ復元など）のプログラム的スクロールを発火し終えてから arm() する。これがないと、戻る系で
 *     本文末へ復元しただけのページが「読んでいないのに読了」記録されてしまう（誤読了の防止）。
 */

import * as axis from './axis';
import * as state from './state';
import * as bookmark from './bookmark';
import * as transition from './transition';

let _btnNext!: HTMLButtonElement;

// 末尾ボタンのラベル（縦横とも日本語）。次がある＝「次へ」／次が無い（次 ep なし）＝「目次へ戻る」。
const BTN_NEXT_NEXT_TEXT = '次へ';
const BTN_NEXT_INDEX_TEXT = '目次へ戻る';

// sec 末尾到達判定のしきい値（px）。スクロール端のサブピクセル誤差を吸収する。
const END_EPSILON = 4;

// 当 sec の読了を記録済みかのガード（多重記録防止）
let _readRecorded = false;

// 読了検知の有効化ガード。初期スクロール復元（プログラム的スクロール）での誤読了を防ぐため、
// main.ts が復元スクロール発火後に arm() するまで _onScroll は no-op。
let _readDetectionArmed = false;

// DOM からボタン要素を取得し、クリック・スクロール監視イベントを登録する。
// init は起動時に1度だけ main.ts から呼ばれる。
// init(): void
export function init(): void {
    _btnNext = document.querySelector<HTMLButtonElement>('#btn-next')!;

    _btnNext.addEventListener('click', () => {
        const next = state.getNextUrl();
        // 次がある＝離脱フェード。次 ep なし（null）＝目次へ即時遷移（フェードなし・要件 06-1）。
        if (next) transition.leave(next);
        else location.href = state.indexUrl();
    });

    const container = document.querySelector<HTMLElement>('#main-container');
    if (container) {
        container.addEventListener('scroll', () => _onScroll(container), { passive: true });
    }
}

// 本文末（末尾の恒久余白の手前）への到達を検知し、初回だけ読了として記録する。
// arm() 前（初期スクロール復元中）は no-op。
// _onScroll(container: HTMLElement): void
function _onScroll(container: HTMLElement): void {
    if (!_readDetectionArmed) return;
    if (_readRecorded) return;
    const range = axis.getProgressRange(container);
    if (range <= 1) return; // スクロール不能（極端に短い sec）は対象外
    // 末尾余白（=進行軸ビューポート長）の手前＝本文末。ここを越えたら本文を読み切ったとみなす。
    const textEnd = range - axis.getClientSize(container);
    if (axis.getProgress(container) >= textEnd - END_EPSILON) {
        _readRecorded = true;
        const { ep, sec } = state.getCurrent();
        bookmark.recordRead(ep, sec);
    }
}

// 末尾ボタンのラベルを現在位置に応じて更新する。main.ts が初期描画後に呼ぶ。
// 縦横とも日本語テキスト（.is-text-label は常時付与＝書字方向で組み方向を切替える CSS のため）。
// update(): void
export function update(): void {
    const next = state.getNextUrl();
    _btnNext.disabled = false;
    _btnNext.classList.add('is-text-label');
    // 次 ep なし（null）＝「目次へ戻る」、それ以外＝「次へ」。
    const label = next === null ? BTN_NEXT_INDEX_TEXT : BTN_NEXT_NEXT_TEXT;
    _btnNext.textContent = label;
    _btnNext.setAttribute('aria-label', label);
}

// 読了検知を有効化する。main.ts が初期スクロール復元のプログラム的スクロール（scroll イベント）を
// 発火し終えてから呼ぶ。これ以降の「実スクロールでの本文末到達」だけが読了として記録される。
// arm(): void
export function arm(): void {
    _readDetectionArmed = true;
}

// 戻る遷移を実行する。前 sec 本文へ戻るときは、その sec の本文末（読み終わり側）へ着地させる
// pendingScrollEnd を書いてから離脱フェードで遷移する（タイトル「戻る」と同じ仕組み・オートセーブ復元より優先）。
// 当 ep 先頭 sec からはタイトルページへ戻る（本文末が無いためフラグは書かない）。
// 開幕アフォーダンスの「もどる」（opening.ts）が呼ぶ。
// goPrev(): void
export function goPrev(): void {
    const url = state.getPrevUrl();
    if (url === null) return;
    const prev = state.getPrevAddress();
    if (prev) bookmark.writePendingScrollEnd(prev.ep, prev.sec);
    transition.leave(url);
}
