/*
 * page-meta.ts
 * 責務: 生成ページ（本文・タイトル・あとがき）の題（<title> と og:title に入る文字）を story.json の値から組み立て、
 *       雛形の差し込み口へ埋める純関数。DOM もファイルも触らない。
 * export:
 *   WORK_TITLE: string                                    … 作品名「輝くもの《リルメナ》」（題の後ろに付ける）
 *   sectionPageTitle(ep: EpisodeForTitle, sec: number): string … 本文ページ「第2話 #3 話名｜作品名」
 *   episodePageTitle(ep: EpisodeForTitle): string         … タイトルページ「第2話 話名｜作品名」
 *   afterwordPageTitle(vol: number): string               … あとがき「第1巻 あとがき｜作品名」
 *   escapeHtml(s: string): string                         … & < > " を実体参照にする
 *   fillPageMeta(tpl: string, title: string, file: string): string
 *       … 雛形の {{pageTitle}}（エスケープして埋める）と {{pageFile}}（contents/ の中のファイル名）を全箇所埋める
 * 依存: ruby.ts（plainRuby）、types.ts（型だけ）
 * 呼び出し元: vite.config.ts の pages() だけ（実行時のバンドルには入らない）
 *
 * - 形は「ページ固有の語｜作品名」。固有の語を先頭に置く（タブは先頭から切れる。資料ページの「人物｜…」と同じ形）。
 * - 話数と節の書き方は目次・共有文と同じ（「第2話 #3」。ゼロ埋めしない）。
 * - 話名のルビは親文字だけにする（<title> に要素は置けない。目次の aria-label と同じ扱い）。
 * - 話に公開済みの節が 1 つも無いあいだは話名を入れない（ページは未公開でも生成されるので、題から話名が先に漏れる）。
 *   公開済みの節が 1 つでもあれば話名は目次に出ているので、その話の未公開の節のページにも入れる。
 * - 文言は作者のレビューで決めた（2026-11-27。要件 07）。
 */

import { plainRuby } from './ruby';
import type { Episode } from './types';

export const WORK_TITLE = '輝くもの《リルメナ》';

/** 題を組み立てるのに使う話の項目 */
export type EpisodeForTitle = Pick<Episode, 'id' | 'title' | 'sections'>;

// 題に入れてよい話名（ルビを外したもの）。入れないときは空文字。
// _epName(ep: EpisodeForTitle): string
function _epName(ep: EpisodeForTitle): string {
    if (!ep.sections.some(s => s.published)) return '';
    return plainRuby(ep.title).trim();
}

// 固有の語の後ろに作品名を付ける。
// _withWork(head: string): string
function _withWork(head: string): string {
    return `${head}｜${WORK_TITLE}`;
}

// 本文ページの題。
// sectionPageTitle(ep: EpisodeForTitle, sec: number): string
export function sectionPageTitle(ep: EpisodeForTitle, sec: number): string {
    const name = _epName(ep);
    return _withWork(name ? `第${ep.id}話 #${sec} ${name}` : `第${ep.id}話 #${sec}`);
}

// タイトルページ（話の扉）の題。
// episodePageTitle(ep: EpisodeForTitle): string
export function episodePageTitle(ep: EpisodeForTitle): string {
    const name = _epName(ep);
    return _withWork(name ? `第${ep.id}話 ${name}` : `第${ep.id}話`);
}

// あとがきページの題。
// afterwordPageTitle(vol: number): string
export function afterwordPageTitle(vol: number): string {
    return _withWork(`第${vol}巻 あとがき`);
}

// HTML の文字と属性値（二重引用符で囲んだもの）に入れられる形にする。
// escapeHtml(s: string): string
export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 雛形の差し込み口を埋める。置換後の文字は関数で渡す（話名に $ があっても置換の記法として解釈させない）。
// fillPageMeta(tpl: string, title: string, file: string): string
export function fillPageMeta(tpl: string, title: string, file: string): string {
    const escaped = escapeHtml(title);
    return tpl
        .replace(/\{\{pageTitle\}\}/g, () => escaped)
        .replace(/\{\{pageFile\}\}/g, () => file);
}
