/*
 * story-integrity.ts
 * 責務: story.json の整合を検査する純関数群。build 時（vite.config.ts の pages() プラグイン）と
 *       runtime 時（volumes.test.ts / story.test.ts）で共有する。
 * export: validateStory(story: StoryData): string[]     — 純データ検査 (a)〜(h)
 *         validateStoryFiles(story, opts): string[]    — (i) を含む合成版（fs 実在を opts で注入）
 * 依存: 型のみ（StoryData / Volume）。fs / DOM / localStorage 非依存。純関数（引数を破壊しない）。
 *
 * 検査項目：
 *   (a) 各 vol.epRange 内の ep.id のみ vol.episodes に含める。範囲内は epRange[0] から連続で
 *       欠けなく並ぶこと（末尾からの欠落＝未執筆 ep は許容。中間の飛びは NG）。
 *   (b) 隣接 vol の epRange が連続・重複しない（vol[i].epRange[1] + 1 === vol[i+1].epRange[0]）
 *   (c) vol は volume 昇順で書かれる
 *   (d) 各 ep.sections は id 昇順で並び、未公開 sec は末尾にのみ配置される
 *   (e) afterword.published=true → その vol の全 ep 全 sec が published=true、かつ epRange 全域が
 *       episodes に定義されていること（未執筆 ep が残った状態での公開を防ぐ）
 *   (e') vol.episodes が epRange 全域を埋めていて、かつ全 ep 全 sec が published=true →
 *        afterword.published=true（vol.episodes が epRange 全域を埋めていないうちは判定対象外）
 *   (f) 全 vol が heroCard.file を非空文字列で持つ
 *   (g) heroCardCompleted は volume 番号最大の vol のみが持つ・他 vol は持たない・最終 vol は必ず持つ
 *   (h) 全 vol・全 sec について end フィールドが書かれていない（撤廃済み検出）
 *   (i) afterword.published=true の vol は public/vol[XX]/vol[XX]-afterword.txt が実在（txt/ フォルダは切らない）
 *
 * 返り値：空配列なら整合。違反があれば人間可読なメッセージの配列（先頭に "(a)".."(i)" のタグ）。
 * 呼び出し側の運用：pages() プラグインは非空なら throw、テストは expect(errors).toEqual([]) 等。
 *
 * heroCard.file / heroCardCompleted.file の実在は検査しない：未公開 vol はスタブ画像で回避しても
 * 公開直前の差し替え忘れという別ミスを生むだけで根本的ポカヨケにならないため。story.json 上の
 * 記述整合（(f)(g)）のみ検査する。
 */

import type { StoryData, Volume } from './types';

// (a)〜(h) の純データ検査。fs 非依存。
// validateStory(story: StoryData): string[]
export function validateStory(story: StoryData): string[] {
    const errors: string[] = [];

    // (c) vol は volume 昇順
    for (let i = 1; i < story.length; i++) {
        if (story[i - 1].volume >= story[i].volume) {
            errors.push(
                `(c) vol[${i - 1}].volume=${story[i - 1].volume} >= vol[${i}].volume=${story[i].volume}：volume は昇順で並べること`
            );
        }
    }

    // (b) 隣接 vol の epRange が連続・非重複
    for (let i = 1; i < story.length; i++) {
        const prev = story[i - 1];
        const curr = story[i];
        if (prev.epRange[1] + 1 !== curr.epRange[0]) {
            errors.push(
                `(b) vol${prev.volume}.epRange[1]=${prev.epRange[1]} と vol${curr.volume}.epRange[0]=${curr.epRange[0]} が連続していない（隙間または重複）`
            );
        }
    }

    const maxVolume = story.length === 0 ? 0 : Math.max(...story.map(v => v.volume));

    for (const vol of story) {
        _checkVolumeInternal(vol, errors);
        _checkVolumeHeroCard(vol, maxVolume, errors);
        _checkVolumeAfterword(vol, errors);
    }

    return errors;
}

// (a)(d)(h) — vol 個別のデータ整合
function _checkVolumeInternal(vol: Volume, errors: string[]): void {
    const [lo, hi] = vol.epRange;
    const epIds = vol.episodes.map(e => e.id);

    // (a) epRange 範囲チェック
    for (const id of epIds) {
        if (id < lo || id > hi) {
            errors.push(`(a) vol${vol.volume}: ep${id} が epRange [${lo}, ${hi}] の範囲外`);
        }
    }
    // (a) 連続性＋昇順チェック（末尾からの欠落は許容・中間の飛び／逆順は NG）。
    // 元の配列順を検査する：state.ts の _nextEpInList などが episodes の並び順で ep 遷移を計算するため、
    // ソート後に「連続していれば通す」だと [2, 1] のような逆順が通ってしまう＝runtime で ep 遷移が壊れる。
    for (let i = 0; i < epIds.length; i++) {
        const expected = lo + i;
        if (epIds[i] !== expected) {
            errors.push(
                `(a) vol${vol.volume}: episodes[${i}].id=${epIds[i]} が期待値 ep${expected} と不一致（epRange[0]=${lo} から昇順・連続で並べること／末尾からの欠落は許容）`
            );
            break;
        }
    }

    for (const ep of vol.episodes) {
        // (d) sections が id 昇順
        for (let i = 1; i < ep.sections.length; i++) {
            if (ep.sections[i - 1].id >= ep.sections[i].id) {
                errors.push(`(d) vol${vol.volume} ep${ep.id}: sections が id 昇順で並んでいない`);
                break;
            }
        }
        // (d) 未公開 sec は末尾にのみ
        let seenUnpublished = false;
        for (const sec of ep.sections) {
            if (!sec.published) {
                seenUnpublished = true;
            } else if (seenUnpublished) {
                errors.push(
                    `(d) vol${vol.volume} ep${ep.id}: 未公開 sec の後に公開 sec が現れている（未公開 sec は末尾のみ許可）`
                );
                break;
            }
        }
        // (h) 撤廃済み end フィールド検出
        for (const sec of ep.sections) {
            if ('end' in sec) {
                errors.push(`(h) vol${vol.volume} ep${ep.id} sec${sec.id}: 撤廃済みの end フィールドが残っている`);
            }
        }
    }
}

// (f)(g) — heroCard / heroCardCompleted
function _checkVolumeHeroCard(vol: Volume, maxVolume: number, errors: string[]): void {
    if (!vol.heroCard || typeof vol.heroCard.file !== 'string' || vol.heroCard.file.trim() === '') {
        errors.push(`(f) vol${vol.volume}: heroCard.file が非空文字列でない`);
    }

    const isLast = vol.volume === maxVolume;
    if (isLast) {
        if (!vol.heroCardCompleted || typeof vol.heroCardCompleted.file !== 'string' || vol.heroCardCompleted.file.trim() === '') {
            errors.push(`(g) vol${vol.volume}（最終 vol）: heroCardCompleted.file が非空文字列でない`);
        }
    } else {
        if (vol.heroCardCompleted !== undefined) {
            errors.push(`(g) vol${vol.volume}（最終 vol でない）: heroCardCompleted を持てるのは最終 vol のみ`);
        }
    }
}

// (e)(e') — afterword.published と全 sec 公開の双方向整合
function _checkVolumeAfterword(vol: Volume, errors: string[]): void {
    const [lo, hi] = vol.epRange;
    const epIds = vol.episodes.map(e => e.id);
    const filledEpIds = new Set(epIds);
    let allEpsFilled = true;
    for (let id = lo; id <= hi; id++) {
        if (!filledEpIds.has(id)) { allEpsFilled = false; break; }
    }

    // (e) afterword.published=true → 全 ep 全 sec 公開 & epRange 全域が定義されている
    if (vol.afterword?.published === true) {
        if (!allEpsFilled) {
            errors.push(`(e) vol${vol.volume}: afterword.published=true だが epRange 全域 [${lo}, ${hi}] が episodes に定義されていない`);
        }
        for (const ep of vol.episodes) {
            for (const sec of ep.sections) {
                if (!sec.published) {
                    errors.push(`(e) vol${vol.volume}: afterword.published=true だが ep${ep.id} sec${sec.id} が未公開`);
                }
            }
        }
    }

    // (e') epRange 全域が定義され、かつ全 ep 全 sec 公開 → afterword.published=true
    if (allEpsFilled && vol.episodes.length > 0) {
        const allPublished = vol.episodes.every(
            ep => ep.sections.length > 0 && ep.sections.every(s => s.published)
        );
        if (allPublished && vol.afterword?.published !== true) {
            errors.push(`(e') vol${vol.volume}: 全 ep 全 sec が published=true なのに afterword.published が true でない`);
        }
    }
}

// (a)〜(i) の完全検査（ファイル実在検査を含む）。exists 関数を注入することで fs 依存を呼び出し側に閉じ込める。
// validateStoryFiles(story, opts): string[]
export function validateStoryFiles(
    story: StoryData,
    opts: {
        afterwordTxtExists: (vol: number) => boolean;
    }
): string[] {
    const errors = validateStory(story);

    for (const vol of story) {
        const volStr = String(vol.volume).padStart(2, '0');
        // (i) afterword.published=true のとき txt 実在
        if (vol.afterword?.published === true && !opts.afterwordTxtExists(vol.volume)) {
            errors.push(
                `(i) vol${vol.volume}: afterword.published=true だが public/vol${volStr}/vol${volStr}-afterword.txt が存在しない`
            );
        }
    }

    return errors;
}
