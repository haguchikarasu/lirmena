/*
 * loader.ts
 * 責務: fetch による episodes.json・本文テキストの取得
 * export: loadEpisodes(), loadText()
 * 依存: なし
 */

// episodes.json を取得して EpisodesData を返す
// loadEpisodes(): Promise<EpisodesData>

// 指定 ep/sec の本文テキストを取得して返す
// 命名規則: public/txt/[ep2桁]-[sec2桁].txt
// エラー時（404・ネットワーク失敗）は例外を投げる
// loadText(ep: number, sec: number): Promise<string>