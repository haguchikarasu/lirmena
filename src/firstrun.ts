/*
 * firstrun.ts
 * 責務: 本文／あとがきページ初回の「読み方」選択ダイアログ。#firstrun-popup（空の <dialog>）にカード2枚＋
 *       「あとで決める」を組み立てて showModal() で開き、選択時に settings.applyPreset() を呼ぶ。
 * export: init(callbacks: { onDone: () => void }): void
 * 依存: settings.ts（プリセット定義・適用・既定判定の所有者。公開 API 経由でのみ触る）
 *   tutorial.ts は import しない。閉じたことは onDone 注入で main.ts へ返し、次に何を出すかは main.ts が決める
 *   （settings/device と同じコールバック注入の流儀）。
 *
 * onDone の契約: **必ず 1 回だけ、マイクロタスクで呼ぶ。**
 *   - 出す条件を満たさない／器が無い（<dialog> でない・showModal() が無い環境を含む）→ init() 内で 1 回
 *   - ダイアログを出した → 閉じたとき（カード選択・「あとで決める」・ブラウザが閉じた＝Esc や「戻る」のいずれでも）1 回
 *   呼び出し側は分岐なしで「onDone の中に次の導線」を書ける。**同期でなくマイクロタスクなのは、閉じた延長で
 *   次の導線を開かないため**：同期で呼ぶと、閉じたイベント（ボタンの click・<dialog> の close）の処理がまだ
 *   終わらないうちにチュートリアルが開き、同じイベントの後続リスナーに閉じられうる（以前の tutorial.ts は document に
 *   Escape のハンドラを持っていて、実際にそうなった。今は <dialog> で document のハンドラは無いが、順序の保証として
 *   残す）。そうなると「初回ガイドが一度も見られないまま tutorialSeen だけ立つ」。
 *   1 マイクロタスク遅らせれば、いま走っているリスナーが終わってから開く。
 *
 * 出す条件（AND）:
 *   1. localStorage の KEY_PRESET_ASKED が未設定
 *   2. settings.isAllDefault() === true（表示設定5項目を一度も変えていない）
 *   チュートリアル既読フラグは条件に入れない＝設定を触っていない既存読者にも一度だけ質問が出る（要件 06-12）。
 *
 * フラグ: KEY_PRESET_ASKED = 'lirmena.presetAsked'。**閉じた瞬間**に立てる（tutorial の KEY_TUTORIAL_SEEN が
 *   「開いた瞬間」なのとは非対称）。チュートリアルは*情報*なので即閉じた読者を毎回呼び止めないのが正しいが、
 *   こちらは*質問*なので、答える前にリロードされたなら再度訊くのが正しい。
 *   「設定を初期値に戻す」の対象には**含めない**（導線フラグであって表示設定ではない。tutorialSeen と同じ扱い）。
 *
 * 閉じ口: カード選択／「あとで決める」／ブラウザが閉じる（Esc・スマホの「戻る」）の 3 つ。**背景クリックでは
 *   閉じない**——他のポップアップ（設定・共有・栞・チュートリアル）は背景クリックで閉じるが、これは選択肢が
 *   全部見えている質問なので、背景の誤タップで質問が消費される（＝二度と出ない）方が損失が大きい。意図的な逸脱。
 *   <dialog> に closedby を書かないのがその実装（showModal() の既定は「Esc と戻るだけ」）。
 *
 * <dialog> の showModal() に任せているもの（自分では書かない）: 裏を操作できなくする・Tab を中に留める・
 *   Esc と「戻る」で閉じる・最前面の層に出す・閉じたらフォーカスを元へ戻す。最初のフォーカスは 1 枚目のカードの
 *   autofocus（裏の #opening-back / #opening-start へ Tab→Enter で飛ばさないため、以前は focus() を呼んでいた）。
 *   **器に role="dialog"・aria-modal を付けない**（immersive.ts の判定。<dialog> が自分で持つ）。
 */

import * as settings from './settings';

// 全シェルの <head> early ブロック（localStorage の代用品）もこのキー名を持つ＝改名するときは両方直す（design/architecture.md）
const KEY_PRESET_ASKED = 'lirmena.presetAsked';

let _popup: HTMLDialogElement | null = null;
let _onDone: () => void = () => {};
let _done = false;
let _closed = false;

// ダイアログを出すか判定し、出すなら組み立てて表示する。出さない場合もコールバックは呼ぶ。
// callbacks.onDone は「この導線が片付いた」通知で、出す/出さないに関わらず必ず1回だけマイクロタスクで走る。
// init(callbacks: { onDone: () => void }): void
export function init(callbacks: { onDone: () => void }): void {
    _onDone = callbacks.onDone;
    _done = false;
    _closed = false;
    // モーダルにできない環境（器が <dialog> でない・showModal() が無い）では訊かない＝器が無いのと同じ扱い
    const el = document.getElementById('firstrun-popup');
    _popup = el instanceof HTMLDialogElement && typeof el.showModal === 'function' ? el : null;

    if (!_popup || !_shouldAsk()) {
        _finish();
        return;
    }

    _buildPanel(_popup);
    // ブラウザが閉じたとき（Esc・「戻る」）もここを通す。ボタンで閉じたときは 2 度目になるが _close() が弾く
    _popup.addEventListener('close', _close, { once: true });
    _popup.showModal();
}

// 出す条件（質問済みフラグが無い AND 表示設定5項目がすべて既定値）。
// _shouldAsk(): boolean
function _shouldAsk(): boolean {
    return localStorage.getItem(KEY_PRESET_ASKED) === null && settings.isAllDefault();
}

// onDone を1回だけ呼ぶ。多重呼び出しの防止と、いま走っているイベントの処理が終わってから次の導線へ渡す遅延を兼ねる。
// _finish(): void
function _finish(): void {
    if (_done) return;
    _done = true;
    queueMicrotask(() => _onDone());
}

// 質問済みフラグを立て、ダイアログを閉じて onDone を呼ぶ。すべての閉じ口がここを通る（どの経路でもフラグを
// 取りこぼさない）：ボタンは click から直接、ブラウザが閉じたとき（Esc・「戻る」）は close イベントから。
// フラグは close イベントを待たずにここで立てる（close はタスクで遅れて届くので、その間に閉じられても残るように）。
// 閉じたあとのフォーカスはブラウザが開く前の位置へ戻す。
// _close(): void
function _close(): void {
    if (_closed) return;
    _closed = true;
    localStorage.setItem(KEY_PRESET_ASKED, '1');
    if (_popup?.open) _popup.close();
    _finish();
}

// 器の中身を組み立てる（再入に備えて毎回作り直す）。カードの定義は settings.getPresets() が単一の源。
// 器（<dialog>）がそのままパネルなので、包みの要素は作らない。
// 依存: #firstrun-popup（DOM）／ settings.getPresets() / applyPreset()
// _buildPanel(panel: HTMLDialogElement): void
function _buildPanel(panel: HTMLDialogElement): void {
    panel.textContent = '';

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
        // 開いたときのフォーカスは 1 枚目のカード（showModal() が autofocus の要素へ入れる）
        if (!choices.childElementCount) btn.autofocus = true;

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
