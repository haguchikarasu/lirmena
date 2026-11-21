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
});
