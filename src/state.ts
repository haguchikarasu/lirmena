/*
 * state.ts
 * 【責務】story.json データ保持と、自ページ（本文 sec モード／あとがきモード）からのナビゲーション計算。
 *         マルチページ化に伴い URL ハッシュの生成・パースおよび scene 単位の遷移計算は撤去した。
 *         ページ境界の移動先は「相対 URL（contents/ 配下の本文／タイトル／あとがき／目次）」で返す。
 * 【IF】
 *   init(story: StoryData, address: SecAddress): void      本文モードで初期化（自 ep/sec 確定・scene は 0 開始）
 *   initAfterword(story: StoryData, vol: number): void     あとがきモードで初期化（自 vol 確定・scene は 0 開始）
 *   getMode(): 'sec' | 'afterword'                          現ページのモード
 *   setCurrentScene(scene: number): void                    reader.ts が bg の通知を受けて現在シーン（1-indexed）を反映
 *   getCurrent(): SceneAddress                              { ep, sec, scene }（本文モード時。あとがき時は ep/sec=0）
 *   getEpTitle(ep: number): string | undefined
 *   getEpisode(ep: number): Episode | undefined
 *   getSection(ep, sec): EpisodeSection | undefined
 *   isPublished(ep, sec): boolean
 *   indexUrl(): string                                      目次ページへの相対 URL（'../'）
 *   getBodyUrl(ep, sec): string                            任意 ep/sec の本文ページ相対 URL（menu「続きから読む」用）
 *   getNextUrl(): string | null                             本文モード：次 sec 本文／ep 境界は次 ep タイトル／無ければ null
 *   getPrevUrl(): string | null                             本文モード：前 sec 本文／先頭 sec は当 ep タイトル
 *   getPrevAddress(): SecAddress | null                     本文モード：戻る遷移先が前 sec のときの ep/sec（本文末着地フラグ書込用）
 *   getPrevPublishedSec(): SecAddress | null                本文モード：物語順で一つ前の公開 sec（ep 境界を跨ぐ）
 *   getTitleEnterUrl(): string | null                       タイトル「本文を読む」用。当 ep 先頭公開 sec の本文ページ
 *   getTitlePrevUrl(): string | null                        タイトル「戻る」用。前 ep の最終公開 sec の本文ページ（無ければ null）
 *   getTitlePrevAddress(): SecAddress | null                タイトル「戻る」遷移先の ep/sec（終端スクロールフラグ書込用）
 *   getCurrentVolume(): Volume | undefined                  現ページ（本文 ep または あとがき vol）が属する Volume
 *   getShareContext(): ShareContext                         feedback.ts 用 { kind:'sec',ep,sec } / { kind:'afterword',vol }
 *   getAfterwordUrlIfEndOfVolume(): string | null           本文モード：自 vol の巻末公開 sec かつ afterword.published なら vol[XX]-afterword.html
 *   getAfterwordUrl(vol): string                            vol の巻末あとがきページの相対 URL（vol[XX]-afterword.html）
 *   getAfterwordNextUrl(): string | null                    あとがきモード：次巻タイトルページ URL（sec01 は ep 扉経由の正典を維持）
 *   getAfterwordPrevAddress(): SecAddress | null            あとがきモード：自 vol の巻末公開 sec（pendingScrollEnd 書込用）
 *   getCurrentAfterwordVol(): number | null                 あとがきモード時の vol 番号
 * 【依存】types.ts（型のみ）
 * 【被依存】main / title / nav / menu / feedback / opening
 * 【注意】返す URL は contents/ 配下のページ（contents/[ep]-[sec].html など）から参照できる相対パス。
 *         本文・タイトル・あとがきは同一ディレクトリ、目次は "../"（ディレクトリ index を暗黙参照）。
 *         クエリ文字列（例 "?noga"）は _withQuery が現在ページから引き継ぐ。
 * 【あとがき「次へ」の遷移先設計】
 *   次巻の sec01 本文ページに直接遷移せず、次巻タイトルページ経由（[epRange[0]2桁]-00.html）にする。
 *   要件「sec01 は ep 扉を経由させる／ep 境界はタイトルページへ」を維持することで、
 *   目次からのフルナビゲーションと同じ動線を保つ（変更履歴・扉背景をスキップしない）。
 */

import type {
    StoryData,
    Volume,
    EpisodesData,
    Episode,
    EpisodeSection,
    SecAddress,
    SceneAddress,
    ShareContext,
} from './types';

let _story: StoryData = [];
let _data: EpisodesData = []; // 派生キャッシュ：story.flatMap(v => v.episodes)。既存 API から O(1) で ep 探索するため
let _mode: 'sec' | 'afterword' = 'sec';
let _current: SecAddress = { ep: 1, sec: 1 };
let _currentVol = 0; // あとがきモード時のみ意味を持つ
let _scene = 0;

/** 本文モードで初期化する。main.ts / title.ts が story.json ロード後に一度だけ呼ぶ */
export function init(story: StoryData, address: SecAddress): void {
    _story = story;
    _data = story.flatMap(v => v.episodes);
    _mode = 'sec';
    _current = { ep: address.ep, sec: address.sec };
    _currentVol = 0;
    _scene = 0;
}

/** あとがきモードで初期化する。main.ts があとがきページ判定後に呼ぶ */
export function initAfterword(story: StoryData, vol: number): void {
    _story = story;
    _data = story.flatMap(v => v.episodes);
    _mode = 'afterword';
    _current = { ep: 0, sec: 0 };
    _currentVol = vol;
    _scene = 0;
}

/** 現ページのモード */
export function getMode(): 'sec' | 'afterword' {
    return _mode;
}

/** reader.ts が bg.ts のスクロール通知を受けて現在シーン（1-indexed）を反映する */
export function setCurrentScene(scene: number): void {
    _scene = scene;
}

/** 現在位置を返す（本文モード用）。あとがきモードでは ep/sec=0 */
export function getCurrent(): SceneAddress {
    return { ..._current, scene: _scene };
}

/** ep のタイトル */
export function getEpTitle(ep: number): string | undefined {
    return _data.find(e => e.id === ep)?.title;
}

/** Episode オブジェクトを返す */
export function getEpisode(ep: number): Episode | undefined {
    return _data.find(e => e.id === ep);
}

/** EpisodeSection オブジェクトを返す */
export function getSection(ep: number, sec: number): EpisodeSection | undefined {
    return _data.find(e => e.id === ep)?.sections.find(s => s.id === sec);
}

/** 指定 ep/sec が公開済みか */
export function isPublished(ep: number, sec: number): boolean {
    return _data.find(e => e.id === ep)?.sections.find(s => s.id === sec)?.published ?? false;
}

/** 目次ページへの相対 URL（contents/ 配下から1階層上がる） */
export function indexUrl(): string {
    return _withQuery('../');
}

/** 任意 ep/sec の本文ページ相対 URL（menu「続きから読む」用） */
export function getBodyUrl(ep: number, sec: number): string {
    return _bodyPath(ep, sec);
}

/** 進行ボタンの遷移先 URL（本文モード）。次が無ければ null */
export function getNextUrl(): string | null {
    const nextSec = _nextPublishedSecInEp(_current.ep, _current.sec);
    if (nextSec !== null) return _bodyPath(_current.ep, nextSec);

    const nextEp = _nextEpInList(_current.ep);
    if (nextEp !== null && _firstPublishedSec(nextEp) !== null) return _titlePath(nextEp);
    return null;
}

/** 戻るボタン（本文モード）の遷移先 URL */
export function getPrevUrl(): string | null {
    const prevSec = _prevPublishedSecInEp(_current.ep, _current.sec);
    if (prevSec !== null) return _bodyPath(_current.ep, prevSec);
    return _titlePath(_current.ep);
}

/** 戻る遷移先が「前 sec の本文ページ」のときの ep/sec（先頭 sec は null） */
export function getPrevAddress(): SecAddress | null {
    const prevSec = _prevPublishedSecInEp(_current.ep, _current.sec);
    return prevSec === null ? null : { ep: _current.ep, sec: prevSec };
}

/** 物語順で一つ前の公開 sec（ep 境界を跨ぐ）。外部流入抑止判定の材料 */
export function getPrevPublishedSec(): SecAddress | null {
    const prevSec = _prevPublishedSecInEp(_current.ep, _current.sec);
    if (prevSec !== null) return { ep: _current.ep, sec: prevSec };
    const prevEp = _prevEpWithPublished(_current.ep);
    if (prevEp === null) return null;
    const last = _lastPublishedSec(prevEp);
    return last === null ? null : { ep: prevEp, sec: last };
}

/** タイトル「本文を読む」の遷移先。当 ep の先頭公開 sec の本文ページ。公開 sec が無ければ null */
export function getTitleEnterUrl(): string | null {
    const first = _firstPublishedSec(_current.ep);
    return first === null ? null : _bodyPath(_current.ep, first);
}

/** タイトル「戻る」の遷移先。前の公開 ep の最終公開 sec の本文ページ */
export function getTitlePrevUrl(): string | null {
    const addr = getTitlePrevAddress();
    return addr === null ? null : _bodyPath(addr.ep, addr.sec);
}

/** タイトル「戻る」遷移先の ep/sec（終端スクロールフラグ書込用） */
export function getTitlePrevAddress(): SecAddress | null {
    const prevEp = _prevEpWithPublished(_current.ep);
    if (prevEp === null) return null;
    const last = _lastPublishedSec(prevEp);
    return last === null ? null : { ep: prevEp, sec: last };
}

/** 現ページが属する Volume（本文 ep の含まれる vol／あとがきの vol）。無ければ undefined */
export function getCurrentVolume(): Volume | undefined {
    if (_mode === 'afterword') {
        return _story.find(v => v.volume === _currentVol);
    }
    return _story.find(v => _current.ep >= v.epRange[0] && _current.ep <= v.epRange[1]);
}

/** feedback.ts 用の共有コンテキスト */
export function getShareContext(): ShareContext {
    if (_mode === 'afterword') return { kind: 'afterword', vol: _currentVol };
    return { kind: 'sec', ep: _current.ep, sec: _current.sec };
}

/**
 * 本文モードで、現ページが自 vol の巻末公開 sec かつ afterword.published なら、
 * その vol のあとがきページ URL（同一ディレクトリの vol[XX]-afterword.html）を返す。それ以外は null。
 * nav.ts が「次へ」ボタンの直後に「◯巻あとがき」ボタンを出すかの判定に使う。
 */
export function getAfterwordUrlIfEndOfVolume(): string | null {
    if (_mode !== 'sec') return null;
    const vol = getCurrentVolume();
    if (!vol) return null;
    if (vol.afterword?.published !== true) return null;

    // 現在の ep/sec が「この vol の中で物語順最後の公開 sec」か判定する
    const lastAddr = _findVolLastPublishedAddress(vol);
    if (lastAddr === null) return null;
    if (lastAddr.ep !== _current.ep || lastAddr.sec !== _current.sec) return null;

    return _afterwordPath(vol.volume);
}

/** vol の巻末あとがきページ相対 URL（vol[XX]-afterword.html） */
export function getAfterwordUrl(vol: number): string {
    return _afterwordPath(vol);
}

/**
 * あとがきモードの「次へ」遷移先 URL。次巻のタイトルページ（[epRange[0]2桁]-00.html）を返す。
 * 次巻が無い（最終 vol のあとがき）または次巻に公開 sec が無ければ null（目次へフォールバック）。
 * 正典「sec01 は ep 扉経由／ep 境界はタイトルページ」を維持するため sec1 本文へ直遷移しない。
 */
export function getAfterwordNextUrl(): string | null {
    if (_mode !== 'afterword') return null;
    const nextVol = _findNextVolume(_currentVol);
    if (!nextVol) return null;
    const firstEpId = nextVol.epRange[0];
    if (_firstPublishedSec(firstEpId) === null) return null;
    return _titlePath(firstEpId);
}

/**
 * あとがきモードの「戻る」で pendingScrollEnd に書く前 sec 位置。自 vol の巻末公開 sec。
 * nav.goPrev で「本文末着地」させる導線に使う。無ければ null（目次へフォールバック）。
 */
export function getAfterwordPrevAddress(): SecAddress | null {
    if (_mode !== 'afterword') return null;
    const vol = _story.find(v => v.volume === _currentVol);
    if (!vol) return null;
    return _findVolLastPublishedAddress(vol);
}

/** あとがきモード時の vol 番号。それ以外は null */
export function getCurrentAfterwordVol(): number | null {
    return _mode === 'afterword' ? _currentVol : null;
}

// ---- private helpers ----

function _pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** 現在ページのクエリ文字列（例 "?noga"）を相対 URL に引き継ぐ */
function _withQuery(path: string): string {
    return path + location.search;
}

/** 本文ページ URL（同一ディレクトリ） */
function _bodyPath(ep: number, sec: number): string {
    return _withQuery(`${_pad(ep)}-${_pad(sec)}.html`);
}

/** タイトルページ URL（同一ディレクトリ） */
function _titlePath(ep: number): string {
    return _withQuery(`${_pad(ep)}-00.html`);
}

/** あとがきページ URL（同一ディレクトリ） */
function _afterwordPath(vol: number): string {
    return _withQuery(`vol${_pad(vol)}-afterword.html`);
}

/** 同一 ep 内で sec より後の最初の公開 sec id */
function _nextPublishedSecInEp(ep: number, sec: number): number | null {
    const episode = _data.find(e => e.id === ep);
    if (!episode) return null;
    for (const s of episode.sections) {
        if (s.id > sec && s.published) return s.id;
    }
    return null;
}

/** 同一 ep 内で sec より前の最後の公開 sec id */
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

/** ep の先頭公開 sec id */
function _firstPublishedSec(ep: number): number | null {
    const episode = _data.find(e => e.id === ep);
    return episode?.sections.find(s => s.published)?.id ?? null;
}

/** ep の最終公開 sec id */
function _lastPublishedSec(ep: number): number | null {
    const episode = _data.find(e => e.id === ep);
    if (!episode) return null;
    let result: number | null = null;
    for (const s of episode.sections) {
        if (s.published) result = s.id;
    }
    return result;
}

/** _data の並び順で ep の直後の ep id */
function _nextEpInList(ep: number): number | null {
    const idx = _data.findIndex(e => e.id === ep);
    if (idx === -1 || idx + 1 >= _data.length) return null;
    return _data[idx + 1].id;
}

/** _data の並び順で ep より前の、公開 sec を持つ最も近い ep id */
function _prevEpWithPublished(ep: number): number | null {
    const idx = _data.findIndex(e => e.id === ep);
    if (idx === -1) return null;
    for (let i = idx - 1; i >= 0; i--) {
        if (_data[i].sections.some(s => s.published)) return _data[i].id;
    }
    return null;
}

/** vol 内で物語順最後の公開 sec の { ep, sec }。無ければ null */
function _findVolLastPublishedAddress(vol: Volume): SecAddress | null {
    const eps = [...vol.episodes].sort((a, b) => b.id - a.id); // ep 降順
    for (const ep of eps) {
        const secs = [...ep.sections].sort((a, b) => b.id - a.id); // sec 降順
        for (const sec of secs) {
            if (sec.published) return { ep: ep.id, sec: sec.id };
        }
    }
    return null;
}

/** volume の直後の Volume（volume 昇順で次） */
function _findNextVolume(currentVolume: number): Volume | undefined {
    const sorted = [..._story].sort((a, b) => a.volume - b.volume);
    const idx = sorted.findIndex(v => v.volume === currentVolume);
    if (idx === -1 || idx + 1 >= sorted.length) return undefined;
    return sorted[idx + 1];
}
