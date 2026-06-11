/*
 * state.ts
 * 【責務】episodes.json データ保持と、自ページ（固定 ep/sec）からの sec 単位ナビゲーション計算。
 *         マルチページ化に伴い URL ハッシュの生成・パースおよび scene 単位の遷移計算は撤去した。
 *         ページ境界の移動先は「相対 URL（contents/ 配下の本文／タイトルページ・目次）」で返す。
 * 【IF】
 *   init(data: EpisodesData, address: SecAddress): void   自ページの ep/sec を確定（現在シーンは 0 から開始）
 *   setCurrentScene(scene: number): void                  reader.ts が bg の通知を受けて現在シーン（1-indexed）を反映
 *   getCurrent(): SceneAddress                            { ep, sec, scene }（scene は reader が更新する導出値）
 *   getEpTitle(ep: number): string | undefined
 *   getEpisode(ep: number): Episode | undefined
 *   getSection(ep: number, sec: number): EpisodeSection | undefined
 *   isPublished(ep: number, sec: number): boolean
 *   indexUrl(): string                                    目次ページへの相対 URL（'../index.html'）
 *   getBodyUrl(ep: number, sec: number): string          任意 ep/sec の本文ページ相対 URL（menu「続きから読む」用）
 *   getNextUrl(): string | null                          進行ボタン用。次 sec 本文／ep 境界は次 ep タイトル／無ければ null
 *   getPrevUrl(): string | null                          戻るボタン用（本文ページ）。前 sec 本文／先頭 sec は当 ep タイトル
 *   getTitleEnterUrl(): string | null                    タイトル「本文を読む」用。当 ep 先頭公開 sec の本文ページ
 *   getTitlePrevUrl(): string | null                     タイトル「戻る」用。前 ep の最終公開 sec の本文ページ（無ければ null）
 *   getTitlePrevAddress(): SecAddress | null             タイトル「戻る」遷移先の ep/sec（終端スクロールフラグ書込用）
 * 【依存】types.ts（型のみ）
 * 【被依存】main / title / nav / menu
 * 【注意】返す URL は contents/ 配下のページ（contents/[ep]-[sec].html など）から参照できる相対パス。
 *         本文・タイトルページは同一ディレクトリのため兄弟ページは "[ep]-[sec].html"、目次は "../index.html"。
 */

import type { EpisodesData, Episode, EpisodeSection, SecAddress, SceneAddress } from './types';

let _data: EpisodesData = [];
let _current: SecAddress = { ep: 1, sec: 1 };
let _scene = 0;

/** main / title が episodes.json ロード後・自ページの ep/sec を確定するために一度だけ呼ぶ */
export function init(data: EpisodesData, address: SecAddress): void {
    _data = data;
    _current = { ...address };
    _scene = 0;
}

/** reader.ts が bg.ts のスクロール通知を受けて現在シーン（1-indexed）を反映する */
export function setCurrentScene(scene: number): void {
    _scene = scene;
}

/** 現在位置を返す。scene はページ内スクロールから導出された現在シーン（reader が更新） */
export function getCurrent(): SceneAddress {
    return { ..._current, scene: _scene };
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
    return _data.find(e => e.id === ep)?.sections.find(s => s.id === sec)?.published ?? false;
}

/** 目次ページへの相対 URL（contents/ 配下のページから1階層上がる） */
export function indexUrl(): string {
    return '../index.html';
}

/** 任意 ep/sec の本文ページ相対 URL。menu「続きから読む」がオートセーブの ep/sec から遷移先を得るのに使う */
export function getBodyUrl(ep: number, sec: number): string {
    return _bodyPath(ep, sec);
}

/**
 * 進行ボタンの遷移先 URL。次が無ければ null（呼び出し元が「目次へ戻る」へフォールバックする）。
 * - 同一 ep に次の公開 sec があれば → その本文ページ
 * - 当 ep の最後の公開 sec なら → 次 ep に公開 sec があれば次 ep のタイトルページ、無ければ null
 *   （未公開 sec は ep 末尾にのみ存在する前提。ギャップ越えは扱わない）
 */
export function getNextUrl(): string | null {
    const nextSec = _nextPublishedSecInEp(_current.ep, _current.sec);
    if (nextSec !== null) return _bodyPath(_current.ep, nextSec);

    const nextEp = _nextEpInList(_current.ep);
    if (nextEp !== null && _firstPublishedSec(nextEp) !== null) return _titlePath(nextEp);
    return null;
}

/**
 * 戻るボタン（本文ページ）の遷移先 URL。
 * - 同一 ep に前の公開 sec があれば → その本文ページ
 * - 当 ep の先頭公開 sec なら → 当 ep のタイトルページ
 * 本文ページでは常に遷移先がある（最低でも当 ep タイトル）ため null を返さない。
 */
export function getPrevUrl(): string | null {
    const prevSec = _prevPublishedSecInEp(_current.ep, _current.sec);
    if (prevSec !== null) return _bodyPath(_current.ep, prevSec);
    return _titlePath(_current.ep);
}

/** タイトル「本文を読む」の遷移先。当 ep の先頭公開 sec の本文ページ。公開 sec が無ければ null */
export function getTitleEnterUrl(): string | null {
    const first = _firstPublishedSec(_current.ep);
    return first === null ? null : _bodyPath(_current.ep, first);
}

/** タイトル「戻る」の遷移先。前の（公開 sec を持つ）ep の最終公開 sec の本文ページ。無ければ null（ep1 等） */
export function getTitlePrevUrl(): string | null {
    const addr = getTitlePrevAddress();
    return addr === null ? null : _bodyPath(addr.ep, addr.sec);
}

/** タイトル「戻る」遷移先の ep/sec。終端スクロールフラグの書込に使う。無ければ null（ep1 等） */
export function getTitlePrevAddress(): SecAddress | null {
    const prevEp = _prevEpWithPublished(_current.ep);
    if (prevEp === null) return null;
    const last = _lastPublishedSec(prevEp);
    return last === null ? null : { ep: prevEp, sec: last };
}

// ---- private helpers ----

function _pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** 本文ページの相対 URL（同一ディレクトリ） */
function _bodyPath(ep: number, sec: number): string {
    return `${_pad(ep)}-${_pad(sec)}.html`;
}

/** タイトルページの相対 URL（同一ディレクトリ） */
function _titlePath(ep: number): string {
    return `${_pad(ep)}-00.html`;
}

/** 同一 ep 内で sec より後の最初の公開 sec id。無ければ null */
function _nextPublishedSecInEp(ep: number, sec: number): number | null {
    const episode = _data.find(e => e.id === ep);
    if (!episode) return null;
    for (const s of episode.sections) {
        if (s.id > sec && s.published) return s.id;
    }
    return null;
}

/** 同一 ep 内で sec より前の最後の公開 sec id。無ければ null */
function _prevPublishedSecInEp(ep: number, sec: number): number | null {
    const episode = _data.find(e => e.id === ep);
    if (!episode) return null;
    let result: number | null = null;
    for (const s of episode.sections) {
        if (s.id >= sec) break;
        if (s.published) result = s.id;
    }
    return result;
}

/** ep の先頭公開 sec id。無ければ null */
function _firstPublishedSec(ep: number): number | null {
    const episode = _data.find(e => e.id === ep);
    return episode?.sections.find(s => s.published)?.id ?? null;
}

/** ep の最終公開 sec id。無ければ null */
function _lastPublishedSec(ep: number): number | null {
    const episode = _data.find(e => e.id === ep);
    if (!episode) return null;
    let result: number | null = null;
    for (const s of episode.sections) {
        if (s.published) result = s.id;
    }
    return result;
}

/** _data の並び順で ep の直後の ep id。無ければ null */
function _nextEpInList(ep: number): number | null {
    const idx = _data.findIndex(e => e.id === ep);
    if (idx === -1 || idx + 1 >= _data.length) return null;
    return _data[idx + 1].id;
}

/** _data の並び順で ep より前の、公開 sec を持つ最も近い ep id。無ければ null */
function _prevEpWithPublished(ep: number): number | null {
    const idx = _data.findIndex(e => e.id === ep);
    if (idx === -1) return null;
    for (let i = idx - 1; i >= 0; i--) {
        if (_data[i].sections.some(s => s.published)) return _data[i].id;
    }
    return null;
}
