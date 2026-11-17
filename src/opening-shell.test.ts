/*
 * opening-shell.test.ts
 * 本文シェル（templates/reader.html）の開幕アフォーダンス（#opening-affordance）の静的な約束を見る検査。
 * ブラウザは使わず、ファイルを読んで jsdom の DOMParser で解析するだけ（前例：head-contract.test.ts）。
 *
 * なぜ要るか：開幕のアイコン・名前・並びは Playwright（e2e/opening.spec.ts）でも見ているが、Playwright は CI に無い。
 * 読み上げに関わる約束だけは公開を止めるゲート（Vitest）に乗せる。見た目と動き（向き・揺れ・位置）は e2e の担当。
 *
 * 見るもの（要件 06-6・design/modules/opening.md）：
 *   U1 開幕の中の <svg> はすべて aria-hidden="true"（アイコンは飾り＝読み上げに出さない）
 *   U2 「もどる」「読み進める」の名前は aria-label が持ち、見える小さい文字（.opening-caption）があるならその文字と一致する
 *   U3 子の並びが 現在地ラベル → もどる → 読み進める
 *   U4 開幕の CSS（src/styles/_progress.css）の文字色は _palette.css の --ink から取る（中立色の値の直書きが無い。design/architecture.md）
 * 見ないもの：lirmena-draft/ のミラー（git 管理外で CI から参照できない）
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHELL = resolve(__dirname, '..', 'templates', 'reader.html');

// シェルを読んで #opening-affordance を返す（無ければ検査全体が意味を失うので、ここで落とす）
function affordance(): HTMLElement {
    const doc = new DOMParser().parseFromString(readFileSync(SHELL, 'utf-8'), 'text/html');
    const aff = doc.getElementById('opening-affordance');
    if (!aff) throw new Error('templates/reader.html に #opening-affordance が無い');
    return aff;
}

// 要件 06-6 のボタンの名前（読み上げでの呼び名）。仕様の値をここに置く（実装から拾わない）
const BUTTONS = [
    { id: 'opening-back', name: 'もどる' },
    { id: 'opening-start', name: '読み進める' },
] as const;

describe('開幕アフォーダンスの静的な約束（templates/reader.html）', () => {
    // U1：アイコンが読み上げに出ない（SVG を足したときに aria-hidden を付け忘れると落ちる）
    it('U1: 開幕の中の <svg> はすべて aria-hidden="true"', () => {
        const svgs = [...affordance().querySelectorAll('svg')];
        expect(svgs.length, 'アイコンが 1 つも無い（構造が変わった？）').toBeGreaterThan(0);
        for (const svg of svgs) expect(svg.getAttribute('aria-hidden')).toBe('true');
    });

    for (const { id, name } of BUTTONS) {
        // U2：名前が変わらない・見える文字を消しても名前が残る（名前の出どころが aria-label）
        it(`U2: #${id} の名前は aria-label="${name}"`, () => {
            const btn = affordance().querySelector<HTMLButtonElement>(`#${id}`);
            expect(btn, `#${id} が無い`).not.toBeNull();
            expect(btn!.tagName).toBe('BUTTON');
            expect(btn!.getAttribute('aria-label')).toBe(name);
        });

        // U2：見える文字と名前がずれない（WCAG 2.5.3「名前に見える文字を含む」）。文字は読み上げから外す（名前と二重に読まない）
        it(`U2: #${id} の小さい文字は（あるなら）名前と同じ語で、読み上げから外れている`, () => {
            const captions = [...affordance().querySelectorAll<HTMLElement>(`#${id} .opening-caption`)];
            // 文字なしへ移った後（.opening-caption を消した後）も、この検査は通る
            for (const c of captions) {
                expect(c.textContent?.trim()).toBe(name);
                expect(c.getAttribute('aria-hidden')).toBe('true');
            }
        });
    }

    // U3：要件 06-6 の並び（読み進める＝進行方向を末尾）。縦横とも DOM 順で決まり、CSS の order 分岐は持たない
    it('U3: 子の並びが 現在地ラベル → もどる → 読み進める', () => {
        const ids = [...affordance().children].map(el => el.id);
        expect(ids).toEqual(['opening-label', 'opening-back', 'opening-start']);
    });
});

// 開幕の CSS（_progress.css のうち #opening-* / .opening-* の規則）から、color の宣言を { セレクタ, 値 } で抜き出す。
// 入れ子の @media の中の規則も拾う（いちばん内側の { } を規則とみなす）。コメントは先に落とす
function openingColorDecls(): { selector: string; value: string }[] {
    const css = readFileSync(resolve(__dirname, 'styles', '_progress.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
    const out: { selector: string; value: string }[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim();
        if (!/#opening-|\.opening-/.test(selector)) continue;
        for (const d of m[2].matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)) out.push({ selector, value: d[1].trim() });
    }
    return out;
}

describe('開幕の文字色（src/styles/_progress.css）', () => {
    // U4：中立色の値は _palette.css だけが持つ（design/architecture.md）。開幕の文字色は --ink から取り、値を直書きしない。
    // 影（text-shadow・drop-shadow の黒）とフォーカスの枠は color の宣言ではないので対象外
    it('U4: 開幕の color はすべて var(--ink) から取り、16 進・rgb()・hsl() の直書きが無い', () => {
        const decls = openingColorDecls();
        expect(decls.length, '開幕の color 宣言が 1 つも無い（節の構造が変わった？）').toBeGreaterThan(0);
        for (const { selector, value } of decls) {
            expect(value, `${selector} の color`).toContain('var(--ink)');
            expect(value, `${selector} の color に色の値の直書きがある`).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
        }
    });
});
