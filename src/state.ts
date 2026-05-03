/*
 * state.ts
 * 【責務】ep/sec/scene の現在位置保持、遷移先計算、
 *         URLハッシュの生成・パース、episodes.json データ保持
 * 【依存】types.ts
 * 【被依存】main / nav / menu / transition / progress / bookmark
 */

import type { EpisodesData, Episode, EpisodeSection, SceneAddress } from './types';

/**
 * getPrev() がタイトルカードから前 sec へ戻る際に返す scene 値。
 * 「その sec の最後のシーン」を意味する番兵値。
 * transition.ts はこの値を検出したら、前 sec のテキストをロード後に実際のシーン総数へ差し替える。
 */
export const LAST_SCENE = -1;

let _data: EpisodesData = [];
let _current: SceneAddress = { ep: 1, sec: 1, scene: 0 };
let _scenesCount = 0;

/** main.ts が episodes.json ロード後に一度だけ呼ぶ */
export function init(data: EpisodesData, address: SceneAddress): void {
    _data = data;
    _current = { ...address };
    _scenesCount = 0;
}

/** 現在位置を返す */
export function getCurrent(): SceneAddress {
    return { ..._current };
}

/** scene === 0 のとき true */
export function isOnTitleCard(): boolean {
    return _current.scene === 0;
}

/** ep のタイトルを返す。存在しなければ undefined */
export function getEpTitle(ep: number): string | undefined {
    return _data.find(e => e.id === ep)?.title;
}

/** Episode オブジェクトを返す。存在しなければ undefined */
export function getEpisode(ep: number): Episode | undefined {
    return _data.find(e => e.id === ep);
}

/** EpisodeSection オブジェクトを返す。存在しなければ undefined */
export function getSection(ep: number, sec: number): EpisodeSection | undefined {
    return _data.find(e => e.id === ep)?.sections.find(s => s.id === sec);
}

/** 指定 ep/sec が公開済みか */
export function isPublished(ep: number, sec: number): boolean {
    const episode = _data.find(e => e.id === ep);
    if (!episode) return false;
    return episode.sections.find(s => s.id === sec)?.published ?? false;
}

/** 現在 sec のシーン総数を返す */
export function getScenesCount(): number {
    return _scenesCount;
}

/** main.ts が parser 結果を受け取った後に呼ぶ */
export function setScenesCount(count: number): void {
    _scenesCount = count;
}

/**
 * 進行ボタン用。次がなければ null。
 * - タイトルカード → scene 1
 * - シーン N（最後でない）→ scene N+1
 * - 最後のシーン → 同一 ep 内なら次 sec の scene 1、別 ep なら次 ep のタイトルカード（scene 0）。なければ null
 */
export function getNext(): SceneAddress | null {
    const { ep, sec, scene } = _current;

    if (scene === 0) {
        return { ep, sec, scene: 1 };
    }

    if (scene < _scenesCount) {
        return { ep, sec, scene: scene + 1 };
    }

    const next = findNextPublishedSec(ep, sec);
    if (next === null) return null;
    // 同一 ep 内の sec 境界はタイトルカードをスキップして scene 1 へ
    return next.ep === ep ? { ...next, scene: 1 } : next;
}

/**
 * 戻るボタン用。前がなければ null。
 * - sec 1 のシーン 1 → タイトルカード（scene 0）
 * - sec > 1 のシーン 1 → 前の公開済み sec の最後のシーン（scene = LAST_SCENE）。なければ null
 * - シーン N（N > 1）→ scene N-1
 * - タイトルカード → 前の公開済み sec の最後のシーン（scene = LAST_SCENE）。なければ null
 */
export function getPrev(): SceneAddress | null {
    const { ep, sec, scene } = _current;

    if (scene === 1) {
        // sec 1 のシーン 1 のみ ep タイトルカードへ。sec > 1 は前 sec の最後のシーンへ
        if (sec === 1) return { ep, sec, scene: 0 };
        const prev = findPrevPublishedSec(ep, sec);
        if (prev === null) return null;
        return { ...prev, scene: LAST_SCENE };
    }

    if (scene > 1) {
        return { ep, sec, scene: scene - 1 };
    }

    // タイトルカード（scene === 0）→ 前 sec の最後のシーン
    const prev = findPrevPublishedSec(ep, sec);
    if (prev === null) return null;
    return { ...prev, scene: LAST_SCENE };
}

/**
 * menu.ts 用。現在位置に関係なく、前の公開済み sec のタイトルカードへ。なければ null。
 * getPrev() とは異なり、シーン位置を無視して sec 単位で移動する。
 */
export function getPrevSecAddress(): SceneAddress | null {
    const prev = findPrevPublishedSec(_current.ep, _current.sec);
    return prev ? { ...prev, scene: 0 } : null;
}

/**
 * menu.ts 用。現在位置に関係なく、次の公開済み sec のタイトルカードへ。なければ null。
 * getNext() とは異なり、シーン位置を無視して sec 単位で移動する。
 */
export function getNextSecAddress(): SceneAddress | null {
    return findNextPublishedSec(_current.ep, _current.sec);
}

/** transition.ts が遷移完了後に呼ぶ */
export function setCurrent(address: SceneAddress): void {
    _current = { ...address };
}

/** SceneAddress → "#01-02-03" */
export function toHash(address: SceneAddress): string {
    const { ep, sec, scene } = address;
    return `#${pad(ep)}-${pad(sec)}-${pad(scene)}`;
}

/**
 * "#01-02-03" → SceneAddress。不正値なら null。
 * ep / sec は 1〜99、scene は 0〜99 の範囲を有効とする。
 */
export function parseHash(hash: string): SceneAddress | null {
    const match = hash.match(/^#(\d{2})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const ep = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const scene = parseInt(match[3], 10);
    if (ep < 1 || ep > 99 || sec < 1 || sec > 99 || scene < 0 || scene > 99) return null;
    return { ep, sec, scene };
}

// ---- private helpers ----

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** 指定 ep/sec より後の最初の公開済み sec のタイトルカードアドレスを返す。なければ null */
function findNextPublishedSec(ep: number, sec: number): SceneAddress | null {
    for (const episode of _data) {
        if (episode.id < ep) continue;
        for (const section of episode.sections) {
            if (episode.id === ep && section.id <= sec) continue;
            if (section.published) {
                return { ep: episode.id, sec: section.id, scene: 0 };
            }
        }
    }
    return null;
}

/** 指定 ep/sec より前の最後の公開済み sec を返す。なければ null */
function findPrevPublishedSec(ep: number, sec: number): { ep: number; sec: number } | null {
    let result: { ep: number; sec: number } | null = null;
    outer: for (const episode of _data) {
        if (episode.id > ep) break;
        for (const section of episode.sections) {
            if (episode.id === ep && section.id >= sec) break outer;
            if (section.published) {
                result = { ep: episode.id, sec: section.id };
            }
        }
    }
    return result;
}
