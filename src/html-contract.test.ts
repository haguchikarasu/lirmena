/*
 * html-contract.test.ts
 * 全シェル（ページの雛形 HTML）と断片（templates/parts/*.html）が守る書き方の静的検査。
 * ブラウザも DOM も使わず、ファイルを読んで文字列を調べるだけ（前例：head-contract.test.ts）。
 *
 * なぜ要るか：tsc / depcruise / ESLint は HTML を見ない。Playwright は挙動を見るが、書き方（属性の有無）は見ない。
 *
 * 見るもの：
 *   - インラインのイベントハンドラ属性（onerror・onclick など）が無い。処理は addEventListener で登録する
 *     （design/architecture.md「HTML の書き方」）
 *   - title 属性が無い（吹き出しはキーボードで出せない。名前は aria-label か見える文字で付ける）
 *   - role="tab" の要素に aria-controls が無い（読み上げソフトが使わない。タブと中身の対応は aria-labelledby で付ける）
 *   - 正の tabindex が無い（Tab は DOM の順に動かす。要件 08）
 *   - <nav> には名前がある（aria-label か aria-labelledby）。本文シェルと断片で <nav> にしてよいのは、ページを移る
 *     導線を持つ所だけ（ボタンを並べただけの所を「ナビゲーション」と読み上げさせない）
 *   - 本文シェル：開幕の「もどる」「読み進める」が <main> より前にある（開幕で最初の Tab が止まる先）、
 *     「読み込み中」に role を付けない（一時的な表示を読み上げさせない）
 *   - CSS：user-select の宣言の直前に、同じ値の -webkit-user-select がある（Safari は接頭辞つきしか読まない）
 *   - CSS：用語集（_glossary.css）の :focus-visible の規則で輪郭線を消さない。タイトルページのボタンのホバーは
 *     無効なボタンに当たらない（:hover:not(:disabled)）
 * 見ないもの：lirmena-draft/ のミラー（git 管理外で CI から参照できない）、pages() が生成する contents/（雛形から作る）
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** 検査する HTML：ルート直下のシェル・templates/ の雛形・templates/parts/ の断片 */
function htmlFiles(): string[] {
    const list = (dir: string): string[] =>
        readdirSync(resolve(ROOT, dir)).filter(f => f.endsWith('.html')).map(f => join(dir, f).replace(/\\/g, '/'));
    return [...list('.'), ...list('templates'), ...list('templates/parts')];
}

/** 検査する CSS：src/styles/ の全ファイル */
function cssFiles(): string[] {
    return readdirSync(resolve(ROOT, 'src/styles')).filter(f => f.endsWith('.css')).map(f => `src/styles/${f}`);
}

const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

/** タグだけを見るために、コメントと <script>・<style> の中身を取り除く（説明文やコードに属性名が現れる） */
function stripNonMarkup(html: string): string {
    return html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '<script></script>')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '<style></style>');
}

/** 開始タグの中にある on* 属性を「タグ名 属性名」で返す */
function inlineHandlers(html: string): string[] {
    const found: string[] = [];
    for (const tag of stripNonMarkup(html).match(/<[a-zA-Z][^>]*>/g) ?? []) {
        const name = /^<([a-zA-Z][\w-]*)/.exec(tag)?.[1] ?? '';
        for (const m of tag.matchAll(/\s(on[a-z]+)\s*=/g)) found.push(`${name} ${m[1]}`);
    }
    return found;
}

/** 開始タグのうち、条件に合うものを「タグ名#id」で返す */
function tagsWhere(html: string, pred: (tag: string) => boolean): string[] {
    return (stripNonMarkup(html).match(/<[a-zA-Z][^>]*>/g) ?? []).filter(pred)
        .map(tag => `${/^<([a-zA-Z][\w-]*)/.exec(tag)?.[1] ?? ''}#${/\sid="([^"]*)"/.exec(tag)?.[1] ?? ''}`);
}

/** 開始タグを順に返す（コメントと script・style の中身は除く） */
const openTags = (html: string): string[] => stripNonMarkup(html).match(/<[a-zA-Z][^>]*>/g) ?? [];

/** 開始タグの id（無ければ undefined） */
const idOf = (tag: string): string | undefined => /\sid="([^"]*)"/.exec(tag)?.[1];

/** role を上書きしていない <nav>（＝ナビゲーションとして読み上げられるもの）の開始タグ */
const navTags = (html: string): string[] => openTags(html).filter(tag => /^<nav[\s>]/.test(tag) && !/\srole\s*=/.test(tag));

/** user-select の宣言のうち、直前の宣言が同じ値の -webkit-user-select でないものを「値」で返す */
function unprefixedUserSelect(css: string): string[] {
    const decls = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{\s])(-webkit-user-select|user-select)\s*:\s*([^;}]+)/g)]
        .map(m => ({ prop: m[1], value: m[2].trim() }));
    return decls.filter((d, i) => d.prop === 'user-select'
        && !(decls[i - 1]?.prop === '-webkit-user-select' && decls[i - 1].value === d.value)).map(d => d.value);
}

describe('HTML の書き方の契約（全シェル・全断片）', () => {
    const files = htmlFiles();

    it('検査の対象に 6 シェルと断片が入っている', () => {
        expect(files).toEqual(expect.arrayContaining([
            'index.html', 'characters.html', 'map.html', 'glossary.html',
            'templates/reader.html', 'templates/title.html', 'templates/parts/settings.html',
        ]));
    });

    it('検出器が on* 属性を拾い、コメントと script の中身は拾わない', () => {
        const sample = '<!-- onerror="x" --><img id="a" onerror="this.hidden=true" /><script>el.onerror = f; var s = \'<a onclick="x">\';</script>';
        expect(inlineHandlers(sample)).toEqual(['img onerror']);
    });

    it.each(files)('%s にインラインのイベントハンドラ属性が無い', (file) => {
        expect(inlineHandlers(read(file))).toEqual([]);
    });

    it.each(files)('%s に title 属性が無い', (file) => {
        expect(tagsWhere(read(file), tag => /\stitle\s*=/.test(tag))).toEqual([]);
    });

    it.each(files)('%s のタブ（role="tab"）に aria-controls が無い', (file) => {
        expect(tagsWhere(read(file), tag => /\srole="tab"/.test(tag) && /\saria-controls\s*=/.test(tag))).toEqual([]);
    });

    it.each(files)('%s に正の tabindex が無い', (file) => {
        expect(tagsWhere(read(file), tag => /\stabindex="[1-9]\d*"/.test(tag))).toEqual([]);
    });

    it.each(files)('%s の <nav> には名前がある', (file) => {
        expect(navTags(read(file)).filter(tag => !/\saria-label(ledby)?="[^"]+"/.test(tag))).toEqual([]);
    });

    it('本文シェルで <nav> にするのは、本文末の進む導線とメニューだけ', () => {
        expect(navTags(read('templates/reader.html')).map(tag => idOf(tag) ?? tag)).toEqual(['btn-container-end', 'menu-container']);
    });

    it.each(['settings', 'share', 'confirm', 'world'])('シートの断片 %s.html に <nav>（ナビゲーション）が無い', (name) => {
        expect(navTags(read(`templates/parts/${name}.html`))).toEqual([]);
    });

    it('本文シェル：開幕の「もどる」「読み進める」が <main> より前にある', () => {
        const ids = openTags(read('templates/reader.html')).map(idOf);
        expect(ids.indexOf('opening-back')).toBeGreaterThan(-1);
        expect(ids.indexOf('opening-back')).toBeLessThan(ids.indexOf('opening-start'));
        expect(ids.indexOf('opening-start')).toBeLessThan(ids.indexOf('main-container'));
    });

    it('本文シェル：「読み込み中」に role を付けない', () => {
        const tag = openTags(read('templates/reader.html')).find(t => idOf(t) === 'loading');
        expect(tag).toBeDefined();
        expect(tag).not.toMatch(/\srole\s*=/);
    });
});

describe('HTML の書き方の契約：名前・見出し・読み上げ', () => {
    it('タイトルページの話名は <h1>（<p> ではない）', () => {
        const tags = openTags(read('templates/title.html'));
        expect(tags.some(t => /^<h1[\s>]/.test(t) && idOf(t) === 'title-screen-ep-title')).toBe(true);
        expect(tags.some(t => /^<p[\s>]/.test(t) && idOf(t) === 'title-screen-ep-title')).toBe(false);
    });

    it('目次の「読み込み中」に role を付けない', () => {
        const tag = openTags(read('index.html')).find(t => idOf(t) === 'idx-hero-loading');
        expect(tag).toBeDefined();
        expect(tag).not.toMatch(/\srole\s*=/);
    });

    it('資料ページの「もどる」の名前は、見えている文字（#wp-mark）を含む', () => {
        const html = read('templates/parts/world-nav.html');
        const back = openTags(html).find(t => idOf(t) === 'wp-back') ?? '';
        const label = /\saria-label="([^"]*)"/.exec(back)?.[1] ?? '';
        const mark = /<span id="wp-mark"[^>]*>([^<]*)<\/span>/.exec(html)?.[1] ?? '';
        expect(mark).not.toBe('');
        expect(label).toContain(mark);
    });
});

/** 指定セレクタ（カンマ区切りの 1 つと完全一致）の規則の中にある content 宣言の値を返す */
function contentOf(css: string, selector: string): string[] {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: string[] = [];
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!m[1].split(',').some(sel => sel.trim() === selector)) continue;
        const c = /(?:^|[;\s])content\s*:\s*([^;}]+)/.exec(m[2])?.[1];
        if (c) out.push(c.trim());
    }
    return out;
}

describe('CSS の書き方の契約（src/styles）：読み上げ', () => {
    it.each([
        ['src/styles/_misc.css', '.hold-body li::before'],
        ['src/styles/toc-page.css', 'a.cl-ep-link::after'],
        ['src/styles/toc-page.css', '#idx-links a::after'],
        ['src/styles/_map.css', '.mv-open::after'],
    ])('%s の %s は、飾りの文字を読み上げから外す（content: "…" / ""）', (file, selector) => {
        const found = contentOf(read(file), selector);
        expect(found.length).toBeGreaterThan(0);
        for (const c of found) expect(c).toMatch(/\/\s*(""|'')$/);
    });

    it.each(cssFiles())('%s に負の order が無い（見た目だけ入れ替えると、Tab と読み上げの順と食い違う）', (file) => {
        expect(read(file).replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\border\s*:\s*-\d/);
    });
});

describe('CSS の書き方の契約（src/styles）', () => {
    it('検出器が、接頭辞つきが無い・値が違う user-select を拾う', () => {
        expect(unprefixedUserSelect('a{-webkit-user-select:none;user-select:none}')).toEqual([]);
        expect(unprefixedUserSelect('a{user-select: none;} b{-webkit-user-select:none; user-select:text}')).toEqual(['none', 'text']);
        expect(unprefixedUserSelect('/* user-select: none */ a{color:red}')).toEqual([]);
    });

    it.each(cssFiles())('%s の user-select には同じ値の -webkit-user-select が並んでいる', (file) => {
        expect(unprefixedUserSelect(read(file))).toEqual([]);
    });
});

/** 規則を { セレクタの並び, 宣言 } で返す（コメントは除く。@media の中の規則も 1 段だけ拾う） */
function rulesOf(css: string): { selectors: string[]; body: string }[] {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(m => ({ selectors: m[1].split(',').map(s => s.trim()), body: m[2] }));
}

describe('CSS の書き方の契約（src/styles）：フォーカスとホバー', () => {
    it('検出器が、:focus-visible の規則の outline: none を拾う', () => {
        const css = 'a:hover, a:focus-visible { outline: none } b:focus-visible { outline: 2px solid red } c { outline: none }';
        const found = rulesOf(css).filter(r => r.selectors.some(s => s.includes(':focus-visible')) && /outline\s*:\s*none/.test(r.body));
        expect(found.map(r => r.selectors[0])).toEqual(['a:hover']);
    });

    // 用語集（R2-08）：枠や下線の色の変化だけでは、フォーカスの位置が見えにくい。輪郭線で示す
    it('_glossary.css の :focus-visible の規則に outline: none が無い', () => {
        const bad = rulesOf(read('src/styles/_glossary.css'))
            .filter(r => r.selectors.some(s => s.includes(':focus-visible')) && /(?:^|[;\s])outline\s*:\s*none/.test(r.body));
        expect(bad.map(r => r.selectors.join(', '))).toEqual([]);
    });

    // タイトルページ（R2-15）：無効なボタンにマウスを乗せても、押せそうな見た目（地が濃くなる）にしない
    it('_title.css の「本文を読む」「前の話へ」のホバーは、無効なボタンに当たらない', () => {
        const hovers = rulesOf(read('src/styles/_title.css'))
            .flatMap(r => r.selectors)
            .filter(s => /#btn-title-(enter|prev):hover/.test(s));
        expect(hovers.length).toBeGreaterThan(0);
        for (const s of hovers) expect(s).toMatch(/:hover:not\(:disabled\)/);
    });
});
