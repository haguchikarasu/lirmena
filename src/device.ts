/*
 * device.ts
 * 責務: 端末カテゴリ（PC/スマホ）の判定と <html data-device> 属性の管理。
 *       CSS 側で「1px の見た目の大きさ＝視距離」に応じた文字サイズ・本文帯幅・帯マージンを分岐させるための
 *       単一の真実源。判定は matchMedia('(pointer: coarse)')：タッチ端末＝手持ち＝視距離が近い、を代理指標にする。
 *       axis.ts が書字方向の真実源（<html data-writing-mode>）を独占するのと対称の設計。
 *
 * export:
 *   init(callbacks?): void                          … 初期属性を反映し matchMedia の change を購読する
 *                                                     onDeviceChange: 端末カテゴリが実際に変わったとき呼ぶ
 *   getDevice(): Device                             … 現在値（'pc' | 'sp'）を返す
 *   detect(): Device                                … matchMedia を評価して 'pc' | 'sp' を返す（純関数）
 *
 * 依存: なし（DOM 読み書きと matchMedia のみ。他モジュール非依存のリーフ）。
 * 結線: FOUC 回避のため、シェル HTML の <head> インラインスクリプトが CSS 適用前に data-device を先付けする
 *       （src/device.ts と同じ判定式を最小コピー：`matchMedia('(pointer: coarse)').matches ? 'sp' : 'pc'`）。
 *       init() は同じ属性を JS 経由で再反映しつつ、change リスナで実行時切替（DevTools のデバイスモード等）に追従する。
 */

export type Device = 'pc' | 'sp';

const MEDIA_QUERY = '(pointer: coarse)';

let _current: Device = 'pc';
let _onChange: (device: Device) => void = () => {};
let _mql: MediaQueryList | null = null;

// matchMedia を評価して 'sp' | 'pc' を返す。matchMedia が使えない環境（古い JSDOM 等）は 'pc' にフォールバック。
// detect(): Device
export function detect(): Device {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'pc';
    return window.matchMedia(MEDIA_QUERY).matches ? 'sp' : 'pc';
}

// 現在値を返す（init 前は既定 'pc'）。
// getDevice(): Device
export function getDevice(): Device {
    return _current;
}

// <html data-device> を反映し、matchMedia の change を購読する。
// callbacks.onDeviceChange は端末カテゴリが**実際に**変わったときだけ呼ぶ（連続同値の change イベントは無視）。
// init(callbacks?: { onDeviceChange?: (device: Device) => void }): void
export function init(callbacks?: { onDeviceChange?: (device: Device) => void }): void {
    if (callbacks?.onDeviceChange) _onChange = callbacks.onDeviceChange;
    _current = detect();
    document.documentElement.setAttribute('data-device', _current);
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    _mql = window.matchMedia(MEDIA_QUERY);
    // 古い iOS/Safari（13 以前）は MediaQueryList.addEventListener を持たず addListener のみ。
    // addEventListener を優先し、無ければ addListener にフォールバックする（無ガードだと init が throw して bootstrap ごと落ちる）。
    if (typeof _mql.addEventListener === 'function') {
        _mql.addEventListener('change', _handleChange);
    } else if (typeof _mql.addListener === 'function') {
        _mql.addListener(_handleChange);
    }
}

// matchMedia の change リスナ。値が変わったときだけ属性反映＋コールバック起動。
// _handleChange(): void
function _handleChange(): void {
    const next = detect();
    if (next === _current) return;
    _current = next;
    document.documentElement.setAttribute('data-device', _current);
    _onChange(_current);
}
