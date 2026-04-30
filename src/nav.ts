/*
 * nav.ts
 * 責務: 読書画面・タイトル画面のボタンのイベント登録・有効無効更新
 * export: init(), update()
 * 依存: state.ts, transition.ts（循環依存を main.ts のコールバック注入で解消）
 *
 * 循環依存の解消方法：
 *   nav.ts は transition.trigger() を直接呼ぶ（import あり）。
 *   transition.ts は nav.ts を import しない。
 *   代わりに main.ts が `update` をコールバックとして transition に渡し、
 *   遷移完了後に transition 側からコールバック経由で update を呼ぶ。
 *
 * 読書画面ボタン（#btn-next / #btn-prev）：
 *   - 遷移先が存在する場合は transition.trigger(addr) を呼ぶ
 *   - 次の ep がない（state.getNext() === null）場合は location.href = 'index.html' に直接遷移
 *     （フェードなし。CLAUDE.md「次の ep がない場合の挙動」参照）
 *   - update() 時、next が null なら進行ボタンのラベルを「目次へ戻る」に変更し enabled にする
 *
 * タイトル画面ボタン（#btn-title-enter / #btn-title-prev）：
 *   - renderer.renderTitleScreen() 呼び出し後に要素が生成されるため、
 *     クリックはイベント委譲で登録する（init 時点で要素が未生成のため）
 *   - #btn-title-enter 押下 → state.getNext() を取得して transition.trigger()
 *   - #btn-title-prev  押下 → state.getPrev() を取得して transition.trigger()
 *   - ep 1 では #btn-title-prev を disabled にする
 *
 * キーボード操作：
 *   Tab 順序は進行ボタン（エリアD）優先、戻るボタン（エリアA）は後
 */

import * as state from './state';
import * as transition from './transition';

let _btnNext!: HTMLButtonElement;
let _btnPrev!: HTMLButtonElement;

// 進行ボタンの元のテキスト（‹）を保持して「目次へ戻る」との切り替えに使う
const BTN_NEXT_DEFAULT_TEXT = '‹';

// DOM からボタン要素を querySelector で取得し、クリックイベントを登録する。
// タイトル画面ボタンはイベント委譲で登録する（init 時点で要素が未生成のため）。
// init は起動時に1度だけ main.ts から呼ばれる。
// init(): void
export function init(): void {
    _btnNext = document.querySelector<HTMLButtonElement>('#btn-next')!;
    _btnPrev = document.querySelector<HTMLButtonElement>('#btn-prev')!;

    _btnNext.addEventListener('click', () => {
        const addr = state.getNext();
        if (addr) {
            void transition.trigger(addr);
        } else {
            // 次 ep なし → フェードなしで目次へ直遷移
            location.href = 'index.html';
        }
    });

    _btnPrev.addEventListener('click', () => {
        const addr = state.getPrev();
        if (addr) void transition.trigger(addr);
    });

    // タイトル画面ボタンはイベント委譲（要素が renderTitleScreen 後に生成されるため）
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.id === 'btn-title-enter') {
            const addr = state.getNext();
            if (addr) void transition.trigger(addr);
        } else if (target.id === 'btn-title-prev') {
            const addr = state.getPrev();
            if (addr) void transition.trigger(addr);
        }
    });
}

// ボタンのラベルと有効/無効状態を現在のアドレスに応じて更新する。
// transition 完了後に main.ts が transition へ渡したコールバック経由で呼ばれる。
// update(): void
export function update(): void {
    if (state.isOnTitleCard()) {
        _updateTitleButtons();
    } else {
        _updateReadingButtons();
    }
}

// タイトル画面のボタン状態を更新する
function _updateTitleButtons(): void {
    const btnEnter = document.querySelector<HTMLButtonElement>('#btn-title-enter');
    const btnPrev = document.querySelector<HTMLButtonElement>('#btn-title-prev');
    if (btnEnter) btnEnter.disabled = false;
    if (btnPrev) btnPrev.disabled = state.getPrev() === null;
}

// 読書画面のボタン状態を更新する
function _updateReadingButtons(): void {
    const next = state.getNext();

    if (next === null) {
        // 次 ep なし：ボタンを有効にして「目次へ戻る」ラベルに変更
        _btnNext.disabled = false;
        _btnNext.textContent = '目次へ戻る';
        _btnNext.setAttribute('aria-label', '目次へ戻る');
    } else {
        _btnNext.disabled = false;
        _btnNext.textContent = BTN_NEXT_DEFAULT_TEXT;
        _btnNext.setAttribute('aria-label', '次へ');
    }

    _btnPrev.disabled = state.getPrev() === null;
}
