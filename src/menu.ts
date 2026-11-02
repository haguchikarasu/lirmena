/*
 * menu.ts
 * 責務: 右下ナビゲーションメニューの開閉・各項目のイベント処理。資料（人物・地図・用語）・設定・共有・栞は
 *       メニューから開くシート（<dialog>。器は ui/sheet、中身は各部品）で、本文の上に重なる＝ページも読書位置も動かない。
 * export: init(characters: CharactersData): void
 * 依存: axis.ts（栞保存位置をスクロール範囲比＝forward 進行 px ÷ 可動域で取得）, state.ts（現ページの巻＝Stage の特定）,
 *       bookmark.ts, settings.ts, transition.ts, tutorial.ts, ui/share.ts, ui/sheet.ts（栞シートの器と dialog[open] の判定）,
 *       ui/world-sheet.ts（資料シート）
 *
 * メニュー項目と処理（順序は要件 06-2）：
 *   目次へ戻る        → transition.leave(state.indexUrl())（離脱フェード経由）
 *   栞を追加          → _openBookmarkPopup()（スロット選択のシートを開き、選んだ slot へ保存）
 *   チュートリアル    → tutorial.open()（初回ガイドの再表示）
 *   キャラクター紹介  → worldSheet.open('characters', _toggle)（資料シートの人物のタブ。Stage はそのページの巻）
 *   エシュカ地図      → worldSheet.open('map', _toggle)（同じシートの地図のタブ）
 *   用語集            → worldSheet.open('glossary', _toggle)（同じシートの用語のタブ。あとがきページでも出す）
 *   設定を開く        → settings.open(_toggle)
 *   共有              → share.open(_toggle)（リンクをコピー / X / LINE で現在の URL を共有。ui/share.ts）
 *   資料の 3 つ（キャラクター紹介・エシュカ地図・用語集）は区切りで挟み、キーカラーの印でまとめる（_ui.css）。
 *   閉じたときのフォーカス戻り先に _toggle（メニューボタン）を渡すのは、項目を押すとメニューを閉じてから開く
 *   ＝押されたメニュー項目はもう hidden の中にいるため。
 *
 * ※ マシュマロは本文末の #btn-share-marshmallow に集約（feedback.ts が管理）。メニューからの導線は持たない
 *
 * 栞シート（#bookmark-popup。器は templates/reader.html、見た目は _sheet.css）：
 *   - スロット1〜3のボタンのラベルを開く度に最新内容で書き直す（_refreshSlotLabels）
 *   - スロット押下で bookmark.addBookmark(state.getCurrent(), ratio, slot)（ratio＝forward 進行 px ÷ 可動域＝スクロール範囲比 0〜1）を呼んで上書き保存する
 *   - 保存済みスロットのラベルは「スロット○：第N話 #S（NN%）　MM/DD HH:MM」形式で、位置は ratio×100 を四捨五入した百分率を丸括弧で示す（空きは「空き」のみ・％表示なし）
 *
 * 開閉制御（メニュー）：
 *   - メニューボタン押下でトグル
 *   - Escape キーで閉じる。ただしシートか確認（<dialog>）が開いている間は手を出さない＝一番上の <dialog> を
 *     ブラウザが閉じる（以前はここに「栞→共有→キャラ→地図→用語→メニュー」の順番を手書きしていた）。
 *     用語の検索欄・日本語の変換中の例外は glossary.handleEscape が ui/sheet の onEscape として持つ
 *   - メニュー外クリックで閉じる
 *
 * キーボード操作：
 *   - メニュー内で上下キーによる項目選択（disabled 項目はスキップ）
 *   - Enter で実行
 *
 * 注意：
 *   - 「栞をすべて消す」「既読を消す」は設定シート（ui/settings-panel）のボタンが担当する。
 *     settings.ts へのコールバック注入は main.ts が行う（menu.ts は関与しない）。
 */

import * as axis from './axis';
import * as state from './state';
import * as bookmark from './bookmark';
import * as settings from './settings';
import * as transition from './transition';
import * as share from './ui/share';
import * as sheet from './ui/sheet';
import * as worldSheet from './ui/world-sheet';
import * as tutorial from './tutorial';
import type { CharactersData } from './types';
import type { StoryStage } from './volumes';

let _toggle: HTMLButtonElement;
let _panel: HTMLElement;
let _bookmark: HTMLDialogElement | null = null;
let _items: HTMLButtonElement[] = [];
let _charactersData: CharactersData = [];

// DOM からメニューボタン・パネル・オーバーレイを取得し、項目を生成してイベントを登録する。
// main.ts が起動時に一度だけ呼ぶ。キャラクター紹介データを受け取って保持する。
// vol の逆引きは state.getCurrentVolume() で行うため volumes データは引数で受け取らない。
// init(characters: CharactersData): void
export function init(characters: CharactersData): void {
    _charactersData = characters;
    _toggle = document.querySelector<HTMLButtonElement>('#menu-toggle')!;
    _panel = document.querySelector<HTMLElement>('#menu-panel')!;
    const bm = document.getElementById('bookmark-popup');
    _bookmark = bm instanceof HTMLDialogElement ? bm : null;
    worldSheet.init({ characters: () => _charactersData, stage: _pageStage });
    _buildItems();
    share.init();
    _wireBookmarkPopup();
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

    const makeBtn = (label: string, handler: () => void, cls?: string): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls ? `menu-item ${cls}` : 'menu-item';
        b.textContent = label;
        b.addEventListener('click', () => { _close(); handler(); });
        return b;
    };

    // あとがきモード時は「栞を追加」を出さない：state.getCurrent() が ep/sec=0 を返すため、
    // 押すと "00-00" を指す壊れた栞ができてしまう（あとがきは巻末 sec 本文の栞で代用する運用）。
    const isAfterword = state.getMode() === 'afterword';

    const btnIndex = makeBtn('目次へ戻る', () => {
        transition.leave(state.indexUrl());
    });

    const btnBookmark = isAfterword ? null : makeBtn('栞を追加', () => {
        _openBookmarkPopup();
    });

    const btnTutorial = makeBtn('チュートリアル', () => {
        tutorial.open();
    });

    // 閉じたときのフォーカス戻り先に _toggle を渡す：makeBtn は handler の前に _close() するので、
    // 押されたこのボタン自身はもう hidden のパネルの中にいる（戻しても見えない）
    const btnCharacters = makeBtn('キャラクター紹介', () => {
        worldSheet.open('characters', _toggle);
    }, 'menu-item--world');

    const btnMap = makeBtn('エシュカ地図', () => {
        worldSheet.open('map', _toggle);
    }, 'menu-item--world');

    const btnGlossary = makeBtn('用語集', () => {
        worldSheet.open('glossary', _toggle);
    }, 'menu-item--world');

    const btnSettings = makeBtn('設定', () => {
        settings.open(_toggle);
    });

    const btnShare = makeBtn('共有', () => {
        share.open(_toggle);
    });

    const head: HTMLButtonElement[] = [btnIndex];
    if (btnBookmark) head.push(btnBookmark);
    head.push(btnTutorial);
    const world = [btnCharacters, btnMap, btnGlossary];
    const tail = [btnSettings, btnShare];
    _panel.append(...head, sep(), ...world, sep(), ...tail);
    _items = [...head, ...world, ...tail];
}

// ── 栞シート（スロット選択） ─────────────────────────────────

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

// スクロール範囲比（0〜1）を "NN%" 表示にする（0/100 端は四捨五入で丸め・小数は出さない）。
// _formatRatioPercent(ratio: number): string
function _formatRatioPercent(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
}

// 栞シート（#bookmark-popup の静的 markup）のスロット1〜3のボタンに保存を結ぶ。器の開閉は ui/sheet。
// _wireBookmarkPopup(): void
function _wireBookmarkPopup(): void {
    if (!_bookmark) return;
    const dlg = _bookmark;
    sheet.init(dlg);
    for (const btn of dlg.querySelectorAll<HTMLButtonElement>('[data-slot]')) {
        const slot = Number(btn.dataset.slot);
        btn.addEventListener('click', () => {
            const container = document.querySelector<HTMLElement>('#main-container')!;
            const range = axis.getProgressRange(container);
            const ratio = range > 0 ? axis.getProgress(container) / range : 0;
            bookmark.addBookmark(state.getCurrent(), ratio, slot);
            sheet.close(dlg);
        });
        _slotBtns[slot] = btn;
    }
}

// 各スロットボタンのラベルを現在の保存内容（または「空き」）で更新する。
// _refreshSlotLabels(): void
function _refreshSlotLabels(): void {
    const bySlot = new Map(bookmark.getBookmarks().map(b => [b.slot, b]));
    for (let slot = 1; slot <= 3; slot++) {
        const entry = bySlot.get(slot);
        const detail = entry
            ? `第${entry.ep}話 #${entry.sec}（${_formatRatioPercent(entry.ratio)}）　${_formatSavedAt(entry.savedAt)}`
            : '空き';
        if (_slotBtns[slot]) _slotBtns[slot].textContent = `スロット${slot}：${detail}`;
    }
}

// 栞シートを開く。開く前にスロット内容を最新化する。
// _openBookmarkPopup(): void
function _openBookmarkPopup(): void {
    if (!_bookmark) return;
    _refreshSlotLabels();
    sheet.open(_bookmark, { opener: _toggle });
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

// 現ページ（本文 ep、あとがきモードなら現在 vol）が属する Stage（資料シートの人物のタブに渡す）。
// vol n のページは Stage n。巻が特定できない場合は Stage 1 にフォールバックする。
// あとがきモードでは state.getCurrent().ep が 0 になるため、epRange の逆引きでは巻が特定できない
// （以前は vol2+ のあとがきで誤って vol1 のキャストが出た）。state.getCurrentVolume() は本文／あとがき
// 両モードで正しく解決するのでこちらを使う。
// volume（number）を StoryStage に絞ってよいのは、巻数＋1 が Stage の上限を超えないことを
// story-integrity の (m) がビルドで保証しているため（巻番号は常に 1〜巻数＝Stage の範囲内）。
// _pageStage(): StoryStage
function _pageStage(): StoryStage {
    return (state.getCurrentVolume()?.volume ?? 1) as StoryStage;
}

// メニューボタン・Escape・外部クリック・上下キーのイベントを登録する。
// _registerEvents(): void
function _registerEvents(): void {
    _toggle.addEventListener('click', () => {
        if (_panel.hidden) _open(); else _close();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // シートか確認（<dialog>）が開いていれば、一番上のものをブラウザが閉じる（冒頭コメント）
            if (sheet.anyOpen()) return;
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
}
