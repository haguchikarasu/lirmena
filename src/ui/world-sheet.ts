/*
 * ui/world-sheet.ts
 * 責務: 資料シート（#world-sheet。人物・地図・用語の 3 つのタブ）の開閉とタブの切り替え。markup は差し込みの断片
 *       templates/parts/world.html、器の操作は ui/sheet、中身は部品（characters.render・map.mount・glossary.mountPanel）。
 * export: type WorldTab = 'characters' | 'map' | 'glossary'
 *         init(source: WorldSource): void
 *         open(tab: WorldTab, opener?: HTMLElement | null): void
 *         isOpen(): boolean
 * 依存: ui/sheet、characters・map・glossary（ui 層の部品）、core/query、types・volumes（型だけ）。ui 層＝reader 層を import しない。
 *       呼び出し元：menu.ts（本文の FAB）だけ。目次の「世界」のタイルは資料ページへ移る（シートを開かない）。
 *
 * 人物のデータと Stage は呼び出す側が渡す（WorldSource）：本文は「そのページが属する Stage」。
 * 人物のタブは開くたび・タブを選ぶたびに描き直す。
 * 地図と用語は最初に開いたときだけ作る（画像・md を開くまで落とさない）。
 * Escape：用語のタブでは glossary.handleEscape が閉じる要求を止めることがある（日本語の変換中・検索欄に文字があるとき）。
 * 「ページで開く」（#world-sheet-page）：いまのタブの資料ページ（<tab>.html）を指す。タブを切り替えるたびに href を
 * 付け直す。?dev は core/query の withQuery で引き継ぐ（落ちると作者の閲覧が計測される）。人物のタブでは、いま見ている
 * 巻と人を # に載せる（characters.viewToHash。人物のページが読んで同じ巻・同じ人で開く。巻・人が替わるたびに付け直す）。同じタブで移る
 * （別タブはスマホで気づかれにくく「戻る」も効かない。iOS の PWA では保存領域の別な Safari に出てしまう）。
 * 戻るのはブラウザの「戻る」か、資料ページの帯の ‹（ui/world-nav）。
 * シートだけが持つ（部品はページかシートかを知らない＝部品の中に置くと、資料ページの上で自分自身を指してしまう）。
 */

import * as sheet from './sheet';
import * as characters from '../characters';
import * as map from '../map';
import * as glossary from '../glossary';
import { withQuery } from '../core/query';
import type { CharactersData } from '../types';
import type { StoryStage } from '../volumes';

export type WorldTab = 'characters' | 'map' | 'glossary';

// WorldSource: 人物のタブを描くのに要るもの。data が null（characters.json の取得に失敗した）なら空で描く。
export type WorldSource = {
    characters: () => CharactersData | null;
    stage: () => StoryStage;
};

let _dlg: HTMLDialogElement | null = null;
let _source: WorldSource | null = null;
let _tab: WorldTab = 'characters';
let _mapMounted = false;
// 人物のタブでいま見ている巻と人（「ページで開く」の # に載せる）。人物のタブを描くたびに部品から知らされる
let _charView: characters.CharacterView | null = null;

// init(source: WorldSource): void
// 断片が無いページでは何もしない。
export function init(source: WorldSource): void {
    const dlg = document.getElementById('world-sheet');
    if (!(dlg instanceof HTMLDialogElement)) return;
    _dlg = dlg;
    _source = source;
    sheet.init(dlg, { onEscape: (e) => _tab !== 'glossary' || glossary.handleEscape(e) });
    for (const btn of dlg.querySelectorAll<HTMLButtonElement>('.sheet-tab[data-tab]')) {
        btn.addEventListener('click', () => _show(btn.dataset.tab as WorldTab));
    }
}

// open(tab: WorldTab, opener?: HTMLElement | null): void
// opener には閉じたときにフォーカスを戻す要素を渡す（本文＝#menu-toggle）。
export function open(tab: WorldTab, opener?: HTMLElement | null): void {
    if (!_dlg) return;
    sheet.open(_dlg, { opener });
    _show(tab);
}

// isOpen(): boolean
export function isOpen(): boolean {
    return sheet.isOpen(_dlg);
}

// タブを切り替えて中身を描く。切り替えたらタブの中身へフォーカスを移す（スマホでは何も光らない・キーボードは中から Tab）。
// _show(tab: WorldTab): void
function _show(tab: WorldTab): void {
    if (!_dlg) return;
    _tab = tab;
    _dlg.dataset.tab = tab;
    for (const btn of _dlg.querySelectorAll<HTMLButtonElement>('.sheet-tab[data-tab]')) {
        btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    }
    const panels: Record<WorldTab, HTMLElement | null> = {
        characters: _dlg.querySelector('#characters-overlay'),
        map: _dlg.querySelector('#map-overlay'),
        glossary: _dlg.querySelector('#glossary-overlay'),
    };
    for (const [key, panel] of Object.entries(panels)) {
        if (panel) panel.hidden = key !== tab;
    }
    const panel = panels[tab];
    if (!panel) return;
    _charView = null;
    _setPageLink();
    if (tab === 'characters' && _source) {
        characters.render(panel, _source.characters() ?? [], _source.stage(), {
            onChange: (view) => { _charView = view; _setPageLink(); },
        });
    } else if (tab === 'map' && !_mapMounted) {
        map.mount(panel);
        _mapMounted = true;
    } else if (tab === 'glossary') {
        glossary.mountPanel(panel);
    }
    panel.focus({ preventScroll: true });
}

// 「ページで開く」の行き先を、いまのタブの資料ページにする（人物のタブなら見ている巻と人を # に）。
// _setPageLink(): void
function _setPageLink(): void {
    const link = _dlg?.querySelector<HTMLAnchorElement>('#world-sheet-page');
    if (!link) return;
    const hash = _tab === 'characters' && _charView ? `#${characters.viewToHash(_charView)}` : '';
    link.href = withQuery(`${import.meta.env.BASE_URL}${_tab}.html`) + hash;
}
