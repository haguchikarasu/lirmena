/*
 * firstrun.ts
 * 責務: 本文／あとがきページ初回の「読み方」選択ダイアログ。#firstrun-popup（空の器）にカード2枚＋
 *       「あとで決める」を組み立て、選択時に settings.applyPreset() を呼ぶ。
 * export: init(callbacks: { onDone: () => void }): void
 * 依存: settings.ts（プリセット定義・適用・既定判定の所有者。公開 API 経由でのみ触る）
 *   tutorial.ts は import しない。閉じたことは onDone 注入で main.ts へ返し、次に何を出すかは main.ts が決める
 *   （settings/device と同じコールバック注入の流儀）。
 *
 * onDone の契約: **必ず 1 回だけ、マイクロタスクで呼ぶ。**
 *   - 出す条件を満たさない／器が無い → init() 内で 1 回
 *   - ダイアログを出した → 閉じたとき（カード選択・「あとで決める」・Escape のいずれでも）1 回
 *   呼び出し側は分岐なしで「onDone の中に次の導線」を書ける。**同期でなくマイクロタスクなのは Escape 対策**：
 *   同期で呼ぶと、Escape で閉じた延長で開いたチュートリアルが、同じ keydown の後続リスナー（tutorial.ts が
 *   document に登録している Escape ハンドラ）にそのまま閉じられうる。現状は tutorial.init() が先に登録されて
 *   いるため実害が出ないが、それは登録順という偶然に頼った状態で、firstrun.init() を前へ動かすと
 *   「初回ガイドが一度も見られないまま tutorialSeen だけ立つ」に化ける。1 マイクロタスク遅らせれば
 *   イベントの伝播が終わってから開くので、登録順に依存しなくなる。
 *
 * 出す条件（AND）:
 *   1. localStorage の KEY_PRESET_ASKED が未設定
 *   2. settings.isAllDefault() === true（表示設定5項目を一度も変えていない）
 *   チュートリアル既読フラグは条件に入れない＝設定を触っていない既存読者にも一度だけ質問が出る（要件 06-12）。
 *
 * フラグ: KEY_PRESET_ASKED = 'lirmena.presetAsked'。**閉じた瞬間**に立てる（tutorial の KEY_TUTORIAL_SEEN が
 *   「開いた瞬間」なのとは非対称）。チュートリアルは*情報*なので即閉じた読者を毎回呼び止めないのが正しいが、
 *   こちらは*質問*なので、答える前にリロードされたなら再度訊くのが正しい。
 *   「設定をリセット」の対象には**含めない**（導線フラグであって表示設定ではない。tutorialSeen と同じ扱い）。
 *
 * 閉じ口: カード選択／「あとで決める」／Escape の 3 つ。**背景クリックでは閉じない**——他のポップアップ
 *   （設定・共有・栞・チュートリアル）は背景クリックで閉じるが、これは選択肢が全部見えている質問なので、
 *   背景の誤タップで質問が消費される（＝二度と出ない）方が損失が大きい。意図的な逸脱。
 */

import * as settings from './settings';

const KEY_PRESET_ASKED = 'lirmena.presetAsked';

let _popup: HTMLElement | null = null;
let _onDone: () => void = () => {};
let _done = false;

// ダイアログを出すか判定し、出すなら組み立てて表示する。出さない場合もコールバックは呼ぶ。
// callbacks.onDone は「この導線が片付いた」通知で、出す/出さないに関わらず必ず1回だけマイクロタスクで走る。
// init(callbacks: { onDone: () => void }): void
export function init(callbacks: { onDone: () => void }): void {
    _onDone = callbacks.onDone;
    _done = false;
    _popup = document.getElementById('firstrun-popup');

    if (!_popup || !_shouldAsk()) {
        _finish();
        return;
    }

    _buildPanel(_popup);
    _popup.hidden = false;
    document.addEventListener('keydown', _onKeyDown);
    // 開いた瞬間に1枚目のカードへ移す。オーバーレイの下の #opening-back / #opening-start は隠れていても
    // focusable なので、これが無いとキーボード操作の読者が Tab→Enter で前の sec へ飛んでしまう。
    _popup.querySelector<HTMLButtonElement>('.firstrun-choice')?.focus();
}

// 出す条件（質問済みフラグが無い AND 表示設定5項目がすべて既定値）。
// _shouldAsk(): boolean
function _shouldAsk(): boolean {
    return localStorage.getItem(KEY_PRESET_ASKED) === null && settings.isAllDefault();
}

// onDone を1回だけ呼ぶ。多重呼び出しの防止と、Escape の伝播が終わってから次の導線へ渡す遅延を兼ねる。
// _finish(): void
function _finish(): void {
    if (_done) return;
    _done = true;
    queueMicrotask(() => _onDone());
}

// 質問済みフラグを立て、ダイアログを閉じ、フォーカスを外して onDone を呼ぶ。すべての閉じ口がここを通る
// （どの経路でもフラグを取りこぼさない）。
// _close(): void
function _close(): void {
    localStorage.setItem(KEY_PRESET_ASKED, '1');
    if (_popup) _popup.hidden = true;
    document.removeEventListener('keydown', _onKeyDown);
    // hidden になった要素にフォーカスを残さない（残すとキーボード操作の読者が次の導線へ進めなくなる）。
    const active = document.activeElement;
    if (active instanceof HTMLElement && _popup?.contains(active)) active.blur();
    _finish();
}

// Escape で閉じる（「あとで決める」と同じ扱い）。キーボード利用者がモーダルから抜けられない状態を作らない。
// _onKeyDown(e: KeyboardEvent): void
function _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && _popup && !_popup.hidden) _close();
}

// 器の中身を組み立てる（再入に備えて毎回作り直す）。カードの定義は settings.getPresets() が単一の源。
// 依存: #firstrun-popup（DOM）／ settings.getPresets() / applyPreset()
// _buildPanel(popup: HTMLElement): void
function _buildPanel(popup: HTMLElement): void {
    popup.textContent = '';

    const panel = document.createElement('div');
    panel.className = 'firstrun-panel';

    // 器（templates/reader.html）が aria-labelledby でこの id を参照する。
    const title = document.createElement('h2');
    title.className = 'firstrun-title';
    title.id = 'firstrun-title';
    title.textContent = '読み方を選んでください';
    panel.appendChild(title);

    const lead = document.createElement('p');
    lead.className = 'firstrun-lead';
    lead.textContent = 'あとから設定でいつでも変えられます。';
    panel.appendChild(lead);

    const choices = document.createElement('div');
    choices.className = 'firstrun-choices';

    for (const preset of settings.getPresets()) {
        const btn = document.createElement('button');
        btn.className = 'firstrun-choice';
        btn.type = 'button';

        // 図は書字方向の値から選ぶ（プリセットの id ではなく中身に追従させる）。
        btn.appendChild(_buildMini(preset.values.writingMode === 'vertical'));

        const text = document.createElement('span');
        const name = document.createElement('span');
        name.className = 'firstrun-choice__name';
        name.textContent = preset.name;
        text.appendChild(name);

        const desc = document.createElement('span');
        desc.className = 'firstrun-choice__desc';
        desc.textContent = preset.desc;
        text.appendChild(desc);
        btn.appendChild(text);

        btn.addEventListener('click', () => {
            settings.applyPreset(preset.id);
            _close();
        });
        choices.appendChild(btn);
    }
    panel.appendChild(choices);

    const skip = document.createElement('button');
    skip.className = 'firstrun-skip';
    skip.type = 'button';
    skip.textContent = 'あとで決める';
    skip.addEventListener('click', _close);
    panel.appendChild(skip);

    popup.appendChild(panel);
}

// 縦書き／横書きを示す小さな図（純 CSS・画像なし）。装飾なので支援技術には出さない。
// 3本ごとの .is-head が段落の先頭＝横書きは前に空きを作り、縦書きは頭を下げる（＝字下げ）。
// _buildMini(vertical: boolean): HTMLElement
function _buildMini(vertical: boolean): HTMLElement {
    const box = document.createElement('span');
    box.className = `firstrun-mini firstrun-mini--${vertical ? 'v' : 'h'}`;
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 6; i++) {
        const line = document.createElement('i');
        if (i % 3 === 0) line.className = 'is-head';
        box.appendChild(line);
    }
    return box;
}
