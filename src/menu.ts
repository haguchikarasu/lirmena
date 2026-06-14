/*
 * menu.ts
 * 責務: 右下ナビゲーションメニューの開閉・各項目のイベント処理・キャラクター紹介ポップアップの管理
 * export: init(characters: CharactersData, volumes: VolumesData): void
 * 依存: state.ts, bookmark.ts, settings.ts, transition.ts, tutorial.ts, ruby.ts（キャラ名/説明のルビ展開）
 *
 * メニュー項目と処理（順序は要件 06-2）：
 *   目次へ戻る        → transition.leave(state.indexUrl())（離脱フェード経由）
 *   栞を追加          → _openBookmarkPopup()（スロット選択ポップアップを開き、選んだ slot へ保存）
 *   読書点について    → tutorial.open()（チュートリアル再表示）
 *   キャラクター紹介  → _openCharactersPopup() を呼ぶ
 *   設定を開く        → settings.open() を呼ぶ
 *   共有              → _openShare()（共有ポップアップを開く。リンクをコピー / X / LINE で現在の URL を共有）
 *
 * 栞ポップアップ（#bookmark-popup）：
 *   - _buildBookmarkPopup(): void — スロット1〜3のアクションボタン（各スロットの現在内容／空きを表示）＋閉じる を生成する
 *   - _openBookmarkPopup() / _closeBookmarkPopup(): void — 表示切替。開く直前にボタンラベルを最新内容で再生成する
 *   - スロット押下で bookmark.addBookmark(state.getCurrent(), #main-container.scrollLeft, slot) を呼んで上書き保存する
 *   - 閉じる方法：背景クリック・Escape キー・閉じるボタン
 *
 * 開閉制御（メニュー）：
 *   - メニューボタン押下でトグル
 *   - Escape キーで閉じる（ポップアップが閉じている場合）
 *   - メニュー外クリックで閉じる
 *
 * キャラクター紹介ポップアップ：
 *   - _openCharactersPopup(): void — 現在 ep の巻を特定してキャラカードを生成・表示する
 *   - _closeCharactersPopup(): void — オーバーレイを hidden にする
 *   - 閉じる方法：オーバーレイ背景クリック・Escape キー・閉じるボタン
 *
 * 共有ポップアップ（#share-popup）：
 *   - _buildSharePopup(): void — リンクをコピー / X でシェア / LINE でシェア / 閉じる を生成する
 *   - _openShare() / _closeShare(): void — 表示切替
 *   - 閉じる方法：背景クリック・Escape キー・閉じるボタン
 *
 * キーボード操作：
 *   - メニュー内で上下キーによる項目選択（disabled 項目はスキップ）
 *   - Enter で実行
 *
 * 注意：
 *   - 「栞のクリア」「既読のクリア」は settings.ts のポップアップ内ボタンが担当する。
 *     settings.ts へのコールバック注入は main.ts が行う（menu.ts は関与しない）。
 */

import * as state from './state';
import * as bookmark from './bookmark';
import * as settings from './settings';
import * as transition from './transition';
import * as tutorial from './tutorial';
import { applyRuby } from './ruby';
import type { CharactersData, VolumesData } from './types';

let _toggle: HTMLButtonElement;
let _panel: HTMLElement;
let _overlay: HTMLElement;
let _share: HTMLElement;
let _bookmark: HTMLElement;
let _items: HTMLButtonElement[] = [];
let _charactersData: CharactersData = [];
let _volumesData: VolumesData = [];

// DOM からメニューボタン・パネル・オーバーレイを取得し、項目を生成してイベントを登録する。
// main.ts が起動時に一度だけ呼ぶ。キャラクター紹介データを受け取って保持する。
// init(characters: CharactersData, volumes: VolumesData): void
export function init(characters: CharactersData, volumes: VolumesData): void {
    _charactersData = characters;
    _volumesData = volumes;
    _toggle = document.querySelector<HTMLButtonElement>('#menu-toggle')!;
    _panel = document.querySelector<HTMLElement>('#menu-panel')!;
    _overlay = document.querySelector<HTMLElement>('#characters-overlay')!;
    _share = document.querySelector<HTMLElement>('#share-popup')!;
    _bookmark = document.querySelector<HTMLElement>('#bookmark-popup')!;
    _buildItems();
    _buildSharePopup();
    _buildBookmarkPopup();
    _registerEvents();
}

// #menu-panel にメニュー項目ボタンとセパレータを生成して追加する。
// _buildItems(): void
function _buildItems(): void {
    const sep = (): HTMLElement => {
        const el = document.createElement('div');
        el.className = 'menu-sep';
        el.setAttribute('aria-hidden', 'true');
        return el;
    };

    const makeBtn = (label: string, handler: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-item';
        b.textContent = label;
        b.addEventListener('click', () => { _close(); handler(); });
        return b;
    };

    const btnIndex = makeBtn('目次へ戻る', () => {
        transition.leave(state.indexUrl());
    });

    const btnBookmark = makeBtn('栞を追加', () => {
        _openBookmarkPopup();
    });

    const btnTutorial = makeBtn('読書点について', () => {
        tutorial.open();
    });

    const btnCharacters = makeBtn('キャラクター紹介', () => {
        _openCharactersPopup();
    });

    const btnSettings = makeBtn('設定', () => {
        settings.open();
    });

    const btnShare = makeBtn('共有', () => {
        _openShare();
    });

    _panel.append(
        btnIndex,
        btnBookmark,
        btnTutorial,
        btnCharacters,
        sep(),
        btnSettings,
        btnShare,
    );

    _items = [btnIndex, btnBookmark, btnTutorial, btnCharacters, btnSettings, btnShare];
}

// #share-popup に共有ポップアップのパネル（リンクをコピー / X でシェア / LINE でシェア / 閉じる）を生成する。
// 設定ポップアップと同じ .settings-panel / .settings-action / .settings-close 様式を流用する。
// _buildSharePopup(): void
function _buildSharePopup(): void {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-panel__title';
    titleEl.textContent = '共有';
    panel.appendChild(titleEl);

    const makeAction = (label: string, handler: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'settings-action';
        b.textContent = label;
        b.addEventListener('click', () => { _closeShare(); handler(); });
        return b;
    };

    panel.append(
        makeAction('リンクをコピー', () => {
            navigator.clipboard.writeText(location.href).catch(() => {});
        }),
        makeAction('X でシェア', () => {
            window.open(
                `https://x.com/intent/tweet?url=${encodeURIComponent(location.href)}`,
                '_blank', 'noopener,noreferrer',
            );
        }),
        makeAction('LINE でシェア', () => {
            window.open(
                `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(location.href)}`,
                '_blank', 'noopener,noreferrer',
            );
        }),
    );

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => _closeShare());
    panel.appendChild(closeBtn);

    _share.appendChild(panel);
}

// 共有ポップアップを開く / 閉じる。
// _openShare(): void / _closeShare(): void
function _openShare(): void {
    _share.hidden = false;
}

function _closeShare(): void {
    _share.hidden = true;
}

// ── 栞ポップアップ（スロット選択） ─────────────────────────────────

const _slotBtns: HTMLButtonElement[] = []; // index = slot(1..3) に対応する保存ボタン（ラベルは開く度に更新）

// 数値を2桁ゼロ埋めする。
// _pad(n: number): string
function _pad(n: number): string {
    return String(n).padStart(2, '0');
}

// 保存時刻を "MM/DD HH:MM" で表す。
// _formatSavedAt(ms: number): string
function _formatSavedAt(ms: number): string {
    const d = new Date(ms);
    return `${_pad(d.getMonth() + 1)}/${_pad(d.getDate())} ${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
}

// #bookmark-popup に「栞に保存」パネル（スロット1〜3のアクションボタン＋閉じる）を生成する。
// 各スロットボタンの現在内容ラベルは _openBookmarkPopup() が開く度に最新化する。
// _buildBookmarkPopup(): void
function _buildBookmarkPopup(): void {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-panel__title';
    titleEl.textContent = '栞に保存';
    panel.appendChild(titleEl);

    for (let slot = 1; slot <= 3; slot++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings-action';
        btn.addEventListener('click', () => {
            const container = document.querySelector<HTMLElement>('#main-container')!;
            bookmark.addBookmark(state.getCurrent(), container.scrollLeft, slot);
            _closeBookmarkPopup();
        });
        _slotBtns[slot] = btn;
        panel.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => _closeBookmarkPopup());
    panel.appendChild(closeBtn);

    _bookmark.appendChild(panel);
}

// 各スロットボタンのラベルを現在の保存内容（または「空き」）で更新する。
// _refreshSlotLabels(): void
function _refreshSlotLabels(): void {
    const bySlot = new Map(bookmark.getBookmarks().map(b => [b.slot, b]));
    for (let slot = 1; slot <= 3; slot++) {
        const entry = bySlot.get(slot);
        const detail = entry
            ? `第${entry.ep}話 ${_pad(entry.sec)}　${_formatSavedAt(entry.savedAt)}`
            : '空き';
        _slotBtns[slot].textContent = `スロット${slot}：${detail}`;
    }
}

// 栞ポップアップを開く / 閉じる。開く前にスロット内容を最新化する。
// _openBookmarkPopup(): void / _closeBookmarkPopup(): void
function _openBookmarkPopup(): void {
    _refreshSlotLabels();
    _bookmark.hidden = false;
}

function _closeBookmarkPopup(): void {
    _bookmark.hidden = true;
}

// メニューを開く。最初の有効項目にフォーカスする。
// _open(): void
function _open(): void {
    _panel.hidden = false;
    _toggle.setAttribute('aria-expanded', 'true');
    _items.find(b => !b.disabled)?.focus();
}

// メニューを閉じる。
// _close(): void
function _close(): void {
    _panel.hidden = true;
    _toggle.setAttribute('aria-expanded', 'false');
}

// 現在 ep が属する巻のキャラクターカードを生成し、ポップアップを表示する。
// 巻が特定できない場合は巻1にフォールバックする。
// _openCharactersPopup(): void
function _openCharactersPopup(): void {
    const ep = state.getCurrent().ep;
    const volume = _volumesData.find(v => v.epRange[0] <= ep && ep <= v.epRange[1])?.volume ?? 1;
    const volumeEntry = _charactersData.find(c => c.volume === volume);
    const characters = volumeEntry?.characters ?? [];

    const list = document.querySelector<HTMLElement>('#characters-list')!;
    list.innerHTML = '';

    for (const chara of characters) {
        const card = document.createElement('div');
        card.className = 'character-card';

        if (chara.image !== '') {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}chara/${chara.image}`;
            img.alt = '';
            card.appendChild(img);
        }

        const info = document.createElement('div');
        info.className = 'character-info';

        const name = document.createElement('p');
        name.className = 'character-name';
        applyRuby(chara.name, name);

        const desc = document.createElement('p');
        desc.className = 'character-description';
        applyRuby(chara.description, desc);

        info.append(name, desc);
        card.appendChild(info);
        list.appendChild(card);
    }

    _overlay.hidden = false;
}

// キャラクター紹介ポップアップを閉じる。
// _closeCharactersPopup(): void
function _closeCharactersPopup(): void {
    _overlay.hidden = true;
}

// メニューボタン・Escape・外部クリック・上下キー・ポップアップ閉じるのイベントを登録する。
// _registerEvents(): void
function _registerEvents(): void {
    _toggle.addEventListener('click', () => {
        _panel.hidden ? _open() : _close();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!_bookmark.hidden) {
                _closeBookmarkPopup();
                return;
            }
            if (!_share.hidden) {
                _closeShare();
                return;
            }
            if (!_overlay.hidden) {
                _closeCharactersPopup();
                return;
            }
            if (!_panel.hidden) {
                _close();
                _toggle.focus();
            }
            return;
        }

        if (_panel.hidden) return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const idx = _items.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'ArrowDown') {
                const start = idx === -1 ? 0 : idx + 1;
                _items.slice(start).find(b => !b.disabled)?.focus();
            } else {
                if (idx <= 0) return;
                _items.slice(0, idx).reverse().find(b => !b.disabled)?.focus();
            }
        }
    });

    document.addEventListener('click', (e) => {
        const target = e.target as Node;
        if (!_panel.hidden && !_toggle.contains(target) && !_panel.contains(target)) {
            _close();
        }
    });

    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) {
            _closeCharactersPopup();
        }
    });

    _share.addEventListener('click', (e) => {
        if (e.target === _share) {
            _closeShare();
        }
    });

    _bookmark.addEventListener('click', (e) => {
        if (e.target === _bookmark) {
            _closeBookmarkPopup();
        }
    });

    document.querySelector<HTMLButtonElement>('#characters-popup-close')!
        .addEventListener('click', () => _closeCharactersPopup());
}
