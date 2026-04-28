export type EpisodeSection = { id: number; published: boolean };
export type Episode = { id: number; title: string; sections: EpisodeSection[] };
export type EpisodesData = Episode[];
export type SceneAddress = { ep: number; sec: number; scene: number };

/**
 * parser.ts が生成するシーン構造体。
 * content フィールドの型は parser.ts の IF 設計時に確定する。
 */
export type Scene = {
    bgFile: string | null;
    lineCount: number;
    content: unknown;
};
