/*
 * menu.ts
 * 責務: 右下ナビゲーションメニューの開閉・各項目のイベント処理・キャラクター紹介ポップアップの管理
 * export: init(characters: CharactersData, volumes: VolumesData): void
 * 依存: state.ts, bookmark.ts, settings.ts
 *
 * メニュー項目と処理：
 *   目次へ戻る        → index.html（目次ページ）へ遷移
 *   栞を追加          → bookmark.addBookmark(currentAddress) を呼ぶ
 *   キャラクター紹介  → _openCharactersPopup() を呼ぶ
 *   共有              → クリップボード / X / LINE で現在の URL をシェアする
 *   設定を開く        → settings.open() を呼ぶ
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
import type { CharactersData, VolumesData } from './types';

let _toggle: HTMLButtonElement;
let _panel: HTMLElement;
let _overlay: HTMLElement;
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
    _buildItems();
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
        location.href = 'index.html';
    });

    const btnBookmark = makeBtn('栞を追加', () => {
        const container = document.querySelector<HTMLElement>('#main-container')!;
        bookmark.addBookmark(state.getCurrent(), container.scrollLeft);
    });

    const btnCharacters = makeBtn('キャラクター紹介', () => {
        _openCharactersPopup();
    });

    const btnCopy = makeBtn('リンクをコピー', () => {
        navigator.clipboard.writeText(location.href).catch(() => {});
    });

    const btnX = makeBtn('X でシェア', () => {
        window.open(
            `https://x.com/intent/tweet?url=${encodeURIComponent(location.href)}`,
            '_blank', 'noopener,noreferrer',
        );
    });

    const btnLine = makeBtn('LINE でシェア', () => {
        window.open(
            `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(location.href)}`,
            '_blank', 'noopener,noreferrer',
        );
    });

    const btnSettings = makeBtn('設定', () => {
        settings.open();
    });

    _panel.append(
        btnIndex,
        sep(),
        btnBookmark,
        btnCharacters,
        sep(),
        btnCopy, btnX, btnLine,
        sep(),
        btnSettings,
    );

    _items = [btnIndex, btnBookmark, btnCharacters, btnCopy, btnX, btnLine, btnSettings];
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

// |base《rt》 記法をパースして ruby 要素とテキストノードを el に追加する。
// _applyRuby(text: string, el: HTMLElement): void
function _applyRuby(text: string, el: HTMLElement): void {
    const re = /\|([^《\n]+)《([^》\n]+)》/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(m[1]));
        const rt = document.createElement('rt');
        rt.textContent = m[2];
        ruby.appendChild(rt);
        el.appendChild(ruby);
        last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
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
            img.src = `public/img/chara/${chara.image}`;
            img.alt = '';
            card.appendChild(img);
        }

        const info = document.createElement('div');
        info.className = 'character-info';

        const name = document.createElement('p');
        name.className = 'character-name';
        _applyRuby(chara.name, name);

        const desc = document.createElement('p');
        desc.className = 'character-description';
        _applyRuby(chara.description, desc);

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

    document.querySelector<HTMLButtonElement>('#characters-popup-close')!
        .addEventListener('click', () => _closeCharactersPopup());
}
