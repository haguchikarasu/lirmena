/*
 * story-integrity.test.ts
 * story-integrity.ts の仕様駆動テスト。
 * IF: validateStory(story: StoryData): string[]     — 純データ検査 (a)〜(h)
 *     validateStoryFiles(story, opts): string[]    — (i) を含む合成版（fs 実在検査を注入）
 *
 * 網羅する観点：
 *   - 実データ（public/story.json）が全整合ルール (a)〜(h) を満たす
 *   - 意図的に壊した story.json 断片で各違反 (a)〜(h) がメッセージに出る（回帰）
 *   - validateStoryFiles で (i) の実在検査が期待どおりトリガーする
 *   - 純関数の非破壊性（引数を破壊しない）
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateStory, validateStoryFiles } from './story-integrity';
import type { StoryData, Volume } from './types';

const STORY_JSON_PATH = resolve(__dirname, '../public/story.json');

function _loadRealStory(): StoryData {
    return JSON.parse(readFileSync(STORY_JSON_PATH, 'utf-8')) as StoryData;
}

// ベース story（全項目正しい）。個別テストで一部を壊して各エラーを再現する。
// 2vol・全 sec 公開・afterword は非公開、最終 vol は heroCardCompleted を持つ。
function _baseStory(): StoryData {
    return [
        {
            volume: 1,
            epRange: [1, 2],
            heroCard: { file: 'vol01.avif' },
            afterword: { published: false },
            episodes: [
                { id: 1, title: 'ep1', sections: [{ id: 1, published: true }] },
                { id: 2, title: 'ep2', sections: [{ id: 1, published: true }] },
            ],
        },
        {
            volume: 2,
            epRange: [3, 4],
            heroCard: { file: 'vol02.avif' },
            heroCardCompleted: { file: 'vol02-fin.avif' },
            afterword: { published: false },
            episodes: [
                { id: 3, title: 'ep3', sections: [{ id: 1, published: true }] },
                { id: 4, title: 'ep4', sections: [{ id: 1, published: true }] },
            ],
        },
    ];
}

describe('validateStory — 実データ整合', () => {
    it('public/story.json は全ルール (a)〜(h) を満たす（実データ回帰）', () => {
        const story = _loadRealStory();
        const errors = validateStory(story);
        expect(errors, `違反: ${errors.join(' / ')}`).toEqual([]);
    });
});

describe('validateStory — 壊したパターンで各違反が検出される', () => {
    it('(a) vol.epRange 外の ep.id を含む → (a) エラー', () => {
        const story = _baseStory();
        story[0].episodes.push({ id: 99, title: 'ep99', sections: [{ id: 1, published: false }] });
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(a)') && e.includes('範囲外'))).toBe(true);
    });

    it('(a) 中間の ep.id が飛んでいる → (a) エラー', () => {
        const story = _baseStory();
        // epRange [1,2] だが ep1 だけにする → epRange 全域を埋めていないだけ＝(a) 違反ではない
        // 代わりに ep2 を消して ep3 は無い状態にして「連続性が崩れる」パターンを作る：
        // ここは epRange [1,3] に広げて ep1, ep3 を残す＝ep2 欠落＝中間の飛び
        story[0].epRange = [1, 3];
        story[0].episodes = [
            { id: 1, title: 'ep1', sections: [{ id: 1, published: true }] },
            { id: 3, title: 'ep3', sections: [{ id: 1, published: true }] },
        ];
        // epRange [1,3] と [3,4] が連続でないので (b) も出るが、その前に (a) が出る
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(a)') && e.includes('不一致'))).toBe(true);
    });

    it('(b) 隣接 vol の epRange が連続していない → (b) エラー', () => {
        const story = _baseStory();
        story[1].epRange = [5, 6];
        story[1].episodes = [
            { id: 5, title: 'ep5', sections: [{ id: 1, published: true }] },
            { id: 6, title: 'ep6', sections: [{ id: 1, published: true }] },
        ];
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(b)'))).toBe(true);
    });

    it('(c) vol が volume 昇順で並んでいない → (c) エラー', () => {
        const story = _baseStory();
        const [v1, v2] = story;
        const shuffled: StoryData = [v2, v1];
        const errors = validateStory(shuffled);
        expect(errors.some(e => e.startsWith('(c)'))).toBe(true);
    });

    it('(d) sections が id 昇順で並んでいない → (d) エラー', () => {
        const story = _baseStory();
        story[0].episodes[0].sections = [
            { id: 2, published: true },
            { id: 1, published: true },
        ];
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(d)') && e.includes('id 昇順'))).toBe(true);
    });

    it('(d) 未公開 sec の後に公開 sec がある → (d) エラー', () => {
        const story = _baseStory();
        story[0].episodes[0].sections = [
            { id: 1, published: false },
            { id: 2, published: true },
        ];
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(d)') && e.includes('末尾のみ'))).toBe(true);
    });

    it('(e) afterword.published=true だが未公開 sec が残っている → (e) エラー', () => {
        const story = _baseStory();
        story[0].afterword = { published: true };
        story[0].episodes[1].sections = [{ id: 1, published: false }];
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(e)') && e.includes('未公開'))).toBe(true);
    });

    it("(e') 全 sec 公開なのに afterword.published=false → (e') エラー", () => {
        const story = _baseStory();
        // baseStory は vol1 全 sec 公開・afterword.published=false → (e') エラー期待
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith("(e')") && e.includes('vol1'))).toBe(true);
    });

    it('(e) afterword.published=true だが epRange 全域が定義されていない → (e) エラー', () => {
        const story = _baseStory();
        story[0].epRange = [1, 3]; // ep1,ep2 しか episodes に無い状態で epRange を [1,3] に拡張
        story[0].afterword = { published: true };
        // epRange [1,3] と隣 [3,4] は重複するので (b) も出るが、まず (e) が出る
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(e)') && e.includes('epRange 全域'))).toBe(true);
    });

    it('(f) heroCard.file が空文字列 → (f) エラー', () => {
        const story = _baseStory();
        story[0].heroCard = { file: '' };
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(f)'))).toBe(true);
    });

    it('(g) 最終 vol でない vol が heroCardCompleted を持つ → (g) エラー', () => {
        const story = _baseStory();
        story[0].heroCardCompleted = { file: 'vol01-fin.avif' };
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(g)') && e.includes('最終 vol のみ'))).toBe(true);
    });

    it('(g) 最終 vol が heroCardCompleted を持たない → (g) エラー', () => {
        const story = _baseStory();
        delete story[1].heroCardCompleted;
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(g)') && e.includes('最終 vol'))).toBe(true);
    });

    it('(h) 撤廃済み end フィールドが残っている → (h) エラー', () => {
        const story = _baseStory();
        // TypeScript の型からは end は消えているが、実 JSON では残る可能性がある
        (story[0].episodes[0].sections[0] as unknown as Record<string, unknown>).end = false;
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(h)'))).toBe(true);
    });
});

describe('validateStoryFiles — (i) の実在検査', () => {
    it('全ファイル実在 → (i) はトリガーしない（純データ検査の結果のみ）', () => {
        const story = _baseStory();
        story[0].afterword = { published: false }; // (e') 誤検出を避けるため未公開に留める前提
        story[0].episodes[0].sections = [{ id: 1, published: false }]; // 全 sec 公開でない状態にする
        const errors = validateStoryFiles(story, {
            afterwordTxtExists: () => true,
        });
        expect(errors.filter(e => e.startsWith('(i)'))).toEqual([]);
    });

    it('(i) afterword.published=true なのに txt が存在しない → (i) エラー', () => {
        const story = _baseStory();
        story[0].afterword = { published: true }; // vol1 全 sec 公開なので (e') は起きない
        const errors = validateStoryFiles(story, {
            afterwordTxtExists: (vol) => vol !== 1, // vol1 だけ不在
        });
        expect(errors.some(e => e.startsWith('(i)') && e.includes('vol1'))).toBe(true);
    });
});

describe('validateStory — 純関数の非破壊性', () => {
    it('呼び出し後に story 配列と内容が変わらない', () => {
        const story = _baseStory();
        const snapshot = JSON.parse(JSON.stringify(story));
        validateStory(story);
        expect(story).toEqual(snapshot);
    });

    it('validateStoryFiles も非破壊', () => {
        const story = _baseStory();
        const snapshot = JSON.parse(JSON.stringify(story));
        validateStoryFiles(story, {
            afterwordTxtExists: () => true,
        });
        expect(story).toEqual(snapshot);
    });
});
