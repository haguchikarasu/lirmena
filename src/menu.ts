/*
 * menu.ts
 * 責務: 右下ナビゲーションメニューの開閉・各項目のイベント処理。資料（人物・地図・用語）・設定・共有・栞は
 *       メニューから開くシート（<dialog>。器は ui/sheet、中身は各部品）で、本文の上に重なる＝ページも読書位置も動かない。
 * export: init(characters: CharactersData): void
 * 依存: axis.ts（栞保存位置をスクロール範囲比＝forward 進行 px ÷ 可動域で取得）, state.ts（現ページの巻＝Stage の特定）,
 *       bookmark.ts, settings.ts, transition.ts, tutorial.ts, ui/share.ts, ui/sheet.ts（栞シートの器）,
 *       ui/world-sheet.ts（資料シート）
 *
 * メニュー項目と処理（順序は要件 06-2）：
 *   目次へもどる        → transition.leave(state.indexUrl())（離脱フェード経由）
 *   栞を追加          → _openBookmarkPopup()（スロット選択のシートを開き、選んだ slot へ保存）
 *   チュートリアル    → tutorial.open()（初回ガイドの再表示）
 *   キャラクター紹介  → worldSheet.open('characters', _toggle)（資料シートの人物のタブ。Stage はそのページの巻）
 *   エシュカ地図      → worldSheet.open('map', _toggle)（同じシートの地図のタブ）
 *   用語集            → worldSheet.open('glossary', _toggle)（同じシートの用語のタブ。あとがきページでも出す）
 *   設定を開く        → settings.open(_toggle)
 *   共有              → share.open(_toggle)（リンクをコピー / X / LINE で現在の URL を共有。ui/share.ts）
 *   資料の 3 つ（キャラクター紹介・エシュカ地図・用語集）は区切りで挟んでまとめる（アイコンの色は全項目で同じ。_ui.css）。
 *   各項目の頭にアイコン（templates/reader.html の #menu-icon-tpl を data-icon の名前で複製。飾り＝読み上げない）。
 *   閉じたときのフォーカス戻り先に _toggle（メニューボタン）を渡すのは、項目を押すとメニューを閉じてから開く
 *   ＝押されたメニュー項目はもう閉じたパネルの中にいるため。
 *
 * ※ マシュマロは本文末の #btn-share-marshmallow に集約（feedback.ts が管理）。メニューからの導線は持たない
 *
 * 栞シート（#bookmark-popup。器は templates/reader.html、見た目は _sheet.css）：
 *   - スロット1〜3のボタンのラベルを開く度に最新内容で書き直す（_refreshSlotLabels）
 *   - スロット押下で bookmark.addBookmark(state.getCurrent(), ratio, slot)（ratio＝forward 進行 px ÷ 可動域＝スクロール範囲比 0〜1）を呼んで上書き保存する
 *   - 保存済みスロットのラベルは「スロット○：第N話 #S（NN%）　MM/DD HH:MM」形式で、位置は ratio×100 を四捨五入した百分率を丸括弧で示す（空きは「空き」のみ・％表示なし）
 *
 * 開閉制御（メニュー）：パネルは popover（templates/reader.html の popover="auto"）で、開閉はブラウザが持つ。
 *   - メニューボタン（commandfor / command="toggle-popover"）を押す・Enter・Space でトグル
 *   - Escape・メニュー外のクリックやタップで閉じる（ブラウザの light dismiss。ここに手書きの処理は無い）
 *   - ここが足すのは 4 つ：aria-expanded の同期／キーボードで開いたときだけ先頭の項目へフォーカスを入れる
 *     （マウスやタップで開いたときはボタンに残す）／閉じるときフォーカスが中にあればボタンへ戻す／
 *     フォーカスがメニューの外へ出たら閉じる（Tab で出たとき）
 *   - 開いているかは _panel.matches(':popover-open') で見る（immersive.ts の isOverlayOpen も同じ擬似クラスを読む）
 *   - シートや確認（<dialog> の showModal）を開くと、ブラウザが popover を閉じる。項目の click は先に自分で閉じる
 *
 * キーボード操作（開いている間）：
 *   - 上下キーで項目を移る（disabled 項目はスキップ。端では止まる）。Home / End で最初 / 最後へ
 *   - Enter・Space で実行（<button> の既定の動き）
 *   - 閉じているときの上下キーには手を出さない（本文のスクロール＝keyscroll.ts）
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
let _enterOnOpen = false;   // 次に開いたとき先頭の項目へフォーカスを入れるか（キーボードで開いたときだけ true）
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
    // 区切りは <hr>（読み上げにも区切りとして伝わり、フォーカスは止まらない）
    const sep = (): HTMLElement => document.createElement('hr');

    // アイコンの見本（#menu-icon-tpl）。無ければ文字だけの項目になる
    const icons = (document.getElementById('menu-icon-tpl') as HTMLTemplateElement | null)?.content;
    const makeBtn = (label: string, icon: string, handler: () => void, cls?: string): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls ? `menu-item ${cls}` : 'menu-item';
        const svg = icons?.querySelector(`[data-icon="${icon}"]`);
        if (svg) b.appendChild(svg.cloneNode(true));
        b.appendChild(document.createTextNode(label));
        b.addEventListener('click', () => { _close(); handler(); });
        return b;
    };

    // あとがきモード時は「栞を追加」を出さない：state.getCurrent() が ep/sec=0 を返すため、
    // 押すと "00-00" を指す壊れた栞ができてしまう（あとがきは巻末 sec 本文の栞で代用する運用）。
    const isAfterword = state.getMode() === 'afterword';

    const btnIndex = makeBtn('目次へもどる', 'toc', () => {
        transition.leave(state.indexUrl());
    });

    const btnBookmark = isAfterword ? null : makeBtn('栞を追加', 'bookmark-plus', () => {
        _openBookmarkPopup();
    });

    const btnTutorial = makeBtn('チュートリアル', 'help', () => {
        tutorial.open({ opener: _toggle });   // 戻り先は下の人物・地図と同じ理由で _toggle
    });

    // 閉じたときのフォーカス戻り先に _toggle を渡す：makeBtn は handler の前に _close() するので、
    // 押されたこのボタン自身はもう閉じたパネルの中にいる（戻しても見えない）
    const btnCharacters = makeBtn('人物', 'people', () => {
        worldSheet.open('characters', _toggle);
    }, 'menu-item--world');

    const btnMap = makeBtn('地図', 'map', () => {
        worldSheet.open('map', _toggle);
    }, 'menu-item--world');

    const btnGlossary = makeBtn('用語', 'book', () => {
        worldSheet.open('glossary', _toggle);
    }, 'menu-item--world');

    const btnSettings = makeBtn('設定', 'gear', () => {
        settings.open(_toggle);
    });

    const btnShare = makeBtn('共有', 'share', () => {
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

// メニューが開いているか（popover の状態そのものを読む。別の変数に写さない）。
// _isOpen(): boolean
function _isOpen(): boolean {
    return _panel.matches(':popover-open');
}

// メニューを閉じる。閉じていれば何もしない（閉じた popover の hidePopover() は例外になる）。
// _close(): void
function _close(): void {
    if (_isOpen()) _panel.hidePopover();
}

// 押せる項目（disabled でないもの）。
// _enabledItems(): HTMLButtonElement[]
function _enabledItems(): HTMLButtonElement[] {
    return _items.filter(b => !b.disabled);
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

// 開閉に付随する処理（aria-expanded・フォーカス）と、開いている間のキー操作を登録する。開閉そのものはブラウザ。
// _registerEvents(): void
function _registerEvents(): void {
    // キーボードで開くとき（Enter・Space が作る click は detail が 0）だけ、開いたあと先頭の項目へ入る。
    // この click の既定の動き（command="toggle-popover"）が、このあとパネルを開閉する。
    _toggle.addEventListener('click', (e) => {
        _enterOnOpen = e.detail === 0 && !_isOpen();
    });

    // 閉じる直前：フォーカスが中にあればボタンへ戻す（Escape・項目の実行）。外へ出て閉じるとき（Tab・外側のクリック）は
    // フォーカスはもう外にあるので動かさない。ブラウザも戻すが、戻り先は「開いたときにフォーカスがあった所」＝
    // クリックでボタンにフォーカスが入らないブラウザでは body になる。
    _panel.addEventListener('beforetoggle', (ev) => {
        const e = ev as ToggleEvent;
        if (e.newState === 'closed' && _panel.contains(document.activeElement)) _toggle.focus();
    });

    // 開閉のあと：aria-expanded を合わせ、キーボードで開いたなら先頭へ（command の時点ではまだ開いていない）
    _panel.addEventListener('toggle', (ev) => {
        const e = ev as ToggleEvent;
        const open = e.newState === 'open';
        _toggle.setAttribute('aria-expanded', String(open));
        // この通知は開いた少しあとに届く。その間に ↓ などで中へ入っていたら、先頭へ引き戻さない
        if (open && _enterOnOpen && !_panel.contains(document.activeElement)) _enabledItems()[0]?.focus();
        _enterOnOpen = false;
    });

    // フォーカスがメニュー（ボタンとパネル）の外へ出たら閉じる。Tab は閉じ込めない
    document.addEventListener('focusin', (e) => {
        if (!_isOpen()) return;
        const target = e.target as Node;
        if (!_toggle.contains(target) && !_panel.contains(target)) _close();
    });

    document.addEventListener('keydown', (e) => {
        if (!_isOpen()) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const items = _enabledItems();
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        // 最後の項目からの Tab：メニューはページの最後の部品なので、フォーカスはページの外（ブラウザの UI）へ出て
        // focusin が来ない。ここで閉じる（フォーカスはいったんボタンへ戻り、Tab の既定の動きでその先へ進む）
        if (e.key === 'Tab' && !e.shiftKey && idx === items.length - 1) { _close(); return; }
        let next: HTMLButtonElement | undefined;
        // フォーカスが項目に無いとき（マウスで開いた直後）は、↓ で先頭へ入る。端では止まる（回り込まない）
        if (e.key === 'ArrowDown') next = items[idx + 1] ?? items[idx];
        else if (e.key === 'ArrowUp') next = idx <= 0 ? items[idx] : items[idx - 1];
        else if (e.key === 'Home') next = items[0];
        else if (e.key === 'End') next = items[items.length - 1];
        else return;
        e.preventDefault();   // パネルの中のスクロールと、本文のスクロール（keyscroll.ts）へ流さない
        next?.focus();
    });
}
