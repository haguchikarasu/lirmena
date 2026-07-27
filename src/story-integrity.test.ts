/*
 * story-integrity.test.ts
 * story-integrity.ts の仕様駆動テスト。
 * IF: validateStory(story: StoryData): string[]     — 純データ検査 (a)〜(h) + (j)(k)(k')(l)(m)
 *     validateStoryFiles(story, opts): string[]    — (i) を含む合成版（fs 実在検査を注入）
 *
 * 網羅する観点：
 *   - 実データ（public/story.json）が validateStory の全ルール（(i) 以外）を満たす
 *   - 意図的に壊した story.json 断片で各違反 (a)〜(m) がメッセージに出る（回帰）
 *   - validateStoryFiles で (i) の実在検査が期待どおりトリガーする
 *   - preview を持つ未執筆 vol/ep が (a)〜(l) を壊さない正常系
 *   - (m) は vol 数の境界（上限ちょうど／超過）で判定が切り替わる
 *   - 純関数の非破壊性（引数を破壊しない）
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateStory, validateStoryFiles } from './story-integrity';
import { MAX_STORY_STAGE } from './volumes';
import type { StoryData, Volume } from './types';

const STORY_JSON_PATH = resolve(__dirname, '../public/story.json');

function _loadRealStory(): StoryData {
    return JSON.parse(readFileSync(STORY_JSON_PATH, 'utf-8')) as StoryData;
}

// preview テスト用の未執筆 vol ベース。全 sec 未公開・afterword 非公開の 2vol 構成。
// 全 sec 未公開なので (e') は発火せず、preview を書き加えても (k)/(l) が発火しない
// ＝preview 正常系の回帰テストに使える。個別テストで vol.preview / ep.preview を足したり
// 一部 sec を published:true にしたりして (k)/(l)/(e) を壊す。
function _previewBaseStory(): StoryData {
    return [
        {
            volume: 1,
            epRange: [1, 2],
            heroCard: { file: 'vol01.avif' },
            afterword: { published: false },
            episodes: [
                { id: 1, title: 'ep1', sections: [{ id: 1, published: false }] },
                { id: 2, title: 'ep2', sections: [{ id: 1, published: false }] },
            ],
        },
        {
            volume: 2,
            epRange: [3, 4],
            heroCard: { file: 'vol02.avif' },
            heroCardCompleted: { file: 'vol02-fin.avif' },
            afterword: { published: false },
            episodes: [
                { id: 3, title: 'ep3', sections: [{ id: 1, published: false }] },
                { id: 4, title: 'ep4', sections: [{ id: 1, published: false }] },
            ],
        },
    ];
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

// vol 数だけを変えた story を作る（(m) の境界テスト用）。各 vol は ep 2 本・全 sec 公開・
// epRange は隙間なく連続。最終 vol だけが heroCardCompleted を持つ（(b)(c)(f)(g) を巻き込まない形）。
function _storyOfVolumes(count: number): StoryData {
    return Array.from({ length: count }, (_, i): Volume => {
        const v = i + 1;
        const firstEp = i * 2 + 1;
        const pad = String(v).padStart(2, '0');
        const vol: Volume = {
            volume: v,
            epRange: [firstEp, firstEp + 1],
            heroCard: { file: `vol${pad}.avif` },
            afterword: { published: false },
            episodes: [
                { id: firstEp,     title: `ep${firstEp}`,     sections: [{ id: 1, published: true }] },
                { id: firstEp + 1, title: `ep${firstEp + 1}`, sections: [{ id: 1, published: true }] },
            ],
        };
        if (v === count) vol.heroCardCompleted = { file: `vol${pad}-fin.avif` };
        return vol;
    });
}

describe('validateStory — 実データ整合', () => {
    it('public/story.json は validateStory の全ルール（(a)〜(h) + (e\') + (j)(k)(k\')(l)。(i) は validateStoryFiles 側）を満たす（実データ回帰）', () => {
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

    // (m) は「vol を足したのに StoryStage 型・MAX_STORY_STAGE・CSS の --stage-N-hue を足していない」の検出。
    // 上限ちょうど（読破 stage の分だけ余っている）で通り、1 vol 増えた瞬間に落ちることを境界で押さえる。
    it('(m) vol 数 + 1 が stage 上限 MAX_STORY_STAGE を超える → (m) エラー', () => {
        const errors = validateStory(_storyOfVolumes(MAX_STORY_STAGE));
        expect(errors.some(e => e.startsWith('(m)'))).toBe(true);
    });

    it('(m) vol 数 + 1 が上限ちょうど（現行 4vol）なら (m) は出ない', () => {
        const errors = validateStory(_storyOfVolumes(MAX_STORY_STAGE - 1));
        expect(errors.some(e => e.startsWith('(m)'))).toBe(false);
    });
});

describe('validateStory — preview 系 (j)(k)(k\')(l) と (e) 強化', () => {
    it('preview を持つ未執筆 vol / ep が (a)〜(i) を壊さない（正常系回帰）', () => {
        const story = _previewBaseStory();
        story[0].preview = { text: '2026年11月ごろ開始予定' };
        story[1].episodes[0].preview = { text: '2026/7/31 より順次投稿予定' };
        const errors = validateStory(story);
        expect(errors, `違反: ${errors.join(' / ')}`).toEqual([]);
    });

    it('vol.preview.text が空文字は valid（事前配置テンプレとして preview 無扱い）', () => {
        const story = _previewBaseStory();
        story[0].preview = { text: '' };
        const errors = validateStory(story);
        expect(errors.filter(e => e.startsWith('(j)'))).toEqual([]);
    });

    it('ep.preview.text が空白のみは valid（事前配置テンプレとして preview 無扱い）', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].preview = { text: '   ' };
        const errors = validateStory(story);
        expect(errors.filter(e => e.startsWith('(j)'))).toEqual([]);
    });

    it('(j) vol.preview.text が非 string（数値）→ (j) エラー', () => {
        const story = _previewBaseStory();
        (story[0] as unknown as Record<string, unknown>).preview = { text: 123 };
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(j)') && e.includes('vol1'))).toBe(true);
    });

    it('(j) vol.preview が null → (j) エラー', () => {
        const story = _previewBaseStory();
        (story[0] as unknown as Record<string, unknown>).preview = null;
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(j)') && e.includes('vol1'))).toBe(true);
    });

    it('(j) vol.preview が配列 → (j) エラー', () => {
        const story = _previewBaseStory();
        (story[0] as unknown as Record<string, unknown>).preview = ['text'];
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(j)') && e.includes('vol1'))).toBe(true);
    });

    it('(j) vol.preview が {} (text 欠落) → (j) エラー', () => {
        const story = _previewBaseStory();
        (story[0] as unknown as Record<string, unknown>).preview = {};
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(j)') && e.includes('vol1'))).toBe(true);
    });

    it('(k) 公開済み sec を持つ ep がある vol に vol.preview → (k) エラー', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].sections = [{ id: 1, published: true }];
        story[0].preview = { text: '2026年11月ごろ開始予定' };
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(k)') && e.includes('vol1'))).toBe(true);
    });

    it('(k\') vol.preview と ep.preview を同時に持つ → (k\') エラー', () => {
        const story = _previewBaseStory();
        story[0].preview = { text: '2026年11月ごろ開始予定' };
        story[0].episodes[0].preview = { text: '2026/7/31 より順次投稿予定' };
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith("(k')") && e.includes('vol1') && e.includes('ep1'))).toBe(true);
    });

    it('(l) 公開済み sec を持つ ep に ep.preview → (l) エラー', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].sections = [{ id: 1, published: true }];
        story[0].episodes[0].preview = { text: '2026/7/31 より順次投稿予定' };
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(l)') && e.includes('vol1') && e.includes('ep1'))).toBe(true);
    });

    it('(e) afterword.published=true の vol が vol.preview を持つ → (e) エラー', () => {
        const story = _baseStory();
        story[0].afterword = { published: true };
        story[0].preview = { text: '完結済みなのに予告' };
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(e)') && e.includes('vol.preview'))).toBe(true);
    });

    it('(e) afterword.published=true の vol の ep が ep.preview を持つ → (e) エラー', () => {
        const story = _baseStory();
        story[0].afterword = { published: true };
        story[0].episodes[0].preview = { text: '完結済みなのに予告' };
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(e)') && e.includes('ep1') && e.includes('preview'))).toBe(true);
    });

    // ↓ 空 text preview は (k)(l)(k')(e) の対象外＝事前配置テンプレとして許容する正常系
    it('(k) 空 vol.preview は公開済み ep がある vol にも置ける（事前配置テンプレ用途）', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].sections = [{ id: 1, published: true }];
        story[0].preview = { text: '' };
        const errors = validateStory(story);
        expect(errors.filter(e => e.startsWith('(k)'))).toEqual([]);
    });

    it('(l) 空 ep.preview は公開済み sec がある ep にも置ける（事前配置テンプレ用途）', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].sections = [{ id: 1, published: true }];
        story[0].episodes[0].preview = { text: '' };
        const errors = validateStory(story);
        expect(errors.filter(e => e.startsWith('(l)'))).toEqual([]);
    });

    it("(k') 空 vol.preview + 非空 ep.preview は併存できる（空 vol.preview は無扱い）", () => {
        const story = _previewBaseStory();
        story[0].preview = { text: '' };
        story[0].episodes[0].preview = { text: '2026/7/31 より順次投稿予定' };
        const errors = validateStory(story);
        expect(errors.filter(e => e.startsWith("(k')"))).toEqual([]);
    });

    it("(k') 非空 vol.preview + 空 ep.preview は併存できる（空 ep.preview は無扱い）", () => {
        const story = _previewBaseStory();
        story[0].preview = { text: '2026年11月ごろ開始予定' };
        story[0].episodes[0].preview = { text: '' };
        const errors = validateStory(story);
        expect(errors.filter(e => e.startsWith("(k')"))).toEqual([]);
    });

    it('(e) afterword.published=true の完結 vol にも空 preview を残せる（事前配置テンプレ用途）', () => {
        const story = _baseStory();
        story[0].afterword = { published: true };
        story[0].preview = { text: '' };
        story[0].episodes[0].preview = { text: '' };
        const errors = validateStory(story);
        expect(errors.filter(e => e.startsWith('(e)') && e.includes('preview'))).toEqual([]);
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
