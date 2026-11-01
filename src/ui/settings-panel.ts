/*
 * ui/settings-panel.ts
 * 責務: 設定ポップアップ（#settings-popup）の結線。markup は差し込みの断片 templates/parts/settings.html が持ち、
 *       ここは「押されたら host に伝える」「host の現在値から選択状態（.active・aria-pressed）を描き直す」だけを行う。
 *       値の保存・画面への反映は持たない（ページごとに違うので host が持つ）：
 *         本文（settings.ts）… 保存＋CSS 変数と <html data-writing-mode> への反映＋読書位置の復元
 *         目次（index.ts）  … 保存だけ（目次は本文を持たないので反映しない）
 * export: type SettingsPanelHost
 *         init(host: SettingsPanelHost, opts?: { closeOnEscape?: boolean }): void
 *         refresh(): void   — host.current() から選択状態を描き直す（ポップアップの外で値が変わったとき）
 *         open(): void / close(): void / isOpen(): boolean
 * 依存: core/settings-model（型とプリセット定義）。DOM（#settings-popup と断片の data-* 属性）。
 *       ui 層＝reader 層を import しない（.dependency-cruiser.cjs）。
 *
 * 断片の約束（templates/parts/settings.html）:
 *   .settings-opt[data-key][data-value]  … 設定行の選択ボタン（data-key は Settings のキー）
 *   .settings-preset                     … プリセットのカードの器。カードは PRESETS からここで組む（定義の単一の源を保つ）
 *   .settings-action[data-action]        … clear-bookmarks / clear-reached / clear-read / reset
 *   .settings-close                      … 閉じる
 * 3 つのクリアは window.confirm() で承認を取ってから host を呼ぶ。リセットは確認しない。
 * Escape で閉じるかは opts.closeOnEscape（既定 false）。目次は FAB のキー処理が Escape の順番を決めるので false、
 * 本文は true（従来の settings.ts と同じ）。両方で閉じると、目次では「閉じた直後に FAB のキー処理が FAB を開く」になる。
 */

import { PRESETS, activePresetId, type PresetId, type Settings } from '../core/settings-model';

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

let _popup: HTMLElement | null = null;
let _host: SettingsPanelHost | null = null;
let _opts: HTMLButtonElement[] = [];
let _presets: Array<{ btn: HTMLButtonElement; id: PresetId }> = [];

// #settings-popup の断片に結線する。断片が無いページ（器が無い・差し込み漏れ）では何もしない。
// 呼び直してもよい（テストが毎回新しい断片を差し込んで呼ぶ）。
// init(host: SettingsPanelHost, opts?: { closeOnEscape?: boolean }): void
export function init(host: SettingsPanelHost, opts: { closeOnEscape?: boolean } = {}): void {
    _host = host;
    _popup = document.getElementById('settings-popup');
    _opts = [];
    _presets = [];
    if (!_popup) return;
    const popup = _popup;

    _buildPresets(popup);

    _opts = Array.from(popup.querySelectorAll<HTMLButtonElement>('.settings-opt[data-key][data-value]'));
    for (const btn of _opts) {
        btn.addEventListener('click', () => {
            _host?.select(btn.dataset.key as keyof Settings, btn.dataset.value ?? '');
            refresh();
        });
    }

    _onAction(popup, 'clear-bookmarks', () => {
        _confirmAndRun('保存した栞をすべて削除しますか？', () => _host?.clearBookmarks());
    });
    _onAction(popup, 'clear-reached', () => {
        _confirmAndRun('既読の記録をすべて削除しますか？', () => _host?.clearReached());
    });
    _onAction(popup, 'clear-read', () => {
        _confirmAndRun('読破の記録をすべて削除しますか？', () => _host?.clearRead());
    });
    _onAction(popup, 'reset', () => {
        _host?.reset();
        // 既定値はどちらのプリセットとも一致しないので、リセット後は両カードとも非 active になるのが正。
        refresh();
    });

    popup.querySelector('.settings-close')?.addEventListener('click', () => close());
    popup.addEventListener('click', (e) => {
        if (e.target === popup) close();
    });
    if (opts.closeOnEscape) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen()) close();
        });
    }

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

// open(): void / close(): void / isOpen(): boolean
export function open(): void {
    if (_popup) _popup.hidden = false;
}

export function close(): void {
    if (_popup) _popup.hidden = true;
}

export function isOpen(): boolean {
    return _popup !== null && !_popup.hidden;
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

function _onAction(popup: HTMLElement, action: string, handler: () => void): void {
    popup.querySelector(`.settings-action[data-action="${action}"]`)?.addEventListener('click', handler);
}

// destructive アクション（栞・既読・読破の削除）用の confirm ラッパ。OK なら run()、キャンセルなら何もしない。
function _confirmAndRun(msg: string, run: () => void): void {
    if (window.confirm(msg)) run();
}
