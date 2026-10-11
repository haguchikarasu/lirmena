/*
 * glossary.test.ts
 * glossary.ts の純関数（parseGlossary / splitRefs / validateGlossary）の仕様駆動テストと、実ファイルの検査。
 *
 * 網羅する観点：
 *   - 実データ（public/glossary.md）が validateGlossary を満たす＝**CI で公開を止める唯一の関門**
 *     （md は執筆側で編集されサイトへコピーされる。書式違反や参照切れはここでしか気づけない）
 *   - md の書式（行見出し・タイトル・言語行・段落・表・番号付きリスト・参照のみの項目・CRLF）
 *   - → の区切り（最長一致・空白の読み飛ばし・一致しない → は地の文）
 *   - 検査の各規則（重複・参照切れ・行見出しより前・行見出しの重複と順序・タイトルの重複と途中出現・空の項目）
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGlossary, splitRefs, validateGlossary } from './glossary';

const GLOSSARY_MD_PATH = resolve(__dirname, '../public/glossary.md');

describe('実データ', () => {
    it('public/glossary.md が書式の検査を満たす', () => {
        const g = parseGlossary(readFileSync(GLOSSARY_MD_PATH, 'utf-8'));
        expect(validateGlossary(g)).toEqual([]);
        expect(g.entries.length).toBeGreaterThan(0);
    });
});

describe('parseGlossary', () => {
    it('行見出し・言語行・段落・参照のみの項目を読み分ける', () => {
        const g = parseGlossary([
            '# 用語集',
            '# あ',
            '## エシュカ',
            '【フェルブ語: eshka】',
            '【エンリス語: eshkar¹】',
            '',
            '自由都市。',
            '',
            '二段落目。',
            '# か',
            '## 輝くもの',
            '→エシュカ',
        ].join('\n'));
        expect(g.issues).toEqual([]);
        expect(g.entries).toEqual([
            {
                term: 'エシュカ', id: 'g-エシュカ', row: 'あ',
                langs: [{ lang: 'フェルブ語', word: 'eshka' }, { lang: 'エンリス語', word: 'eshkar¹' }],
                blocks: [{ type: 'p', text: '自由都市。' }, { type: 'p', text: '二段落目。' }],
                alias: null,
            },
            { term: '輝くもの', id: 'g-輝くもの', row: 'か', langs: [], blocks: [], alias: 'エシュカ' },
        ]);
    });

    it('表（区切り行を捨てる）と番号付きリストを読む。段落の途中に挟まっても切れる', () => {
        const g = parseGlossary([
            '# あ',
            '## 時法',
            '| 時間帯 | 名称 |',
            '|---|---|',
            '| 正子〜日の出 | 水 |',
            '傾向があり、',
            '1. 外部',
            '2. 内部',
            'のいずれか。',
        ].join('\n'));
        expect(g.entries[0].blocks).toEqual([
            { type: 'table', rows: [['時間帯', '名称'], ['正子〜日の出', '水']] },
            { type: 'p', text: '傾向があり、' },
            { type: 'ol', items: ['外部', '内部'] },
            { type: 'p', text: 'のいずれか。' },
        ]);
    });

    it('CRLF と見出し直後の空行を受け付ける', () => {
        const g = parseGlossary('# あ\r\n## 運動式\r\n\r\n筋力を強化する。\r\n');
        expect(g.entries[0].blocks).toEqual([{ type: 'p', text: '筋力を強化する。' }]);
    });

    it('本文の途中の【】は言語行ではなく本文として扱う', () => {
        const g = parseGlossary('# あ\n## 語\n本文。\n【注: x】');
        expect(g.entries[0].langs).toEqual([]);
        expect(g.entries[0].blocks).toEqual([{ type: 'p', text: '本文。【注: x】' }]);
    });
});

describe('splitRefs', () => {
    const terms = ['リルメナ', 'リルメナの干渉', 'デルクナ'];

    it('最も長く前方一致する見出し語をリンクにする', () => {
        expect(splitRefs('→リルメナの干渉', terms)).toEqual([{ type: 'ref', term: 'リルメナの干渉' }]);
    });

    it('文中の参照を地の文と分け、→ の直後の空白を読み飛ばす', () => {
        expect(splitRefs('治安が悪い。→ デルクナ', terms)).toEqual([
            { type: 'text', text: '治安が悪い。' },
            { type: 'ref', term: 'デルクナ' },
        ]);
    });

    it('一致しない → は地の文に残す', () => {
        expect(splitRefs('天→地', terms)).toEqual([{ type: 'text', text: '天→地' }]);
    });
});

describe('validateGlossary', () => {
    const errorsOf = (md: string): string[] => validateGlossary(parseGlossary(md));

    it('正しい md は違反なし（参照のみの項目は「空」ではない）', () => {
        expect(errorsOf('# 用語集\n# あ\n## 光輝\n→リルム\n# ら\n## リルム\n力。')).toEqual([]);
    });

    it('見出し語の重複', () => {
        expect(errorsOf('# あ\n## 語\nA。\n## 語\nB。')).toEqual(['見出し語「語」が重複している']);
    });

    it('参照切れ（参照のみの項目・本文中の参照）', () => {
        expect(errorsOf('# あ\n## 蛮獣人\n→バルヌム人\n## 語\n本文。→無い語')).toEqual([
            '「蛮獣人」の「→バルヌム人」に一致する見出し語が無い',
            '「語」の「→無い語」に一致する見出し語が無い',
        ]);
    });

    it('行見出しより前の項目', () => {
        expect(errorsOf('## 語\n本文。')).toEqual(['1 行目：「語」が五十音の行見出し（# あ など）より前にある']);
    });

    it('行見出しの重複と順序違反（飛ばすのは可）', () => {
        expect(errorsOf('# あ\n## a\nA。\n# さ\n## b\nB。')).toEqual([]);
        expect(errorsOf('# か\n## a\nA。\n# か\n## b\nB。')).toEqual(['4 行目：行見出し「# か」が重複している']);
        expect(errorsOf('# か\n## a\nA。\n# あ\n## b\nB。')).toEqual(['4 行目：行見出し「# あ」が「# か」より後ろにある（あ→わ の順）']);
    });

    it('タイトルは最初の行見出しより前に 1 回だけ', () => {
        expect(errorsOf('# あ\n## a\nA。')).toEqual([]);   // 欠落は可
        expect(errorsOf('# 用語集\n# 用語集\n# あ\n## a\nA。')).toEqual(['2 行目：タイトル「# 用語集」が 2 回目']);
        expect(errorsOf('# あ\n## a\nA。\n# 付記')).toEqual(['4 行目：「# 付記」は五十音の行名ではない（タイトルは最初の行見出しより前に 1 回だけ）']);
    });

    it('本文も参照先も無い項目', () => {
        expect(errorsOf('# あ\n## 語\n\n## 次\n本文。')).toEqual(['「語」に本文も参照先も無い']);
    });

    it('引数を破壊しない', () => {
        const g = parseGlossary('# あ\n## 語\n→無い');
        const before = JSON.stringify(g);
        validateGlossary(g);
        expect(JSON.stringify(g)).toBe(before);
    });
});
