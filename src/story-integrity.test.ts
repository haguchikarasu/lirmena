/*
 * story-integrity.test.ts
 * story-integrity.ts の仕様駆動テスト。
 * IF: validateStory(story: StoryData): string[]     — 純データ検査 (a)〜(h) + (j)(k)(k')(l)(m)(n)(p)
 *     validateStoryFiles(story, opts): string[]    — (i)(o)(q) を含む合成版（fs 実在検査と characters.json を注入）
 *
 * 網羅する観点：
 *   - 実データ（public/story.json）が validateStory の全ルール（(i) 以外）を満たす
 *   - 意図的に壊した story.json 断片で各違反 (a)〜(n) がメッセージに出る（回帰）
 *   - validateStoryFiles で (i) の実在検査が期待どおりトリガーする
 *   - (o) characters.json の形・重複・存在しない巻・公開済みの巻の登録漏れを検出する（実データ回帰を含む）
 *   - (q) 巻の素材を規約の場所で引き、対象を公開済みの巻と到達できる final に限る
 *   - preview を持つ未執筆 vol/ep が (a)〜(l) を壊さない正常系
 *   - (m) は vol 数の境界（上限ちょうど／超過）で判定が切り替わる
 *   - 純関数の非破壊性（引数を破壊しない）
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateStory, validateStoryFiles } from './story-integrity';
import { MAX_STORY_STAGE } from './volumes';
import type { StoryData, Volume, CharacterEntry, CharactersData } from './types';

const STORY_JSON_PATH = resolve(__dirname, '../public/story.json');
const CHARACTERS_JSON_PATH = resolve(__dirname, '../public/characters.json');

function _loadRealStory(): StoryData {
    return JSON.parse(readFileSync(STORY_JSON_PATH, 'utf-8')) as StoryData;
}

// (o) 用のダミーのキャラ 1 人と、story の全巻に 1 人ずつ登録した characters.json 相当。
// (o) 以外を見るテストはこれを渡して (o) を発火させない。
const _CHARA: CharacterEntry = { name: 'キャラ', description: '説明', image: '' };
function _charactersFor(story: StoryData): CharactersData {
    return story.map(v => ({ volume: v.volume, characters: [_CHARA] }));
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
            afterword: { published: false },
            episodes: [
                { id: 1, title: 'ep1', sections: [{ id: 1, published: false }] },
                { id: 2, title: 'ep2', sections: [{ id: 1, published: false }] },
            ],
        },
        {
            volume: 2,
            epRange: [3, 4],
            afterword: { published: false },
            episodes: [
                { id: 3, title: 'ep3', sections: [{ id: 1, published: false }] },
                { id: 4, title: 'ep4', sections: [{ id: 1, published: false }] },
            ],
        },
    ];
}

// ベース story（全項目正しい）。個別テストで一部を壊して各エラーを再現する。
// 2vol・全 sec 公開・afterword は非公開。
function _baseStory(): StoryData {
    return [
        {
            volume: 1,
            epRange: [1, 2],
            afterword: { published: false },
            episodes: [
                { id: 1, title: 'ep1', sections: [{ id: 1, published: true }] },
                { id: 2, title: 'ep2', sections: [{ id: 1, published: true }] },
            ],
        },
        {
            volume: 2,
            epRange: [3, 4],
            afterword: { published: false },
            episodes: [
                { id: 3, title: 'ep3', sections: [{ id: 1, published: true }] },
                { id: 4, title: 'ep4', sections: [{ id: 1, published: true }] },
            ],
        },
    ];
}

// vol 数だけを変えた story を作る（(m) の境界テスト用）。各 vol は ep 2 本・全 sec 公開・
// epRange は隙間なく連続（(b)(c) を巻き込まない形）。
function _storyOfVolumes(count: number): StoryData {
    return Array.from({ length: count }, (_, i): Volume => {
        const v = i + 1;
        const firstEp = i * 2 + 1;
        const vol: Volume = {
            volume: v,
            epRange: [firstEp, firstEp + 1],
            afterword: { published: false },
            episodes: [
                { id: firstEp,     title: `ep${firstEp}`,     sections: [{ id: 1, published: true }] },
                { id: firstEp + 1, title: `ep${firstEp + 1}`, sections: [{ id: 1, published: true }] },
            ],
        };
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

    it('(f)(g) 撤去した heroCard / heroCardCompleted は書かれていても止めない（巻の素材は (q) の規約で引く）', () => {
        const story = _baseStory() as unknown as Array<Record<string, unknown>>;
        story[0].heroCard = { file: '' };
        const errors = validateStory(story as unknown as StoryData);
        expect(errors.some(e => e.startsWith('(f)') || e.startsWith('(g)'))).toBe(false);
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

    // (n) は title.ts が CSS へ素通しする扉の位置指定の形式検査。X に "top" が入ると CSS は縦位置として読む。
    it('(n) coverPositionX / Y の正しい形（パーセント・軸の合うキーワード）は通る', () => {
        const story = _baseStory();
        story[0].episodes[0].coverPositionX = '20%';
        story[0].episodes[0].coverPositionY = 'top';
        story[0].episodes[1].coverPositionX = 'right';
        story[0].episodes[1].coverPositionY = '100%';
        story[1].episodes[0].coverPositionX = '0%';
        story[1].episodes[0].coverPositionY = '12.5%';
        story[1].episodes[1].tocCoverPositionY = '35%';
        expect(validateStory(story).filter(e => e.startsWith('(n)'))).toEqual([]);
    });

    // (p) 公開予定日時。日本時間固定・実在する日時・公開済み sec には書けない
    it('(p) 未公開 sec の正しい scheduledAt（秒あり・なし）は通る', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].sections[0].scheduledAt = '2026-11-02T20:00+09:00';
        story[0].episodes[1].sections[0].scheduledAt = '2028-02-29T07:05:30+09:00'; // うるう日
        expect(validateStory(story).filter(e => e.startsWith('(p)'))).toEqual([]);
    });

    it.each([
        ['2026-11-02T20:00Z'],
        ['2026-11-02T20:00+00:00'],
        ['2026-11-02 20:00+09:00'],
        ['2026-11-02'],
        ['2026-02-30T20:00+09:00'],
        ['2026-11-02T24:00+09:00'],
        [20261102],
    ] as const)('(p) scheduledAt=%s → (p) エラー', (value) => {
        const story = _previewBaseStory();
        (story[0].episodes[0].sections[0] as Record<string, unknown>).scheduledAt = value;
        expect(validateStory(story).some(e => e.startsWith('(p)') && e.includes('scheduledAt'))).toBe(true);
    });

    it('(p) 公開済み sec に scheduledAt が残っている → (p) エラー（消し忘れ）', () => {
        const story = _baseStory();
        story[0].episodes[0].sections[0].scheduledAt = '2026-11-02T20:00+09:00';
        expect(validateStory(story).some(e => e.startsWith('(p)') && e.includes('公開済み'))).toBe(true);
    });

    it.each([
        ['coverPositionX', 'top'],
        ['coverPositionX', 'center'],
        ['coverPositionX', '20px'],
        ['coverPositionX', '120%'],
        ['coverPositionX', '-5%'],
        ['coverPositionY', 'left'],
        ['coverPositionY', 'Bottom'],
        ['coverPositionY', 30],
        ['tocCoverPositionY', 'top'],
        ['tocCoverPositionY', '101%'],
        ['tocCoverPositionY', '40px'],
    ] as const)('(n) %s=%s → (n) エラー', (field, value) => {
        const story = _baseStory();
        (story[0].episodes[0] as Record<string, unknown>)[field] = value;
        const errors = validateStory(story);
        expect(errors.some(e => e.startsWith('(n)') && e.includes(field))).toBe(true);
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
            themeFileExists: () => true,
            charaFileExists: () => true,
            characters: _charactersFor(story),
        });
        expect(errors.filter(e => e.startsWith('(i)'))).toEqual([]);
    });

    it('(i) afterword.published=true なのに txt が存在しない → (i) エラー', () => {
        const story = _baseStory();
        story[0].afterword = { published: true }; // vol1 全 sec 公開なので (e') は起きない
        const errors = validateStoryFiles(story, {
            afterwordTxtExists: (vol) => vol !== 1, // vol1 だけ不在
            themeFileExists: () => true,
            charaFileExists: () => true,
            characters: _charactersFor(story),
        });
        expect(errors.some(e => e.startsWith('(i)') && e.includes('vol1'))).toBe(true);
    });
});

describe('validateStoryFiles — (o) characters.json との整合', () => {
    const only = (errors: string[]): string[] => errors.filter(e => e.startsWith('(o)'));
    const run = (story: StoryData, characters: unknown, charaFileExists: (p: string) => boolean = () => true): string[] =>
        only(validateStoryFiles(story, { afterwordTxtExists: () => true, themeFileExists: () => true, charaFileExists, characters }));

    it('実データ：public/story.json と public/characters.json は (o) を満たす（画像は public/ の実在で見る。実データ回帰）', () => {
        const characters: unknown = JSON.parse(readFileSync(CHARACTERS_JSON_PATH, 'utf-8'));
        expect(run(_loadRealStory(), characters, p => existsSync(resolve(__dirname, '../public', p)))).toEqual([]);
    });

    it('公開済みの巻すべてに登録がある → (o) はトリガーしない', () => {
        const story = _baseStory();
        expect(run(story, _charactersFor(story))).toEqual([]);
    });

    it('公開済みの巻に登録が無い → (o) エラー（その巻の番号が出る）', () => {
        const story = _baseStory();
        const errors = run(story, _charactersFor(story).filter(c => c.volume !== 2));
        expect(errors.some(e => e.includes('vol2'))).toBe(true);
    });

    it('公開済みの巻の登録が空配列 → (o) エラー', () => {
        const story = _baseStory();
        const characters = _charactersFor(story).map(c => c.volume === 1 ? { ...c, characters: [] } : c);
        expect(run(story, characters).some(e => e.includes('vol1'))).toBe(true);
    });

    it('未公開の巻は登録が無くても通る', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].sections = [{ id: 1, published: true }]; // vol1 だけ公開を始める
        expect(run(story, _charactersFor(story).filter(c => c.volume === 1))).toEqual([]);
    });

    it('story.json に無い巻の登録 → (o) エラー', () => {
        const story = _baseStory();
        const characters = [..._charactersFor(story), { volume: 3, characters: [_CHARA] }];
        expect(run(story, characters).some(e => e.includes('volume 3'))).toBe(true);
    });

    it('同じ巻の登録が重複 → (o) エラー', () => {
        const story = _baseStory();
        const characters = [..._charactersFor(story), { volume: 1, characters: [] }];
        expect(run(story, characters).some(e => e.includes('重複'))).toBe(true);
    });

    it('配列でない（読めなかった＝undefined を含む） → (o) エラー', () => {
        const story = _baseStory();
        expect(run(story, undefined).length).toBe(1);
        expect(run(story, { volume: 1 }).length).toBe(1);
    });

    it('volume が整数でない／characters が配列でない → (o) エラー', () => {
        const story = _baseStory();
        expect(run(story, [{ volume: 1.5, characters: [_CHARA] }, ..._charactersFor(story)]).some(e => e.includes('[0]'))).toBe(true);
        expect(run(story, [{ volume: 1, characters: 'x' }, { volume: 2, characters: [_CHARA] }]).some(e => e.includes('[0]'))).toBe(true);
    });

    // 公開済みの巻のキャラの中身（紹介文・画像ファイル）。_baseStory は vol1・vol2 とも公開済み
    const _withChara = (story: StoryData, c: CharacterEntry): CharactersData =>
        _charactersFor(story).map(e => e.volume === 1 ? { ...e, characters: [c] } : e);

    it('公開済みの巻のキャラの紹介文が空（空白だけも） → (o) エラー（キャラ名が出る）', () => {
        const story = _baseStory();
        expect(run(story, _withChara(story, { name: '甲', description: '', image: '' })).some(e => e.includes('甲') && e.includes('紹介文'))).toBe(true);
        expect(run(story, _withChara(story, { name: '乙', description: ' \n　', image: '' })).some(e => e.includes('乙') && e.includes('紹介文'))).toBe(true);
    });

    it('未公開の巻のキャラは紹介文が空でも・画像が無くても通る（書きかけ）', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].sections = [{ id: 1, published: true }]; // vol1 だけ公開を始める
        const characters = [
            { volume: 1, characters: [_CHARA] },
            { volume: 2, characters: [{ name: '丙', description: '', image: 'vol2_丙.avif' }] },
        ];
        expect(run(story, characters, () => false)).toEqual([]);
    });

    it('画像の名前があるのに全身か顔のファイルが無い → (o) エラー（無いファイル名が出る）', () => {
        const story = _baseStory();
        const characters = _withChara(story, { name: '甲', description: '説明', image: 'vol1_甲.avif' });
        const asked: string[] = [];
        const onlyFull = (p: string): boolean => { asked.push(p); return p === 'chara/vol1_甲.avif'; };
        const errors = run(story, characters, onlyFull);
        expect(asked).toEqual(['chara/vol1_甲.avif', 'chara/vol1_甲-face.avif']);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('vol1_甲-face.avif');
        expect(errors[0]).not.toContain('vol1_甲.avif /');
        expect(run(story, characters, () => false)[0]).toContain('vol1_甲.avif / vol1_甲-face.avif');
        expect(run(story, characters, () => true)).toEqual([]);
    });

    it('image が "" のキャラはファイルを探さない（顔の所に頭文字を出す正規の状態）', () => {
        const story = _baseStory();
        const asked: string[] = [];
        expect(run(story, _withChara(story, _CHARA), p => { asked.push(p); return false; })).toEqual([]);
        expect(asked).toEqual([]);
    });

    it('キャラの name / description / image が文字列でない → (o) エラー', () => {
        const story = _baseStory();
        const characters = [{ volume: 1, characters: [{ name: 'キャラ', description: '説明' }] }, { volume: 2, characters: [_CHARA] }];
        expect(run(story, characters).some(e => e.includes('volume 1 の characters[0]'))).toBe(true);
    });
});

describe('validateStoryFiles — (q) 巻の素材', () => {
    // exists に渡ったパスを集めつつ、present に挙げたパスだけ「在る」と答える
    const run = (story: StoryData, present: (path: string) => boolean): { errors: string[]; asked: string[] } => {
        const asked: string[] = [];
        const errors = validateStoryFiles(story, {
            afterwordTxtExists: () => true,
            themeFileExists: (p) => { asked.push(p); return present(p); },
            charaFileExists: () => true,
            characters: _charactersFor(story),
        }).filter(e => e.startsWith('(q)'));
        return { errors, asked };
    };

    it('実データ：public/story.json の公開済みの巻は public/ に素材が揃っている（実データ回帰）', () => {
        const pub = resolve(__dirname, '../public');
        expect(run(_loadRealStory(), p => existsSync(resolve(pub, p))).errors).toEqual([]);
    });

    it('公開済み sec を持つ巻の 3 ファイルを規約の場所で引く。揃っていれば通る', () => {
        const { errors, asked } = run(_baseStory(), () => true);
        expect(errors).toEqual([]);
        expect(asked).toEqual([
            'vol01/theme/hero-wide.avif', 'vol01/theme/logo.webp', 'vol01/theme/page-bg.avif',
            'vol02/theme/hero-wide.avif', 'vol02/theme/logo.webp', 'vol02/theme/page-bg.avif',
        ]);
    });

    it('1 ファイルでも欠けたら (q) エラー（巻と欠けたファイル名が出る）', () => {
        const { errors } = run(_baseStory(), p => p !== 'vol02/theme/logo.webp');
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('vol2');
        expect(errors[0]).toContain('logo.webp');
    });

    it('未公開の巻は見ない（スタブを置かせない）', () => {
        const story = _previewBaseStory();
        story[0].episodes[0].sections = [{ id: 1, published: true }]; // vol1 だけ公開を始める
        const { errors, asked } = run(story, () => false);
        expect(asked.every(p => p.startsWith('vol01/'))).toBe(true);
        expect(errors).toHaveLength(1);
    });

    it('最終巻のあとがきが公開済みなら final/theme/ も見る', () => {
        const story = _baseStory();
        story[1].afterword = { published: true };
        const { errors, asked } = run(story, p => !p.startsWith('final/'));
        expect(asked).toContain('final/theme/hero-wide.avif');
        expect(errors.some(e => e.startsWith('(q) final'))).toBe(true);
    });

    it('最終巻でない巻のあとがきが公開済みでも final は見ない', () => {
        const story = _baseStory();
        story[0].afterword = { published: true };
        expect(run(story, () => true).asked.some(p => p.startsWith('final/'))).toBe(false);
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
            themeFileExists: () => true,
            charaFileExists: () => true,
            characters: _charactersFor(story),
        });
        expect(story).toEqual(snapshot);
    });
});
