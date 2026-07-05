/*
 * feedback.test.ts
 * feedback.ts の仕様駆動テスト。IF: init(): void / MARSHMALLOW_URL: string
 * 期待値は IF コメントの仕様（Ｘ text=`✨輝くもの《リルメナ》✨第{ep}話 #{sec}\nURL` の改行区切り一本化・
 * url パラメータは使わない、マシュマロは MARSHMALLOW_URL 定数がそのまま href、
 * hidden 管理は wrapper #btn-share-group に一本化・内部 <a> の hidden は触らない、
 * 対象要素が無ければ個別 no-op）から導出する（実装をなぞらない）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as state from './state';
import { init, MARSHMALLOW_URL } from './feedback';

describe('feedback.init', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('要素が何も無くても例外を投げない（title.html のように何も置かないページで安全）', () => {
        vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 1, sec: 1, scene: 0 });
        expect(() => init()).not.toThrow();
    });

    it('MARSHMALLOW_URL は marshmallow-qa.com の URL（作品全体で1箱）', () => {
        expect(MARSHMALLOW_URL).toMatch(/^https:\/\/marshmallow-qa\.com\//);
    });

    describe('#btn-share-x（href 注入）', () => {
        it('ep=1/sec=1：text は「第1話 #1\\nURL」の改行区切り・url パラメータは無い', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 1, sec: 1, scene: 0 });
            document.body.innerHTML = '<a id="btn-share-x"></a>';

            init();

            const btn = document.querySelector<HTMLAnchorElement>('#btn-share-x')!;
            expect(btn.href).toContain('https://x.com/intent/tweet?');
            const params = new URLSearchParams(btn.href.split('?')[1]);
            const expectedUrl = location.origin + location.pathname;
            expect(params.get('text')).toBe(`✨輝くもの《リルメナ》✨第1話 #1\n${expectedUrl}`);
            expect(params.get('url')).toBeNull(); // url パラメータは使わず text に統合
        });

        it('ep=2/sec=3：text に ep/sec 番号がそのまま入る（zero-pad しない）', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 2, sec: 3, scene: 0 });
            document.body.innerHTML = '<a id="btn-share-x"></a>';

            init();

            const btn = document.querySelector<HTMLAnchorElement>('#btn-share-x')!;
            const params = new URLSearchParams(btn.href.split('?')[1]);
            expect(params.get('text')).toContain('✨輝くもの《リルメナ》✨第2話 #3\n');
        });

        it('ep=12/sec=34：2桁 ep/sec でも同じ組み立て', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 12, sec: 34, scene: 0 });
            document.body.innerHTML = '<a id="btn-share-x"></a>';

            init();

            const btn = document.querySelector<HTMLAnchorElement>('#btn-share-x')!;
            const params = new URLSearchParams(btn.href.split('?')[1]);
            expect(params.get('text')).toContain('✨輝くもの《リルメナ》✨第12話 #34\n');
        });

        it('改行文字（\\n）が %0A としてエンコードされる（X 投稿画面で改行になる）', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 2, sec: 3, scene: 0 });
            document.body.innerHTML = '<a id="btn-share-x"></a>';

            init();

            const btn = document.querySelector<HTMLAnchorElement>('#btn-share-x')!;
            expect(btn.href).toContain('%0A'); // \n の percent encoding
        });

        it('# と ✨ が URL エンコードされている（生の # がクエリ境界にならないこと）', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 2, sec: 3, scene: 0 });
            document.body.innerHTML = '<a id="btn-share-x"></a>';

            init();

            const btn = document.querySelector<HTMLAnchorElement>('#btn-share-x')!;
            const query = btn.href.split('?')[1];
            expect(query).not.toContain('#');
            expect(query).toContain('%23'); // # の percent encoding
            expect(query).toContain('%E2%9C%A8'); // ✨ の percent encoding (U+2728)
        });
    });

    describe('#btn-share-marshmallow（href 注入）', () => {
        it('href に MARSHMALLOW_URL がそのまま設定される', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 1, sec: 1, scene: 0 });
            document.body.innerHTML = '<a id="btn-share-marshmallow"></a>';

            init();

            const btn = document.querySelector<HTMLAnchorElement>('#btn-share-marshmallow')!;
            expect(btn.href).toBe(MARSHMALLOW_URL);
        });

        it('マシュマロは ep/sec に依存しない（state.getCurrent の値と無関係に同じ URL）', () => {
            document.body.innerHTML = '<a id="btn-share-marshmallow"></a>';
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 99, sec: 88, scene: 0 });

            init();

            const btn = document.querySelector<HTMLAnchorElement>('#btn-share-marshmallow')!;
            expect(btn.href).toBe(MARSHMALLOW_URL);
        });
    });

    describe('#btn-share-group（wrapper hidden 制御）', () => {
        it('wrapper があれば hidden が外れて感想窓口ブロックが表示される', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 1, sec: 1, scene: 0 });
            document.body.innerHTML = `
                <div id="btn-share-group" hidden>
                    <a id="btn-share-x"></a>
                    <a id="btn-share-marshmallow"></a>
                </div>
            `;

            init();

            const group = document.querySelector<HTMLElement>('#btn-share-group')!;
            expect(group.hidden).toBe(false);
        });

        it('wrapper が無ければ hidden 操作は no-op（例外を投げない）', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 1, sec: 1, scene: 0 });
            document.body.innerHTML = '';

            expect(() => init()).not.toThrow();
        });

        it('内部 <a> の hidden は触らない（wrapper 側で一元管理する契約）', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 1, sec: 1, scene: 0 });
            // 内部 <a> に hidden 属性を初期値として持たせても、feedback は解除しない
            document.body.innerHTML = `
                <div id="btn-share-group" hidden>
                    <a id="btn-share-x" hidden></a>
                    <a id="btn-share-marshmallow" hidden></a>
                </div>
            `;

            init();

            const x = document.querySelector<HTMLAnchorElement>('#btn-share-x')!;
            const m = document.querySelector<HTMLAnchorElement>('#btn-share-marshmallow')!;
            expect(x.hidden).toBe(true); // feedback は触らない（wrapper 側で見せる契約）
            expect(m.hidden).toBe(true);
        });
    });

    describe('個別 no-op', () => {
        it('#btn-share-x のみあれば X だけ href 注入、他は無処理', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 1, sec: 1, scene: 0 });
            document.body.innerHTML = '<a id="btn-share-x"></a>';

            expect(() => init()).not.toThrow();
            const x = document.querySelector<HTMLAnchorElement>('#btn-share-x')!;
            expect(x.href).toContain('https://x.com/intent/tweet?');
        });

        it('#btn-share-marshmallow のみあればマシュマロだけ href 注入、他は無処理', () => {
            vi.spyOn(state, 'getCurrent').mockReturnValue({ ep: 1, sec: 1, scene: 0 });
            document.body.innerHTML = '<a id="btn-share-marshmallow"></a>';

            expect(() => init()).not.toThrow();
            const m = document.querySelector<HTMLAnchorElement>('#btn-share-marshmallow')!;
            expect(m.href).toBe(MARSHMALLOW_URL);
        });
    });
});
