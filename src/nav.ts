/*
 * nav.ts
 * 責務: 進行・戻るボタンのイベント登録・有効無効更新
 * export: init(), update()
 * 依存: state.ts, transition.ts（循環依存を main.ts のコールバック注入で解消）
 *
 * 循環依存の解消方法：
 *   nav.ts は transition.trigger() を直接呼ぶ（import あり）。
 *   transition.ts は nav.ts を import しない。
 *   代わりに main.ts が `update` をコールバックとして transition に渡し、
 *   遷移完了後に transition 側からコールバック経由で update を呼ぶ。
 *
 * ボタン表示仕様：
 *   アイコン（› / ‹）は contents.html に静的記載。ts 側では変更しない。
 *   シーン移動・セクション移動を区別せず、方向のみをアイコンで示す。
 *   遷移先が存在しない場合に disabled を付与する。
 *
 * キーボード操作：
 *   Tab 順序は進行ボタン（エリアD）優先、戻るボタン（エリアA）は後
 */

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
    _btnNext.disabled = state.getNext() === null;
    _btnPrev.disabled = state.getPrev() === null;
}