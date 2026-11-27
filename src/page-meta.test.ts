/*
 * page-meta.test.ts
 * 生成ページ（本文・タイトル・あとがき）の <title> の文言と、雛形への差し込みの検査。
 */

import { describe, expect, it } from 'vitest';
import { afterwordPageTitle, episodePageTitle, escapeHtml, fillPageMeta, sectionPageTitle, WORK_TITLE } from './page-meta';
import { plainRuby } from './ruby';

const sec = (id: number, published: boolean) => ({ id, published });

describe('plainRuby', () => {
    it('ルビ記法を外して親文字だけにする（読みは落とす）', () => {
        expect(plainRuby('|翠昴晶《ペラティラ》さがし -前編-')).toBe('翠昴晶さがし -前編-');
    });
    it('ルビが無い文字列はそのまま', () => {
        expect(plainRuby('太陽の行く先')).toBe('太陽の行く先');
    });
    it('複数のルビを外す', () => {
        expect(plainRuby('|輝《かがや》くもの|達《たち》')).toBe('輝くもの達');
    });
});

describe('ページのタイトル', () => {
    const ep = { id: 2, title: '|翠昴晶《ペラティラ》さがし -前編-', sections: [sec(1, true), sec(2, true), sec(3, false)] };
    const unpublished = { id: 5, title: 'まだ見せない話名', sections: [sec(1, false), sec(2, false)] };

    it('本文：話数・節・話名（ルビは親文字だけ）を先頭に、作品名を後ろに置く', () => {
        expect(sectionPageTitle(ep, 3)).toBe('第2話 #3 翠昴晶さがし -前編-｜輝くもの《リルメナ》');
    });
    it('本文：話に公開済みの節が無いあいだは話名を入れない', () => {
        expect(sectionPageTitle(unpublished, 1)).toBe('第5話 #1｜輝くもの《リルメナ》');
    });
    it('本文：話に公開済みの節が 1 つでもあれば、未公開の節のページにも話名を入れる（話名は目次に出ている）', () => {
        expect(sectionPageTitle(ep, 3)).toContain('翠昴晶さがし');
    });
    it('タイトルページ：話数と話名', () => {
        expect(episodePageTitle(ep)).toBe('第2話 翠昴晶さがし -前編-｜輝くもの《リルメナ》');
    });
    it('タイトルページ：話に公開済みの節が無いあいだは話名を入れない', () => {
        expect(episodePageTitle(unpublished)).toBe('第5話｜輝くもの《リルメナ》');
    });
    it('話名が空のときは話名を入れない', () => {
        const blank = { id: 3, title: '', sections: [sec(1, true)] };
        expect(episodePageTitle(blank)).toBe('第3話｜輝くもの《リルメナ》');
        expect(sectionPageTitle(blank, 1)).toBe('第3話 #1｜輝くもの《リルメナ》');
    });
    it('あとがき：巻数', () => {
        expect(afterwordPageTitle(1)).toBe('第1巻 あとがき｜輝くもの《リルメナ》');
    });
    it('作品名は目次の <title> と同じ', () => {
        expect(WORK_TITLE).toBe('輝くもの《リルメナ》');
    });
});

describe('雛形への差し込み', () => {
    it('escapeHtml：& < > " を実体参照にする', () => {
        expect(escapeHtml('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; &quot;d&quot;');
    });
    it('fillPageMeta：{{pageTitle}} をエスケープして埋め、{{pageFile}} を埋める（全箇所）', () => {
        const tpl = '<meta content="{{pageTitle}}" /><meta content="x/{{pageFile}}" /><title>{{pageTitle}}</title>';
        expect(fillPageMeta(tpl, 'A & "B"｜C', '02-03.html'))
            .toBe('<meta content="A &amp; &quot;B&quot;｜C" /><meta content="x/02-03.html" /><title>A &amp; &quot;B&quot;｜C</title>');
    });
    it('fillPageMeta：話名に $ があっても置換の記法として解釈しない', () => {
        expect(fillPageMeta('<title>{{pageTitle}}</title>', "$& $1 $'", 'a.html')).toBe("<title>$&amp; $1 $'</title>");
    });
});
