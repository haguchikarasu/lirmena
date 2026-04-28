/*
 * nav.ts
 * 責務: 進行・戻るボタンのイベント登録・ラベル更新
 * export: init(), update()
 * 依存: state.ts, transition.ts（循環依存を main.ts のコールバック注入で解消）
 *
 * 循環依存の解消方法：
 *   nav.ts は transition.trigger() を直接呼ぶ（import あり）。
 *   transition.ts は nav.ts を import しない。
 *   代わりに main.ts が `update` をコールバックとして transition に渡し、
 *   遷移完了後に transition 側からコールバック経由で update を呼ぶ。
 *
 * ボタンラベル仕様：
 *   タイトルカード表示中（scene === 0）：
 *     戻るボタン → 「前のセクションへ」
 *     進行ボタン → 「はじめる」（または「読む」等・実装時に確定）
 *   通常シーン（scene >= 1）：
 *     最後のシーン → 進行ボタンのラベルを「次のセクションへ」
 *     それ以外    → 通常の進行ラベル（例：「次へ」）
 *
 * キーボード操作：
 *   Tab 順序は進行ボタン（エリアD）優先、戻るボタン（エリアA）は後
 */

import type { SceneAddress } from "./types";
import * as state from "./state";
import * as transition from "./transition";

let _btnNext!: HTMLButtonElement;
let _btnPrev!: HTMLButtonElement;

// DOM からボタン要素を querySelector で取得し、クリックイベントを登録する
// - 進行ボタン押下: state.getNext() を取得し transition.trigger() を呼ぶ
// - 戻るボタン押下: state.getPrev() を取得し transition.trigger() を呼ぶ
// - init は起動時に1度だけ main.ts から呼ばれる
// init(): void
export function init(): void {
    _btnNext = document.querySelector<HTMLButtonElement>('#btn-next')!;
    _btnPrev = document.querySelector<HTMLButtonElement>('#btn-prev')!;

    _btnNext.addEventListener('click', () => {
        const addr = state.getNext();
        if (addr) transition.trigger(addr);
    });

    _btnPrev.addEventListener('click', () => {
        const addr = state.getPrev();
        if (addr) transition.trigger(addr);
    });
}

// ボタンのラベルと有効/無効状態を現在のアドレスに応じて更新する
// - transition 完了後に main.ts が transition へ渡したコールバック経由で呼ばれる
// update(): void
export function update(): void {
    const address: SceneAddress = state.getCurrent();
    const next = state.getNext();
    const prev = state.getPrev();
    const isLastScene = address.scene > 0 && address.scene === state.getScenesCount();

    if (address.scene === 0) {
        _btnNext.textContent = 'はじめる';
    } else if (isLastScene) {
        _btnNext.textContent = '次のセクションへ';
    } else {
        _btnNext.textContent = '次へ';
    }
    _btnNext.disabled = next === null;

    _btnPrev.textContent = address.scene === 0 ? '前のセクションへ' : '戻る';
    _btnPrev.disabled = prev === null;
}