/*
 * nav.ts
 * 責務: 本文ページ／巻末あとがきページの末尾ボタン（進行 #btn-next、巻末あとがき導線 #btn-afterword）の
 *       イベント登録と表示更新、戻る遷移 goPrev()（開幕アフォーダンスの「もどる」から呼ばれる）、
 *       sec 末尾（またはあとがき末尾）到達の検知と読了記録。
 * export: init(), initAfterword(vol), update(), updateAfterword(), goPrev(), arm()
 * 依存: axis.ts / state.ts / bookmark.ts / transition.ts
 *
 * ── 本文モード（init / update / goPrev） ──────────────────────────
 *   進行 #btn-next（読み終わり端）:
 *     - state.getNextUrl() があれば「次へ」ラベルで transition.leave 遷移
 *     - null（次 ep が無い・未公開）なら「目次へ戻る」ラベル、押下で目次へ即遷移（フェードなし・要件 06-1）
 *   巻末あとがきボタン #btn-afterword（次へボタンの直後・巻末公開 sec でのみ表示）:
 *     - state.getAfterwordUrlIfEndOfVolume() が非 null なら hidden を外し、「第◯巻あとがき」ラベルで
 *       transition.leave で当 vol のあとがきページへ遷移。次へボタンを優先（読み進め動作を最優先＝要件）。
 *   戻る goPrev()（端の戻るボタンは廃止・開幕アフォーダンスの「もどる」から呼ばれる）:
 *     - state.getPrevUrl()（前 sec 本文／当 ep 先頭 sec は当 ep タイトル）へ transition.leave
 *     - 前 sec 本文へ戻るときは pendingScrollEnd を遷移前に書く（本文末着地）
 *   読了記録:
 *     - #main-container のスクロールで本文末（末尾余白の手前）到達を検知し bookmark.recordRead を1回だけ呼ぶ
 *
 * ── あとがきモード（initAfterword / updateAfterword / goPrev） ────────
 *   進行 #btn-next:
 *     - state.getAfterwordNextUrl() があれば「次へ」ラベルで transition.leave 遷移（次巻タイトルページ）
 *     - null（最終 vol あとがき or 次巻未公開）なら「目次へ戻る」ラベル、押下で目次へ即遷移
 *   あとがきボタン #btn-afterword: あとがきページからさらにあとがきに行く導線は無い＝常に hidden
 *   戻る goPrev():
 *     - state.getAfterwordPrevAddress()（自 vol の巻末公開 sec）へ pendingScrollEnd を書いて transition.leave
 *     - 前 sec が取れない（vol に公開 sec 無し等）は目次へフォールバック
 *   読了記録:
 *     - あとがき末尾到達で bookmark.recordReadAfterword(vol) を1回だけ呼ぶ
 *
 * ★ 読了検知は arm() で有効化されるまで no-op。main.ts が初期スクロール復元完了後に arm() する
 *   （復元スクロールでの誤読了を防ぐ）。
 */

import * as axis from './axis';
import * as state from './state';
import * as bookmark from './bookmark';
import * as transition from './transition';

let _btnNext!: HTMLButtonElement;
let _btnAfterword: HTMLButtonElement | null = null;
let _mode: 'sec' | 'afterword' = 'sec';
let _afterwordVol = 0;

// 末尾ボタンのラベル（縦横とも日本語）。
const BTN_NEXT_NEXT_TEXT = '次へ';
const BTN_NEXT_INDEX_TEXT = '目次へ戻る';

// あとがきボタンのラベル。vol 番号は全角（縦書きモードでは #btn-afterword に writing-mode:vertical-rl が
// 効くため、半角数字だと1文字ずつ横に倒れる。全角なら1マス1字で縦に立つ）。
// 他 UI（opening.ts の開幕ラベル・index.ts の目次チップ・feedback.ts の X ポスト）は横書き文脈なので
// 半角のまま。あとがきボタンだけ縦書きに晒されるため、ここでのみ全角化する。
function afterwordLabel(vol: number): string {
    const zenkakuVol = String(vol).replace(/[0-9]/g, (d) =>
        String.fromCharCode(d.charCodeAt(0) + 0xFEE0),
    );
    return `第${zenkakuVol}巻あとがき`;
}

// sec 末尾到達判定のしきい値（px）。スクロール端のサブピクセル誤差を吸収する。
const END_EPSILON = 4;

// 当ページの読了を記録済みかのガード（多重記録防止）
let _readRecorded = false;

// 読了検知の有効化ガード。初期スクロール復元でのプログラム的スクロールでの誤読了を防ぐため、
// main.ts が復元スクロール発火後に arm() するまで _onScroll は no-op。
let _readDetectionArmed = false;

// 本文モードで初期化。DOM 取得・クリック／スクロールリスナ登録。
// init(): void
export function init(): void {
    _mode = 'sec';
    _btnNext = document.querySelector<HTMLButtonElement>('#btn-next')!;
    _btnAfterword = document.querySelector<HTMLButtonElement>('#btn-afterword');

    _btnNext.addEventListener('click', () => {
        const next = state.getNextUrl();
        // 次がある＝離脱フェード。次 ep なし（null）＝目次へ即時遷移（フェードなし・要件 06-1）。
        if (next) transition.leave(next);
        else location.href = state.indexUrl();
    });

    _btnAfterword?.addEventListener('click', () => {
        const url = state.getAfterwordUrlIfEndOfVolume();
        if (url) transition.leave(url);
    });

    _wireScroll();
}

// あとがきモードで初期化。afterword モード時の click ハンドラを設定する。
// initAfterword(vol: number): void
export function initAfterword(vol: number): void {
    _mode = 'afterword';
    _afterwordVol = vol;
    _btnNext = document.querySelector<HTMLButtonElement>('#btn-next')!;
    _btnAfterword = document.querySelector<HTMLButtonElement>('#btn-afterword');

    _btnNext.addEventListener('click', () => {
        const next = state.getAfterwordNextUrl();
        if (next) transition.leave(next);
        else location.href = state.indexUrl();
    });

    // あとがきページからさらにあとがきに行く導線は無い＝常に hidden で維持
    if (_btnAfterword) _btnAfterword.hidden = true;

    _wireScroll();
}

// scroll リスナの共通結線。init / initAfterword の両方で1度だけ呼ぶ。
function _wireScroll(): void {
    const container = document.querySelector<HTMLElement>('#main-container');
    if (container) {
        container.addEventListener('scroll', () => _onScroll(container), { passive: true });
    }
}

// 本文末（末尾の恒久余白の手前）への到達を検知し、初回だけ読了として記録する。
// arm() 前（初期スクロール復元中）は no-op。あとがきモードでは recordReadAfterword を呼ぶ。
// _onScroll(container: HTMLElement): void
function _onScroll(container: HTMLElement): void {
    if (!_readDetectionArmed) return;
    if (_readRecorded) return;
    const range = axis.getProgressRange(container);
    if (range <= 1) return; // スクロール不能（極端に短い）は対象外
    const textEnd = range - axis.getClientSize(container);
    if (axis.getProgress(container) >= textEnd - END_EPSILON) {
        _readRecorded = true;
        if (_mode === 'afterword') {
            bookmark.recordReadAfterword(_afterwordVol);
        } else {
            const { ep, sec } = state.getCurrent();
            bookmark.recordRead(ep, sec);
        }
    }
}

// 末尾ボタン（本文モード）のラベルを現在位置に応じて更新する。main.ts が初期描画後に呼ぶ。
// あとがきボタンの表示制御も併せて行う（巻末公開 sec のときのみ表示）。
// update(): void
export function update(): void {
    if (_mode !== 'sec') return;
    const next = state.getNextUrl();
    _btnNext.disabled = false;
    _btnNext.classList.add('is-text-label');
    const label = next === null ? BTN_NEXT_INDEX_TEXT : BTN_NEXT_NEXT_TEXT;
    _btnNext.textContent = label;
    _btnNext.setAttribute('aria-label', label);

    // 巻末公開 sec かつ afterword.published=true のときのみ #btn-afterword を出す
    if (_btnAfterword) {
        const afterwordUrl = state.getAfterwordUrlIfEndOfVolume();
        const vol = state.getCurrentVolume();
        if (afterwordUrl !== null && vol) {
            const lbl = afterwordLabel(vol.volume);
            _btnAfterword.textContent = lbl;
            _btnAfterword.setAttribute('aria-label', lbl);
            _btnAfterword.classList.add('is-text-label');
            _btnAfterword.hidden = false;
        } else {
            _btnAfterword.hidden = true;
        }
    }
}

// あとがきモード用の次ボタン更新。次巻タイトルページ／目次のラベルを差し替える。
// updateAfterword(): void
export function updateAfterword(): void {
    if (_mode !== 'afterword') return;
    const next = state.getAfterwordNextUrl();
    _btnNext.disabled = false;
    _btnNext.classList.add('is-text-label');
    const label = next === null ? BTN_NEXT_INDEX_TEXT : BTN_NEXT_NEXT_TEXT;
    _btnNext.textContent = label;
    _btnNext.setAttribute('aria-label', label);
    if (_btnAfterword) _btnAfterword.hidden = true;
}

// 読了検知を有効化する。main.ts が初期スクロール復元のプログラム的スクロール発火後に呼ぶ。
// arm(): void
export function arm(): void {
    _readDetectionArmed = true;
}

// 戻る遷移を実行する（開幕アフォーダンス「もどる」＝ opening.ts から呼ばれる）。
// 本文モード：前 sec 本文 or 当 ep タイトルへ。前 sec は本文末着地。
// あとがきモード：自 vol の巻末公開 sec 本文へ。本文末着地。無ければ目次へフォールバック。
// goPrev(): void
export function goPrev(): void {
    if (_mode === 'afterword') {
        const prev = state.getAfterwordPrevAddress();
        if (prev === null) {
            location.href = state.indexUrl();
            return;
        }
        bookmark.writePendingScrollEnd(prev.ep, prev.sec);
        transition.leave(state.getBodyUrl(prev.ep, prev.sec));
        return;
    }
    const url = state.getPrevUrl();
    if (url === null) return;
    const prev = state.getPrevAddress();
    if (prev) bookmark.writePendingScrollEnd(prev.ep, prev.sec);
    transition.leave(url);
}
