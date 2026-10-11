/*
 * head-contract.test.ts
 * 全シェル（ページの雛形 HTML）の <head> に複製されている「同じでなければならない部品」の一致を見る静的検査。
 * ブラウザも DOM も使わず、ファイルを読んで文字列比較するだけ（前例：エディタ/server/src-sync.test.ts）。
 *
 * なぜ要るか：tsc / depcruise / 他の Vitest / Playwright / ESLint のどれも <head> を見ない。GA の判定を 1 シェルだけ
 * 直し忘れると、そのページ種別だけ作者のアクセスが計測され続け、検査は全部緑のまま通る（design/architecture.md）。
 *
 * 見るもの：
 *   - head-contract:<名前>:start / :end のマーカーで囲んだ 4 ブロック（meta / fouc / early / ga）が全シェルでバイト同一
 *   - <link rel="manifest"> と <link rel="apple-touch-icon"> のタグが 1 本ずつあり、href の深さがページの置き場所と合う
 *   - SHELLS の一覧が実在するシェル HTML と一致する（新しいシェルを足して登録し忘れたら落ちる）
 *   - public/*.webmanifest の id と start_url が一致し、scope がその接頭辞
 *   - 旧フラグ名 noga がソースに残っていない
 * 見ないもの：lirmena-draft/ のミラー（git 管理外で CI から参照できない。draft の同期は tool/sync-draft）
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** シェル HTML と、そのページが置かれる深さ（root＝/lirmena/ 直下、sub＝contents/ 配下に生成される雛形） */
const SHELLS: { path: string; depth: 'root' | 'sub' }[] = [
    { path: 'index.html', depth: 'root' },
    { path: 'glossary.html', depth: 'root' },
    { path: 'templates/reader.html', depth: 'sub' },
    { path: 'templates/title.html', depth: 'sub' },
];

const BLOCKS = ['meta', 'fouc', 'early', 'ga'] as const;

const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

/** マーカーで囲まれた範囲（マーカー行自体は含めない）を返す。マーカーがちょうど 1 組でなければ null */
function extractBlock(html: string, name: string): string | null {
    const start = `<!-- head-contract:${name}:start -->`;
    const end = `<!-- head-contract:${name}:end -->`;
    if (html.split(start).length !== 2 || html.split(end).length !== 2) return null;
    const from = html.indexOf(start) + start.length;
    const to = html.indexOf(end);
    return to > from ? html.slice(from, to) : null;
}

/** タグとして数えるために、コメントと <script> の中身を取り除く（どちらにも rel="manifest" の文字列が現れる） */
function stripCommentsAndScripts(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
}

function linkHrefs(html: string, rel: string): string[] {
    const tags = stripCommentsAndScripts(html).match(new RegExp(`<link\\b[^>]*\\brel="${rel}"[^>]*>`, 'g')) ?? [];
    return tags.map(t => /\bhref="([^"]*)"/.exec(t)?.[1] ?? '');
}

describe('<head> の契約（全シェル）', () => {
    it('SHELLS が実在するシェル HTML と一致する', () => {
        const rootHtml = readdirSync(ROOT).filter(f => f.endsWith('.html'));
        const templates = readdirSync(resolve(ROOT, 'templates')).filter(f => f.endsWith('.html')).map(f => `templates/${f}`);
        expect([...rootHtml, ...templates].sort()).toEqual(SHELLS.map(s => s.path).sort());
    });

    for (const name of BLOCKS) {
        it(`${name} ブロックが全シェルでバイト同一`, () => {
            const blocks = SHELLS.map(s => ({ path: s.path, block: extractBlock(read(s.path), name) }));
            for (const b of blocks) expect(b.block, `${b.path} に head-contract:${name} のマーカーが 1 組ない`).not.toBeNull();
            const [first, ...rest] = blocks;
            for (const b of rest) expect(b.block, `${b.path} の ${name} ブロックが ${first.path} と違う`).toBe(first.block);
        });
    }

    for (const shell of SHELLS) {
        it(`${shell.path}：manifest と apple-touch-icon が 1 本ずつ・深さが合う`, () => {
            const html = read(shell.path);
            const prefix = shell.depth === 'root' ? '' : '../';
            expect(linkHrefs(html, 'manifest')).toEqual([`${prefix}app.webmanifest`]);
            expect(linkHrefs(html, 'apple-touch-icon')).toEqual([`${prefix}vol01/favicon1.png`]);
        });
    }
});

describe('webmanifest', () => {
    for (const file of ['public/app.webmanifest', 'public/dev.webmanifest']) {
        it(`${file}：id と start_url が一致し、scope がその接頭辞`, () => {
            const m = JSON.parse(read(file)) as { id: string; start_url: string; scope: string };
            expect(m.id).toBe(m.start_url);
            expect(m.start_url.startsWith(m.scope)).toBe(true);
        });
    }
});

describe('旧フラグ名', () => {
    it('noga がソースに残っていない', () => {
        // *.test.ts は除く（この検査自身が検索語を持つ）。public/changelog/ は履歴として残っているので範囲外
        const srcFiles = readdirSync(resolve(ROOT, 'src'), { recursive: true, encoding: 'utf-8' })
            .map(f => join('src', f))
            .filter(f => /\.(ts|css)$/.test(f) && !f.endsWith('.test.ts'));
        const targets = [...srcFiles, ...SHELLS.map(s => s.path)];
        const hits = targets.filter(f => read(f).includes('noga')).map(f => relative('.', f));
        expect(hits).toEqual([]);
    });
});
