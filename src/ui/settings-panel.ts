/*
 * ui/settings-panel.ts
 * 責務: 設定シート（#settings-popup）の結線。markup は差し込みの断片 templates/parts/settings.html が持ち、
 *       ここは「押されたら host に伝える」「host の現在値から選択状態（.active・aria-pressed）を描き直す」だけを行う。
 *       値の保存・画面への反映は持たない（ページごとに違うので host が持つ）：
 *         本文（settings.ts）… 保存＋CSS 変数と <html data-writing-mode> への反映＋読書位置の復元
 *         目次（index.ts）  … 保存だけ（目次は本文を持たないので反映しない）
 * export: type SettingsPanelHost
 *         init(host: SettingsPanelHost): void
 *         refresh(): void   — host.current() から選択状態を描き直す（シートの外で値が変わったとき）
 *         open(opener?: HTMLElement | null): void / close(): void / isOpen(): boolean
 * 依存: core/settings-model（型とプリセット定義）、ui/sheet（器の開閉）、ui/confirm（消す・戻す前の確認）。
 *       DOM（#settings-popup と断片の data-* 属性）。
 *       ui 層＝reader 層を import しない（.dependency-cruiser.cjs）。
 *
 * 断片の約束（templates/parts/settings.html）:
 *   .settings-opt[data-key][data-value]  … 設定行の選択ボタン（data-key は Settings のキー）
 *   .settings-preset                     … プリセットのカードの器。カードは PRESETS からここで組む（定義の単一の源を保つ）
 *   .settings-action[data-action]        … clear-bookmarks / clear-reached / clear-read / reset
 *   [data-sheet-close]                   … 閉じる（ui/sheet が結ぶ）
 * 4 つのボタン（栞・既読・読破を消す、設定を初期値に戻す）はどれも取り消せないので、ui/confirm の確認で
 * 「削除する」「戻す」が押されてから host を呼ぶ（Esc・背景・「やめる」は何もしない。要件 06-4）。
 * 「初期値に戻す」は読書点の位置も戻す（本文の host.reset）ので、確認文にその 1 行を添える。
 * Escape はシート（<dialog>）が閉じる＝このモジュールもページのキー処理も拾わない。
 */

import { PRESETS, activePresetId, type PresetId, type Settings } from '../core/settings-model';
import * as sheet from './sheet';
import { confirmDialog } from './confirm';

// SettingsPanelHost: パネルの操作をページへ伝える口。select / preset / reset は保存と反映まで済ませてから戻ること
// （戻ったあとパネルは current() を読み直して選択状態を描く）。
export type SettingsPanelHost = {
    current: () => Settings;
    select: (key: keyof Settings, value: string) => void;
    preset: (id: PresetId) => void;
    reset: () => void;
    clearBookmarks: () => void;
    clearReached: () => void;
    clearRead: () => void;
};

let _popup: HTMLDialogElement | null = null;
let _host: SettingsPanelHost | null = null;
let _opts: HTMLButtonElement[] = [];
let _presets: Array<{ btn: HTMLButtonElement; id: PresetId }> = [];

// #settings-popup の断片に結線する。断片が無いページ（器が無い・差し込み漏れ）では何もしない。
// 呼び直してもよい（テストが毎回新しい断片を差し込んで呼ぶ）。
// init(host: SettingsPanelHost): void
export function init(host: SettingsPanelHost): void {
    _host = host;
    const el = document.getElementById('settings-popup');
    _popup = el instanceof HTMLDialogElement ? el : null;
    _opts = [];
    _presets = [];
    if (!_popup) return;
    const popup = _popup;
    sheet.init(popup);

    _buildPresets(popup);

    _opts = Array.from(popup.querySelectorAll<HTMLButtonElement>('.settings-opt[data-key][data-value]'));
    for (const btn of _opts) {
        btn.addEventListener('click', () => {
            _host?.select(btn.dataset.key as keyof Settings, btn.dataset.value ?? '');
            refresh();
        });
    }

    _onAction(popup, 'clear-bookmarks', () =>
        _confirmAndRun('保存した栞をすべて削除しますか？', '削除する', () => _host?.clearBookmarks()));
    _onAction(popup, 'clear-reached', () =>
        _confirmAndRun('既読の記録をすべて削除しますか？', '削除する', () => _host?.clearReached()));
    _onAction(popup, 'clear-read', () =>
        _confirmAndRun('読破の記録をすべて削除しますか？', '削除する', () => _host?.clearRead()));
    _onAction(popup, 'reset', () =>
        _confirmAndRun('表示の設定を初期値に戻しますか？', '戻す', () => {
            _host?.reset();
            // 既定値はどちらのプリセットとも一致しないので、リセット後は両カードとも非 active になるのが正。
            refresh();
        }, '読書点の位置も初期値に戻ります。'));

    refresh();
}

// host.current() から設定行の .active とプリセットの .active・aria-pressed を描き直す。
// refresh(): void
export function refresh(): void {
    if (!_host) return;
    const current = _host.current();
    for (const btn of _opts) {
        const key = btn.dataset.key as keyof Settings;
        btn.classList.toggle('active', (current[key] as string) === btn.dataset.value);
    }
    const active = activePresetId(current);
    for (const { btn, id } of _presets) {
        const on = id === active;
        btn.classList.toggle('active', on);
        // .active はクラス＝見た目だけなので、選択状態を支援技術にも伝える。
        // 2枚のうち1枚が選ばれる排他選択だが radiogroup にはしない（矢印キー操作の実装が要るため）。
        btn.setAttribute('aria-pressed', String(on));
    }
}

// open(opener?: HTMLElement | null): void / close(): void / isOpen(): boolean
// opener には閉じたときにフォーカスを戻す要素を渡す（本文＝#menu-toggle。メニューの項目は閉じたパネルの中にいる）。
export function open(opener?: HTMLElement | null): void {
    if (_popup) sheet.open(_popup, { opener });
}

export function close(): void {
    if (_popup) sheet.close(_popup);
}

export function isOpen(): boolean {
    return sheet.isOpen(_popup);
}

// プリセットのカードを PRESETS から .settings-preset の中に組む。
// **カードは設定の「行」ではない**（.settings-row / .settings-row__label を使わない）＝行順を検査する
// e2e/settings-order.spec.ts と settings.test.ts の対象外に保つ。要件 06-4 の「表示設定の行」は5つのまま。
function _buildPresets(popup: HTMLElement): void {
    const box = popup.querySelector<HTMLElement>('.settings-preset');
    if (!box) return;
    box.replaceChildren();
    for (const preset of PRESETS) {
        const btn = document.createElement('button');
        btn.className = 'settings-preset__btn';
        btn.type = 'button';

        const name = document.createElement('span');
        name.className = 'settings-preset__name';
        name.textContent = preset.name;
        btn.appendChild(name);

        const desc = document.createElement('span');
        desc.className = 'settings-preset__desc';
        desc.textContent = preset.desc;
        btn.appendChild(desc);

        btn.addEventListener('click', () => {
            _host?.preset(preset.id);
            refresh();
        });
        box.appendChild(btn);
        _presets.push({ btn, id: preset.id });
    }
}

function _onAction(popup: HTMLElement, action: string, handler: () => unknown): void {
    popup.querySelector(`.settings-action[data-action="${action}"]`)?.addEventListener('click', handler);
}

// 取り消せない操作（栞・既読・読破の削除と初期値に戻す）の確認ラッパ。確定なら run()、やめたら何もしない。
// 戻り値の Promise は確認が済んだら解決する（テストが待つため）。
// _confirmAndRun(msg: string, okLabel: string, run: () => void, note?: string): Promise<void>
async function _confirmAndRun(msg: string, okLabel: string, run: () => void, note?: string): Promise<void> {
    if (await confirmDialog(msg, okLabel, note)) run();
}
