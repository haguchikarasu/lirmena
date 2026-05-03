/*
 * loader.ts
 * 責務: fetch によるリソース取得（episodes.json / characters.json / volumes.json / 本文テキスト）
 * export: loadEpisodes(), fetchCharacters(), fetchVolumes(), loadText()
 * 依存: なし
 */

import type { EpisodesData, CharactersData, VolumesData } from './types';

// episodes.json を取得して EpisodesData を返す
// loadEpisodes(): Promise<EpisodesData>
export async function loadEpisodes(): Promise<EpisodesData> {
    const res = await fetch('/episodes.json');
    if (!res.ok) throw new Error(`Failed to load episodes.json: ${res.status}`);
    return res.json() as Promise<EpisodesData>;
}

// characters.json を取得して CharactersData を返す
// fetchCharacters(): Promise<CharactersData>
export async function fetchCharacters(): Promise<CharactersData> {
    const res = await fetch('/characters.json');
    if (!res.ok) throw new Error(`Failed to load characters.json: ${res.status}`);
    return res.json() as Promise<CharactersData>;
}

// volumes.json を取得して VolumesData を返す
// fetchVolumes(): Promise<VolumesData>
export async function fetchVolumes(): Promise<VolumesData> {
    const res = await fetch('/volumes.json');
    if (!res.ok) throw new Error(`Failed to load volumes.json: ${res.status}`);
    return res.json() as Promise<VolumesData>;
}

// 指定 ep/sec の本文テキストを取得して返す
// 命名規則: public/ep[ep2桁]/txt/[ep2桁]-[sec2桁].txt
// エラー時（404・ネットワーク失敗）は例外を投げる
// loadText(ep: number, sec: number): Promise<string>
export async function loadText(ep: number, sec: number): Promise<string> {
    const epStr = String(ep).padStart(2, '0');
    const path = `/ep${epStr}/txt/${epStr}-${String(sec).padStart(2, '0')}.txt`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.text();
}
