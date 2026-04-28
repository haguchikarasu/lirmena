/*
 * loader.ts
 * 責務: fetch による episodes.json・本文テキストの取得
 * export: loadEpisodes(), loadText()
 * 依存: なし
 */

import type { EpisodesData } from './types';

// episodes.json を取得して EpisodesData を返す
// loadEpisodes(): Promise<EpisodesData>
export async function loadEpisodes(): Promise<EpisodesData> {
    const res = await fetch('/episodes.json');
    if (!res.ok) throw new Error(`Failed to load episodes.json: ${res.status}`);
    return res.json() as Promise<EpisodesData>;
}

// 指定 ep/sec の本文テキストを取得して返す
// 命名規則: public/txt/[ep2桁]-[sec2桁].txt
// エラー時（404・ネットワーク失敗）は例外を投げる
// loadText(ep: number, sec: number): Promise<string>
export async function loadText(ep: number, sec: number): Promise<string> {
    const path = `/txt/${String(ep).padStart(2, '0')}-${String(sec).padStart(2, '0')}.txt`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.text();
}
