/*
 * feedback.ts
 * 【責務】本文末の感想窓口ボタン群（Ｘで感想をポスト / マシュマロを送る）に外部サービス URL を載せて
 *         表示可にする。Phase 1 の「感想窓口・SNS共有」（要件 06-13）を担う受動モジュール。
 *         クリックはブラウザ既定の新規タブ遷移に委ねる（target="_blank" rel="noopener noreferrer"
 *         はシェル側で付与）。マシュマロ URL は本モジュール所有の定数で、menu.ts の共有ポップアップも
 *         この定数を import して使う（URL の二重管理を避けるため）。
 * 【IF】
 *   init(): void                       #btn-share-x と #btn-share-marshmallow に URL を載せ、
 *                                       wrapper #btn-share-group の hidden を外して感想窓口ブロックを表示する
 *   MARSHMALLOW_URL: string            マシュマロ（作品全体で1箱）の URL。menu.ts が共有ポップアップで使う
 * 【依存】state.ts（getCurrent() で自ページの ep/sec 取得）
 * 【被依存】main.ts（init 呼び出し）／menu.ts（MARSHMALLOW_URL 参照）
 * 【注意】
 *   - X の text は `✨輝くもの《リルメナ》✨第{ep}話 #{sec}\n{URL}` の固定フォーマット（改行区切りで
 *     text 一本化。url パラメータは使わない＝X 側で改行を保つため）。作品名は固定文字列・ep/sec 番号は
 *     ゼロ埋めしない。episodes.json の話タイトルは参照しない（ルビ記法など SNS で崩れる表現を避け、
 *     疎結合を保つため）。URL は `location.origin + location.pathname`（?noga 等の開発クエリを落として
 *     自ページの正規 URL）。dev/local 環境で押した場合はローカル URL が入るが、共有ボタンは本番閲覧者が
 *     押す前提。
 *   - マシュマロは sec 単位の紐付けを持たない（マシュマロが1アカウント1箱の仕様のため）。作品全体で
 *     1つの外部 URL を新規タブで開くだけの受動リンク。
 *   - hidden の管理は wrapper #btn-share-group に一本化する（内部の <a> には hidden を付けない）。
 *     wrapper が hidden の間は感想窓口ブロックごと非表示になり、init 呼び出し後に hidden を外す。
 *   - 対象要素が存在しないページ（title.html には置かない）でも init は個別に no-op で安全に通る。
 */

import * as state from './state';

const WORK_TITLE = '輝くもの《リルメナ》';

// 感想窓口（マシュマロ）：作品全体で1箱。menu.ts の共有ポップアップも同じ URL を使う（重複定義を避ける）
export const MARSHMALLOW_URL = 'https://marshmallow-qa.com/knypdfetjipklfe';

// #btn-share-x（Ｘで感想をポスト）と #btn-share-marshmallow（マシュマロを送る）に href を載せ、
// wrapper #btn-share-group の hidden を外して感想窓口ブロックを表示する。
// 要素が無ければ個別に no-op（title.html のように何も置かないページでも安全に通る）。
// init(): void
export function init(): void {
    _initShareX();
    _initMarshmallow();
    _revealGroup();
}

// #btn-share-x に X の intent URL を載せる。要素が無ければ no-op。
// text と URL は改行で区切って text パラメータに一本化する（url パラメータで別送りにするとスペース連結になり
// 改行が入らない。text 内に \n＝%0A で書けば投稿画面で改行される。URL カード表示は text 内 URL でも同等に働く）
// _initShareX(): void
function _initShareX(): void {
    const btn = document.querySelector<HTMLAnchorElement>('#btn-share-x');
    if (!btn) return;
    const { ep, sec } = state.getCurrent();
    const url = location.origin + location.pathname;
    const text = `✨${WORK_TITLE}✨第${ep}話 #${sec}\n${url}`;
    btn.href = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

// #btn-share-marshmallow にマシュマロ URL を載せる。要素が無ければ no-op。
// _initMarshmallow(): void
function _initMarshmallow(): void {
    const btn = document.querySelector<HTMLAnchorElement>('#btn-share-marshmallow');
    if (!btn) return;
    btn.href = MARSHMALLOW_URL;
}

// #btn-share-group の hidden を外して感想窓口ブロック全体を表示する。要素が無ければ no-op。
// hidden 管理は wrapper に一本化されており、内部 <a> の hidden は触らない。
// _revealGroup(): void
function _revealGroup(): void {
    const group = document.querySelector<HTMLElement>('#btn-share-group');
    if (!group) return;
    group.hidden = false;
}
