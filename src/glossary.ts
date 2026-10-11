/*
 * glossary.ts
 * 責務: 用語集（public/glossary.md）の取得・パース・検査と、一覧の描画（検索・五十音ナビ・相互参照）。
 *       本文ページのポップアップ（#glossary-overlay。menu.ts が開く）と、用語集ページ（glossary-page.ts）で共用する。
 * export: 純関数 … KANA_ROWS / parseGlossary(md) / splitRefs(text, terms) / validateGlossary(g)
 *         DOM    … loadGlossary() / mountGlossary(ui) / init() / open(opener?) / close() / isOpen() / isEditingSearch()
 * 依存: なし（DOM と import.meta.env.BASE_URL だけを読むリーフ。.dependency-cruiser.cjs の LEAF に入れてある）
 *       純関数部分はトップレベルで DOM に触れない＝Vitest（glossary.test.ts）から import できる
 *
 * md の書式（執筆/設定/公開/用語集.md の写し。書式は執筆側との契約＝design/modules/glossary.md）：
 *   # あ 〜 # わ        五十音の行見出し（KANA_ROWS の 10 個。あ→わ の順、飛ばすのは可、重複は不可）
 *   # 用語集             行名でない # はタイトル。最初の行見出しより前に 0〜1 回だけ許す（表示には使わない）
 *   ## 見出し語          1 項目の始まり。行見出しより前に置くとエラー
 *   【フェルブ語: eshka】 見出し語の直後に 0 行以上。言語名と綴り
 *   段落（空行区切り）／| 表 |／1. リスト   本文
 *   →見出し語            本文中のどこでも。その項目へのリンク。本文が「→X」1 行だけの項目は参照のみの項目
 *   並び順は md の記述順のまま（ソートしない）
 *
 * 「→」の区切り方は splitRefs 1 本に集約し、描画と検査が同じ関数を使う（描画ではリンクにならないのに検査は通る、
 * という食い違いを作らない）。→ の直後（空白は読み飛ばす）から最も長く前方一致する見出し語をリンクにし、
 * どの見出し語にも一致しない → は検査ではエラー・描画ではただの文字。
 *
 * ポップアップ（map.ts と同じ「空の器＋動的生成」方式）：
 *   - 器 <section id="glossary-overlay" hidden role="dialog"> は templates/reader.html に置く。init() が中身を生成する
 *   - md は open() の初回に取得する＝開くまで読まない（全本文ページで 20KB を無駄に読まない。map.ts の画像と同じ）
 *   - 閉じる方法：背景クリックと閉じるボタンはここで登録する。**Escape は拾わない**（menu.ts のキー処理が
 *     isOpen() / close() / isEditingSearch() を使って優先順位を決める）
 *   - フォーカス：open() で閉じるボタンへ移し、close() で opener へ戻す（map.ts と同じ理由）
 *   - 検索語とスクロール位置は閉じても残す（同じ語を引き直しやすい）。ページを移れば消える＝保存はしない
 *
 * 「ページで開く」と「目次へ」に location.search を付けるのは state.ts の _withQuery と同じ 1 行の複製
 * （リーフ／独立エントリなので state を import できない）。?dev が落ちると作者の閲覧が計測される。
 * 見張るのは e2e/glossary.spec.ts だけ（Playwright は CI に入っていない＝ローカルで回したときだけ効く）。
 *
 * 読み込む側は `import * as glossary from './glossary'` とする（menu.ts の mapPopup と同じ流儀）。
 */

// ===== 純関数 =====

/** 五十音の行名（md の行見出し `# あ` などに使える値。この順で並ぶ） */
export const KANA_ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'] as const;

export interface GlossaryLang { lang: string; word: string }
export type GlossaryBlock =
    | { type: 'p'; text: string }
    | { type: 'table'; rows: string[][] }
    | { type: 'ol'; items: string[] };
export interface GlossaryEntry {
    term: string;
    /** 要素 id（`g-見出し語`）。直リンク #g-見出し語 と相互参照の飛び先 */
    id: string;
    /** 属する五十音の行。行見出しより前に置かれた項目は '' */
    row: string;
    langs: GlossaryLang[];
    blocks: GlossaryBlock[];
    /** 本文が「→X」1 行だけの項目なら X、それ以外は null */
    alias: string | null;
}
export interface Glossary {
    entries: GlossaryEntry[];
    /** パース中に見つけた構造の違反（validateGlossary が他の違反と合わせて返す） */
    issues: string[];
}
export type GlossaryInline = { type: 'text'; text: string } | { type: 'ref'; term: string };

const ROW_SET: ReadonlySet<string> = new Set(KANA_ROWS);

/**
 * md 文字列を項目の配列にする。構造の違反（行見出しより前の項目・行見出しの重複や順序違反・タイトルの重複や
 * 途中出現）は issues に積んで続行する＝描画は壊れた md でも可能な範囲で行う。
 * parseGlossary(md: string): Glossary
 */
export function parseGlossary(md: string): Glossary {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const issues: string[] = [];
    const chunks: { term: string; row: string; raw: string[] }[] = [];
    let row = '';
    let rowIndex = -1;
    let titleSeen = false;

    lines.forEach((line, i) => {
        const at = `${i + 1} 行目`;
        const h2 = /^##\s+(.+?)\s*$/.exec(line);
        if (h2) {
            if (row === '') issues.push(`${at}：「${h2[1]}」が五十音の行見出し（# あ など）より前にある`);
            chunks.push({ term: h2[1], row, raw: [] });
            return;
        }
        const h1 = /^#\s+(.+?)\s*$/.exec(line);
        if (h1) {
            const name = h1[1];
            if (ROW_SET.has(name)) {
                const idx = KANA_ROWS.indexOf(name as typeof KANA_ROWS[number]);
                if (name === row || idx === rowIndex) issues.push(`${at}：行見出し「# ${name}」が重複している`);
                else if (idx < rowIndex) issues.push(`${at}：行見出し「# ${name}」が「# ${row}」より後ろにある（あ→わ の順）`);
                row = name;
                rowIndex = Math.max(rowIndex, idx);
            } else if (chunks.length || row !== '') {
                issues.push(`${at}：「# ${name}」は五十音の行名ではない（タイトルは最初の行見出しより前に 1 回だけ）`);
            } else if (titleSeen) {
                issues.push(`${at}：タイトル「# ${name}」が 2 回目`);
            } else {
                titleSeen = true;
            }
            return;
        }
        if (chunks.length) chunks[chunks.length - 1].raw.push(line);
    });

    const entries = chunks.map(({ term, row, raw }): GlossaryEntry => {
        const langs: GlossaryLang[] = [];
        const blocks: GlossaryBlock[] = [];
        let para: string[] = [];
        const flush = (): void => {
            if (para.length) { blocks.push({ type: 'p', text: para.join('') }); para = []; }
        };

        for (let i = 0; i < raw.length; i++) {
            const line = raw[i].trim();
            const lang = /^【(.+?)[:：]\s*(.+)】$/.exec(line);
            if (lang && !blocks.length && !para.length) { langs.push({ lang: lang[1], word: lang[2] }); continue; }
            if (line === '') { flush(); continue; }
            if (line.startsWith('|')) {
                flush();
                const rows: string[][] = [];
                for (; i < raw.length && raw[i].trim().startsWith('|'); i++) {
                    const cells = raw[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
                    if (!cells.every(c => /^:?-+:?$/.test(c))) rows.push(cells);   // 区切り行 |---| を捨てる
                }
                i--;
                blocks.push({ type: 'table', rows });
                continue;
            }
            if (/^\d+\.\s/.test(line)) {
                flush();
                const items: string[] = [];
                for (; i < raw.length && /^\d+\.\s/.test(raw[i].trim()); i++) items.push(raw[i].trim().replace(/^\d+\.\s+/, ''));
                i--;
                blocks.push({ type: 'ol', items });
                continue;
            }
            para.push(line);
        }
        flush();

        const only = blocks.length === 1 && blocks[0].type === 'p' ? /^→\s*(.+)$/.exec(blocks[0].text) : null;
        return { term, id: `g-${term}`, row, langs, blocks: only ? [] : blocks, alias: only ? only[1] : null };
    });

    return { entries, issues };
}

/**
 * 本文を「地の文」と「→見出し語」に区切る。terms は見出し語の一覧（順不同。内部で長い順に照合する）。
 * どの見出し語にも一致しない → は地の文に残す（検査側は findUnresolvedRefs で拾う）。
 * splitRefs(text: string, terms: readonly string[]): GlossaryInline[]
 */
export function splitRefs(text: string, terms: readonly string[]): GlossaryInline[] {
    const byLength = _byLength(terms);
    const out: GlossaryInline[] = [];
    let buf = '';
    let i = 0;
    while (i < text.length) {
        const j = text.indexOf('→', i);
        if (j < 0) { buf += text.slice(i); break; }
        buf += text.slice(i, j);
        const m = _matchRef(text, j, byLength);
        if (m.term) {
            if (buf) { out.push({ type: 'text', text: buf }); buf = ''; }
            out.push({ type: 'ref', term: m.term });
            i = m.end;
        } else {
            buf += '→';
            i = j + 1;
        }
    }
    if (buf) out.push({ type: 'text', text: buf });
    return out;
}

const _byLength = (terms: readonly string[]): string[] => [...terms].sort((a, b) => b.length - a.length);

/**
 * text[j] の → に続く見出し語を照合する（→ の直後の空白は読み飛ばす・最も長く前方一致するもの）。
 * splitRefs（描画）と validateGlossary（検査）の両方がこれを使う＝区切り方が食い違わない。
 * 一致しなければ term は null、start は → の直後の最初の非空白文字の位置。
 */
function _matchRef(text: string, j: number, byLength: readonly string[]): { term: string | null; start: number; end: number } {
    let k = j + 1;
    while (text[k] === ' ' || text[k] === '　') k++;
    const term = byLength.find(t => text.startsWith(t, k)) ?? null;
    return { term, start: k, end: term ? k + term.length : k };
}

/** 項目の本文に現れる文字列（参照のみの項目は「→X」）を全部並べる。検索と検査が使う */
function _texts(e: GlossaryEntry): string[] {
    if (e.alias !== null) return [`→${e.alias}`];
    return e.blocks.flatMap(b => (b.type === 'p' ? [b.text] : b.type === 'ol' ? b.items : b.rows.flat()));
}

/**
 * md の契約違反を全部返す（空配列なら公開してよい）。parseGlossary の issues に、見出し語の重複・
 * 参照先の無い →・本文も参照先も無い項目を足す。glossary.test.ts が実ファイルに対して回す＝CI で公開を止める。
 * validateGlossary(g: Glossary): string[]
 */
export function validateGlossary(g: Glossary): string[] {
    const errors = [...g.issues];
    const terms = g.entries.map(e => e.term);
    const seen = new Set<string>();
    for (const t of terms) {
        if (seen.has(t)) errors.push(`見出し語「${t}」が重複している`);
        seen.add(t);
    }
    const byLength = _byLength(terms);
    for (const e of g.entries) {
        if (e.alias === null && e.blocks.length === 0) errors.push(`「${e.term}」に本文も参照先も無い`);
        for (const text of _texts(e)) {
            for (let j = text.indexOf('→'); j >= 0; j = text.indexOf('→', j + 1)) {
                const m = _matchRef(text, j, byLength);
                if (m.term) continue;
                const target = text.slice(m.start).split(/[\s。、→]/)[0];
                errors.push(`「${e.term}」の「→${target}」に一致する見出し語が無い`);
            }
        }
    }
    return errors;
}

// 検索の正規化：カタカナ→ひらがな・英字を小文字に。「えしゅか」でも「エシュカ」に当たる
const _normalize = (s: string): string =>
    s.toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

// ===== DOM：取得 =====

let _loading: Promise<Glossary> | null = null;

/**
 * public/glossary.md を取得してパースする。結果はページ内で使い回す（2 回目以降は同じ Promise）。
 * 失敗したら次の呼び出しで取り直せるよう、キャッシュを捨てて reject する。
 * loadGlossary(): Promise<Glossary>
 */
export function loadGlossary(): Promise<Glossary> {
    _loading ??= fetch(`${import.meta.env.BASE_URL}glossary.md`)
        .then(res => {
            if (!res.ok) throw new Error(`glossary.md: HTTP ${res.status}`);
            return res.text();
        })
        .then(parseGlossary)
        .catch((err: unknown) => {
            _loading = null;
            throw err;
        });
    return _loading;
}

// ===== DOM：一覧の描画と結線 =====

export interface GlossaryUi {
    /** 一覧を入れる器（中身は作り直す） */
    list: HTMLElement;
    search: HTMLInputElement;
    /** 五十音ボタンを入れる器（中身は作り直す） */
    kana: HTMLElement;
    /** 件数表示（任意） */
    count?: HTMLElement;
    /** 相互参照で飛んだとき location.hash を書き換えるか（用語集ページ＝true／ポップアップ＝false） */
    updateHash?: boolean;
}

function _el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

// 地の文と →見出し語 を DOM に並べる（innerHTML を使わない＝エスケープ漏れが原理的に起きない）
function _appendInline(parent: HTMLElement, text: string, terms: readonly string[]): void {
    for (const seg of splitRefs(text, terms)) {
        if (seg.type === 'text') { parent.append(seg.text); continue; }
        const a = _el('a', 'gl-ref', `→${seg.term}`);
        a.href = `#g-${seg.term}`;
        a.dataset.target = `g-${seg.term}`;
        parent.appendChild(a);
    }
}

function _renderEntry(e: GlossaryEntry, terms: readonly string[]): HTMLElement {
    const art = _el('article', 'gl-entry');
    art.id = e.id;
    art.dataset.search = _normalize([e.term, ...e.langs.map(l => l.word), ..._texts(e)].join('\n'));

    // 言語と綴りは見出し語の補足なので、見出し語と同じ行（header の中）に添える
    const head = _el('header', 'gl-head');
    head.appendChild(_el('h3', 'gl-term', e.term));
    if (e.langs.length) {
        const langs = _el('p', 'gl-langs');
        for (const l of e.langs) {
            const span = _el('span', 'gl-lang');
            span.append(_el('span', 'gl-lang-name', l.lang), _el('span', 'gl-lang-word', l.word));
            langs.appendChild(span);
        }
        head.appendChild(langs);
    }
    art.appendChild(head);

    if (e.alias !== null) {
        const p = _el('p', 'gl-alias');
        _appendInline(p, `→${e.alias}`, terms);
        art.appendChild(p);
        return art;
    }
    for (const b of e.blocks) {
        if (b.type === 'p') {
            const p = _el('p');
            _appendInline(p, b.text, terms);
            art.appendChild(p);
        } else if (b.type === 'ol') {
            const ol = _el('ol');
            for (const it of b.items) {
                const li = _el('li');
                _appendInline(li, it, terms);
                ol.appendChild(li);
            }
            art.appendChild(ol);
        } else {
            const table = _el('table', 'gl-table');
            const [headRow, ...bodyRows] = b.rows;
            const thead = _el('thead');
            const tr = _el('tr');
            for (const c of headRow ?? []) { const th = _el('th'); _appendInline(th, c, terms); tr.appendChild(th); }
            thead.appendChild(tr);
            const tbody = _el('tbody');
            for (const r of bodyRows) {
                const row = _el('tr');
                for (const c of r) { const td = _el('td'); _appendInline(td, c, terms); row.appendChild(td); }
                tbody.appendChild(row);
            }
            table.append(thead, tbody);
            art.appendChild(table);
        }
    }
    return art;
}

/**
 * 一覧を描き、検索欄・五十音ナビ・相互参照リンクを結線する。
 * renderGlossary(ui: GlossaryUi, g: Glossary): void
 */
export function renderGlossary(ui: GlossaryUi, g: Glossary): void {
    const terms = g.entries.map(e => e.term);
    ui.list.textContent = '';
    const groups: HTMLElement[] = [];
    for (const row of KANA_ROWS) {
        const list = g.entries.filter(e => e.row === row);
        if (!list.length) continue;
        const group = _el('section', 'gl-group');
        group.dataset.kana = row;
        group.appendChild(_el('h2', 'gl-row-head', row));
        for (const e of list) group.appendChild(_renderEntry(e, terms));
        ui.list.appendChild(group);
        groups.push(group);
    }
    const empty = _el('p', 'gl-empty', '該当する用語がありません');
    empty.hidden = true;
    ui.list.appendChild(empty);

    const entries = [...ui.list.querySelectorAll<HTMLElement>('.gl-entry')];

    // 五十音ナビ。絞り込み中に押されたら検索を解いてから飛ぶ
    ui.kana.textContent = '';
    const kanaBtns = KANA_ROWS.map(row => {
        const b = _el('button', 'gl-kana-btn', row);
        b.type = 'button';
        b.setAttribute('aria-label', `${row}行へ`);
        b.addEventListener('click', () => {
            if (ui.search.value) { ui.search.value = ''; applyFilter(); }
            groups.find(gr => gr.dataset.kana === row)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        ui.kana.appendChild(b);
        return b;
    });

    const applyFilter = (): void => {
        const q = _normalize(ui.search.value.trim());
        let shown = 0;
        for (const e of entries) {
            const hit = !q || (e.dataset.search ?? '').includes(q);
            e.hidden = !hit;
            if (hit) shown++;
        }
        for (const gr of groups) gr.hidden = !gr.querySelector('.gl-entry:not([hidden])');
        empty.hidden = shown > 0;
        kanaBtns.forEach((b, i) => {
            const gr = groups.find(x => x.dataset.kana === KANA_ROWS[i]);
            b.disabled = !gr || gr.hidden;
        });
        if (ui.count) ui.count.textContent = q ? `${shown} 件` : `全 ${entries.length} 語`;
    };
    ui.search.addEventListener('input', applyFilter);
    applyFilter();

    // 相互参照：飛び先が絞り込みで隠れていたら検索を解いてから飛ぶ。着地した項目を一瞬光らせる
    ui.list.addEventListener('click', (ev) => {
        const a = (ev.target as Element | null)?.closest<HTMLAnchorElement>('a.gl-ref');
        if (!a || !a.dataset.target) return;
        ev.preventDefault();
        const target = ui.list.ownerDocument.getElementById(a.dataset.target);
        if (!target) return;
        if (target.hidden) { ui.search.value = ''; applyFilter(); }
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        flash(target);
        if (ui.updateHash) history.replaceState(history.state, '', `#${a.dataset.target}`);
    });
}

/**
 * 着地した項目を一瞬光らせる（どこに着いたか分かるように）。アニメーションは _glossary.css の .gl-flash。
 * flash(el: HTMLElement): void
 */
export function flash(el: HTMLElement): void {
    el.classList.remove('gl-flash');
    void el.offsetWidth;   // 同じ項目に続けて飛んだときもアニメーションをやり直す
    el.classList.add('gl-flash');
}

/**
 * 取得して描画・結線まで済ませる（用語集ページの入口）。失敗したら一覧の位置に文言を出して reject する。
 * mountGlossary(ui: GlossaryUi): Promise<void>
 */
export async function mountGlossary(ui: GlossaryUi): Promise<void> {
    try {
        renderGlossary(ui, await loadGlossary());
    } catch (err) {
        _showError(ui);
        throw err;
    }
}

function _showError(ui: GlossaryUi): void {
    ui.list.textContent = '';
    ui.list.appendChild(_el('p', 'gl-empty', '用語集を読み込めませんでした。'));
    ui.search.disabled = true;
    ui.kana.textContent = '';
}

// ===== DOM：ポップアップ（本文ページ） =====

let _overlay: HTMLElement | null = null;
let _closeBtn: HTMLButtonElement | null = null;
let _search: HTMLInputElement | null = null;
let _ui: GlossaryUi | null = null;
let _mounted: Promise<void> | null = null;
let _opener: HTMLElement | null = null;   // 閉じたときにフォーカスを戻す先（open() の引数）

/**
 * 空の器 #glossary-overlay にパネル（見出し・「ページで開く」・閉じるボタン・検索欄・五十音・一覧）を生成し、
 * 背景クリックと閉じるボタンを登録する。各ページの起動時に一度だけ呼ぶ。器が無いページでは何もしない。
 * init(): void
 */
export function init(): void {
    _overlay = document.querySelector<HTMLElement>('#glossary-overlay');
    if (!_overlay) return;

    // .gl-root はアクセント色（--gl-accent）を合成する器。検索欄・五十音・一覧のすべてがこの下にある（_glossary.css）
    const popup = _el('article', 'gl-root');
    popup.id = 'glossary-popup';

    const head = _el('header');
    head.id = 'glossary-popup-head';
    const bar = _el('section');
    bar.id = 'glossary-popup-bar';
    const title = _el('h2', undefined, '用語集');
    title.id = 'glossary-popup-title';

    // 別タブで用語集ページを開く（じっくり読みたい読者向け）。?dev を引き継ぐ（冒頭コメント）
    const pageLink = _el('a', undefined, 'ページで開く');
    pageLink.id = 'glossary-popup-page';
    pageLink.href = `${import.meta.env.BASE_URL}glossary.html${location.search}`;
    pageLink.target = '_blank';
    pageLink.rel = 'noopener';

    _closeBtn = _el('button', undefined, '閉じる');
    _closeBtn.type = 'button';
    _closeBtn.id = 'glossary-popup-close';
    _closeBtn.addEventListener('click', () => close());
    bar.append(title, pageLink, _closeBtn);

    _search = _el('input', 'gl-search');
    _search.id = 'glossary-search';
    _search.type = 'search';
    _search.placeholder = '用語を検索（ひらがな可）';
    _search.autocomplete = 'off';
    _search.setAttribute('aria-label', '用語を検索');

    const kana = _el('nav', 'gl-kana');
    kana.id = 'glossary-kana';
    kana.setAttribute('aria-label', '五十音');
    head.append(bar, _search, kana);

    const list = _el('section', 'gl-list');
    list.id = 'glossary-popup-list';

    popup.append(head, list);
    _overlay.appendChild(popup);
    _ui = { list, search: _search, kana };

    _overlay.addEventListener('click', (e) => {
        if (e.target === _overlay) close();
    });
}

/**
 * ポップアップを開く。初回だけ md を取得して一覧を描く（失敗したら文言を出し、次に開いたとき取り直す）。
 * opener には閉じたときにフォーカスを戻す要素を渡す（本文＝#menu-toggle）。
 * open(opener?: HTMLElement | null): void
 */
export function open(opener?: HTMLElement | null): void {
    if (!_overlay || !_ui) return;
    const ui = _ui;
    _mounted ??= mountGlossary(ui).catch(() => {
        _mounted = null;   // 次に開いたとき取り直す
        ui.search.disabled = false;
    });
    _opener = opener ?? null;
    _overlay.hidden = false;
    _closeBtn?.focus();
}

/**
 * ポップアップを閉じ、開いた側へフォーカスを戻す。
 * close(): void
 */
export function close(): void {
    if (!_overlay) return;
    _overlay.hidden = true;
    _opener?.focus();
    _opener = null;
}

/**
 * ポップアップが開いているか（menu.ts の Escape 処理が優先順位を決めるのに使う）。
 * isOpen(): boolean
 */
export function isOpen(): boolean {
    return _overlay !== null && !_overlay.hidden;
}

/**
 * 検索欄にフォーカスがあり文字が入っているか。menu.ts の Escape 処理はこのときポップアップを閉じず、
 * ブラウザ標準の「Escape で欄をクリア」に任せる（2 回目の Escape で閉じる）。
 * isEditingSearch(): boolean
 */
export function isEditingSearch(): boolean {
    return _search !== null && document.activeElement === _search && _search.value !== '';
}
