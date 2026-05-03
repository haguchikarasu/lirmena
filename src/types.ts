export type EpisodeSection = { id: number; published: boolean };
export type Episode = { id: number; title: string; img?: string; sections: EpisodeSection[] };
export type EpisodesData = Episode[];
export type SceneAddress = { ep: number; sec: number; scene: number };

export type CharacterEntry = { name: string; description: string; image: string };
export type VolumeCharacters = { volume: number; characters: CharacterEntry[] };
export type CharactersData = VolumeCharacters[];

export type VolumeRange = { volume: number; epRange: [number, number] };
export type VolumesData = VolumeRange[];

export type ChangelogEntry = { version: string; date: string; change: string; sha: string };

/**
 * parser.ts が生成するシーン構造体。
 * content フィールドの型は parser.ts の IF 設計時に確定する。
 */
export type Scene = {
    bgFile: string | null;
    bgPositionX?: string;  // 例: "30%"。@@BG:file:X%@@ で指定。縦長画面のみ有効
    lineCount: number;
    content: unknown;
};
