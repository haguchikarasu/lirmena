/*
 * loader.ts
 * 責務: fetch によるリソース取得（story.json / characters.json / 本文テキスト / あとがき本文 / ep changelog）
 * export: loadStory(), loadAfterwordText(), fetchCharacters(), loadText(), fetchEpChangelog()
 *         loadEpisodes()（後方互換の派生ヘルパー・全 vol の episodes を平坦化して Episode[] を返す。
 *         内部で loadStory() を呼ぶ＝fetch 対象は必ず story.json 一本）
 * 依存: なし（型のみ）
 *
 * story キャッシュ：loadStory() は一度成功した StoryData をモジュール内に保持し、以降の呼び出しに
 *   使い回す。loadText(ep, sec) は ep から属する vol を逆引きしてパス vol[YY]/ep[XX]/txt/... を組み立てる
 *   ため、事前に loadStory() を呼んだ後に loadText を呼ぶ順序を前提とする（main.ts / title.ts の
 *   bootstrap で loadStory を最初に呼ぶ既存導線に合わせる）。ページ遷移で全 JS が再初期化されるため
 *   キャッシュのライフタイムはページ単位＝古くならない。
 */

import type { EpisodesData, CharactersData, StoryData, ChangelogEntry } from './types';

// story.json の直近取得結果。loadText が vol 逆引きに使う（loadStory を先に呼ぶ前提）。
let _cachedStory: StoryData | null = null;

// story.json を取得して StoryData を返す（全ページで唯一の物語構造データ源・キャッシュあり）
// loadStory(): Promise<StoryData>
export async function loadStory(): Promise<StoryData> {
    if (_cachedStory) return _cachedStory;
    const res = await fetch(`${import.meta.env.BASE_URL}story.json`);
    if (!res.ok) throw new Error(`Failed to load story.json: ${res.status}`);
    _cachedStory = await res.json() as StoryData;
    return _cachedStory;
}

// 巻末あとがきの本文テキストを取得
// 命名規則: public/vol[vol2桁]/vol[vol2桁]-afterword.txt（テキスト1本しか持たないため txt/ フォルダは切らず vol 直下）
// エラー時（404・ネットワーク失敗）は例外を投げる
// loadAfterwordText(vol: number): Promise<string>
export async function loadAfterwordText(vol: number): Promise<string> {
    const volStr = String(vol).padStart(2, '0');
    const path = `${import.meta.env.BASE_URL}vol${volStr}/vol${volStr}-afterword.txt`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.text();
}

// characters.json を取得して CharactersData を返す
// fetchCharacters(): Promise<CharactersData>
export async function fetchCharacters(): Promise<CharactersData> {
    const res = await fetch(`${import.meta.env.BASE_URL}characters.json`);
    if (!res.ok) throw new Error(`Failed to load characters.json: ${res.status}`);
    return res.json() as Promise<CharactersData>;
}

// 後方互換：全 vol の episodes を平坦化して Episode[] を返す（内部は loadStory）
// title.ts / main.ts の state 移行が完了したら撤廃予定（Step 4）
// loadEpisodes(): Promise<EpisodesData>
export async function loadEpisodes(): Promise<EpisodesData> {
    const story = await loadStory();
    return story.flatMap(vol => vol.episodes);
}

// changelog/epXX-changelog.json を取得して ChangelogEntry[] を返す
// fetchEpChangelog(ep: number): Promise<ChangelogEntry[]>
export async function fetchEpChangelog(ep: number): Promise<ChangelogEntry[]> {
    const epStr = String(ep).padStart(2, '0');
    const path = `${import.meta.env.BASE_URL}changelog/ep${epStr}-changelog.json`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ep${epStr}-changelog.json: ${res.status}`);
    return res.json() as Promise<ChangelogEntry[]>;
}

// 指定 ep/sec の本文テキストを取得して返す。
// 命名規則: public/vol[vol2桁]/ep[ep2桁]/txt/[ep2桁]-[sec2桁].txt
// vol は story キャッシュから ep 番号で epRange 逆引きする（loadStory を先に呼んでいる前提）。
// エラー時（story 未ロード・ep 範囲外・404・ネットワーク失敗）は例外を投げる。
// loadText(ep: number, sec: number): Promise<string>
export async function loadText(ep: number, sec: number): Promise<string> {
    const story = await loadStory();
    const vol = story.find(v => ep >= v.epRange[0] && ep <= v.epRange[1]);
    if (!vol) throw new Error(`ep${ep} is not in any volume's epRange (story.json)`);
    const volStr = String(vol.volume).padStart(2, '0');
    const epStr = String(ep).padStart(2, '0');
    const secStr = String(sec).padStart(2, '0');
    const path = `${import.meta.env.BASE_URL}vol${volStr}/ep${epStr}/txt/${epStr}-${secStr}.txt`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.text();
}
