/*
 * map-svg.test.ts — 地図の SVG（public/img/eshka-map.svg）とサイトの CSS の「値の写し」が一致しているかを見る。
 * SVG は別リポジトリの生成物（執筆/地図/source/render_map.py --svg）で、別タブで単体で開かれてもその stage の色で
 * 出るよう、色相と紙・墨を自分の中に持っている（ページの CSS 変数が届かないため）。写しの元は：
 *   色相 146／185／280／0／55 … _base.css と toc.css の --stage-N-hue（この 2 本どうしの一致もここで見る）
 *   紙 #eeedea・墨 #16171a  … _palette.css の [data-paper="light"] の --surface・--ink
 * 片方だけ直して SVG を描き直し忘れたときに落ちる（design/architecture.md「複製の残り」）。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8');

// CSS の中の --stage-N-hue（N = 1〜5）を拾う
function stageHues(css: string): number[] {
    return [1, 2, 3, 4, 5].map((n) => {
        const m = css.match(new RegExp(`--stage-${n}-hue:\\s*(\\d+)`));
        if (!m) throw new Error(`--stage-${n}-hue が見つからない`);
        return Number(m[1]);
    });
}

describe('地図の SVG とサイトの CSS の写し', () => {
    const svg = read('../public/img/eshka-map.svg');
    const style = svg.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

    it('SVG の中の色相が _base.css・toc.css の stage の色相と一致する', () => {
        const base = stageHues(read('./styles/_base.css'));
        expect(stageHues(read('./styles/toc.css'))).toEqual(base);
        // stage 1 は既定値（svg#eshka-map{… --h:146 …}）、2〜5 は :root[data-story-stage="N"] の規則
        const first = style.match(/svg#eshka-map\{[^}]*--h:(\d+)/);
        const rest = [2, 3, 4, 5].map((n) => {
            const m = style.match(new RegExp(`data-story-stage="${n}"\\][^{]*\\{--h:(\\d+)`));
            return m ? Number(m[1]) : NaN;
        });
        expect([Number(first?.[1]), ...rest]).toEqual(base);
    });

    it('別タブの受け口 #s0〜#s5 が SVG にあり、stage の規則が #sN:target も受ける', () => {
        for (let n = 0; n <= 5; n++) expect(svg).toContain(`<g id="s${n}"/>`);
        for (const n of [0, 2, 3, 4, 5]) expect(style).toContain(`:has(#s${n}:target)`);
    });

    it('SVG の紙・墨が _palette.css のライトの紙面と一致する', () => {
        const palette = read('./styles/_palette.css');
        const light = palette.match(/\[data-paper="light"\]\s*\{([^}]*)\}/)?.[1] ?? '';
        const pick = (src: string, name: string): string | undefined =>
            src.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1].toLowerCase();
        expect(pick(style, '--m-paper')).toBe(pick(light, '--surface'));
        expect(pick(style, '--m-ink')).toBe(pick(light, '--ink'));
    });

    it('生成の後処理が取りこぼしていない（色は CSS 変数だけ・id の参照が全部つながる）', () => {
        const body = svg.replace(/<style>[\s\S]*?<\/style>/, '');
        // 表示属性の var() は効かない（黒で描かれる）＝style 属性へ移っていること
        expect(body).not.toMatch(/\s(fill|stroke)="var\(/);
        // 直書きの色が <style> の外に無い＝PNG 用の色がサイトに漏れていない
        expect(body).not.toMatch(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![0-9a-z-])/i);
        const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
        const refs = [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2]);
        expect(refs.length).toBeGreaterThan(0);
        for (const r of refs) expect(ids).toContain(r);
    });

    it('出来事（未公開話のネタバレになりうる）が載っていない', () => {
        // render_map.py は出来事を「N話 名前」の字と色 #a8475a で描く。SVG はその両方を持たない
        expect(svg).not.toMatch(/#a8475a/i);
        expect(svg).not.toMatch(/>\d+話 /);
    });

    it('CSS は地図のルートの中に閉じている（ページに埋めても外へ漏れない）', () => {
        // 規則のセレクタはすべて svg#eshka-map を含む
        const selectors = style.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
        for (const sel of selectors) {
            for (const part of sel.split(',')) expect(part).toContain('svg#eshka-map');
        }
    });
});
