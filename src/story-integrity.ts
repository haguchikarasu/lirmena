/*
 * story-integrity.ts
 * 責務: story.json の整合を検査する純関数群。build 時（vite.config.ts の pages() プラグイン。
 *       config() フックなので build / dev / preview の全経路でブロッキング）と
 *       test 時（src/story-integrity.test.ts）で同じ関数を共有する。
 * export: validateStory(story: StoryData): string[]     — 純データ検査 (a)〜(h) + (j)(k)(k')(l)(m)(n)(p)
 *         validateStoryFiles(story, opts): string[]    — (i)(o)(q) を含む合成版（fs 実在と characters.json の中身を opts で注入）
 * 依存: 型（StoryData / Volume / PreviewSpec）と volumes.ts の MAX_STORY_STAGE（(m) で参照）、
 *       core/theme.ts の素材の規約（(q) で参照）、core/chara.ts の人物の画像の規約（(o) で参照）、core/preview.ts の「実効的に preview が有効か」（(e)(k)(k')(l)。目次と共有）のみ。
 *       fs / DOM / localStorage 非依存。純関数（引数を破壊しない）。
 *
 * 検査項目：
 *   (a) 各 vol.epRange 内の ep.id のみ vol.episodes に含める。範囲内は epRange[0] から連続で
 *       欠けなく並ぶこと（末尾からの欠落＝未執筆 ep は許容。中間の飛びは NG）。
 *   (b) 隣接 vol の epRange が連続・重複しない（vol[i].epRange[1] + 1 === vol[i+1].epRange[0]）
 *   (c) vol は volume 昇順で書かれる
 *   (d) 各 ep.sections は id 昇順で並び、未公開 sec は末尾にのみ配置される
 *   (e) afterword.published=true → その vol の全 ep 全 sec が published=true、かつ epRange 全域が
 *       episodes に定義されていること（未執筆 ep が残った状態での公開を防ぐ）＋
 *       afterword.published=true の vol は**非空** preview を持てず、その episodes も**非空** preview を
 *       持てない（完結 vol に予告テキストが混入するのを防ぐ＝完結 > 予告 > 連載中 の優先順位を
 *       integrity で担保。空 text preview は「preview 無扱い」なので完結 vol にも残せる）
 *   (e') vol.episodes が epRange 全域を埋めていて、かつ全 ep 全 sec が published=true →
 *        afterword.published=true（vol.episodes が epRange 全域を埋めていないうちは判定対象外）
 *   (f)(g) 欠番（heroCard / heroCardCompleted の記述検査。巻の素材を (q) の規約で引くようにしたので P4 で撤去）
 *   (h) 全 vol・全 sec について end フィールドが書かれていない（撤廃済み検出）
 *   (i) afterword.published=true の vol は public/vol[XX]/vol[XX]-afterword.txt が実在（txt/ フォルダは切らない）
 *   (j) preview（vol.preview / ep.preview 両方）は定義されていれば「object かつ null/配列でなく
 *       text が string」であること（null/配列/{}/text 型不一致を弾く）。**空文字 `""` や空白のみは valid**：
 *       事前配置テンプレ用途で未着手 vol/ep に `preview: { text: "" }` を書けるようにする。空 text は
 *       「preview 無し」と同義扱いで (k)(l)(k')(e) の対象外（＝未着手 vol/ep に骨組みだけ置いて、公開が
 *       近づいたら text を埋めるだけで使える）
 *   (k) 表示可能な ep（=公開済み sec が1つ以上ある ep）を持つ vol は**非空** vol.preview を持てない
 *       （公開が始まった vol の落とし忘れ検出。運用ルール：sec 公開時に vol.preview の text を空文字にする）
 *   (k') **非空** vol.preview を持つ vol は episodes 内で**非空** ep.preview を持てない
 *        （vol.preview は body 未生成なので、同じ vol の非空 ep.preview は目次で silently hidden になる。
 *          vol と ep の予告を混在させたい運用は無い＝どちらか一方で表現する。空 text 同士は事前配置なので併存 OK）
 *   (l) 公開済み sec が1つ以上ある ep は**非空** ep.preview を持てない（sec 公開時の落とし忘れ検出）
 *   (m) vol 数 + 1 が volumes.ts の MAX_STORY_STAGE を超えない。computeStoryStage は上限でクランプするので
 *       vol を足しても実行時エラーにはならず、**stage が 1 段低いまま頭打ちになって静かに間違う**。
 *       型 StoryStage・MAX_STORY_STAGE・CSS の --stage-N-hue の追加漏れをここで止める
 *       （追加手順は design/modules/volumes.md「vol5 以降を追加するときの手順」）
 *   (n) ep.coverPositionX / ep.coverPositionY は定義されていれば「"0%"〜"100%" のパーセント表記」か
 *       「軸の合うキーワード」（X＝left/right、Y＝top/bottom。小文字のみ）の文字列であること。
 *       title.ts はこの値を CSS の background-position へ素通しするため、ここが唯一の形の関門になる
 *       （X に "top" が入ると CSS は `top center` を「縦＝top」と読み、横位置の指定として効かない。要件 06-1）。
 *       ep.tocCoverPositionY（目次の扉絵バナーの縦位置）も同じ関門で、こちらは "0%"〜"100%" だけ（キーワード不可。要件 06-7）
 *   (o) characters.json（validateStoryFiles のみ。opts.characters で注入）：配列で、各要素が整数の volume と
 *       配列の characters（各キャラは文字列の name / description / image）を持ち、volume は重複せず
 *       story.json に存在する巻だけ。**公開済み sec を持つ巻は
 *       characters を 1 件以上持つ**（その巻の Stage に到達できる読者に必ずキャラ紹介を出すため。
 *       Stage → 登録の対応規則は characters.ts の resolveCharacters。要件 06-8）。
 *       公開済み sec を持つ巻の各キャラは、**紹介文が空でない**（空白だけも空）こと、image が "" でなければ
 *       **全身と顔の画像が public/chara/ に実在する**こと（opts.charaFileExists で注入。顔の名前は core/chara の
 *       faceImage）。image が "" は正規の状態（顔の所に名前の頭文字を出す）なので通す。未公開の巻は書きかけ
 *       （draft）なので中身は見ない
 *   (p) sec.scheduledAt（公開予定日時）は定義されていれば「YYYY-MM-DDTHH:MM（:SS 可）+09:00」の実在する日時で、
 *       **公開済み sec には書けない**（公開したら消す運用の消し忘れ検出。残っていても目次は過去の予定を
 *       出さないので壊れはしないが、story.json の上で「どれが次の予定か」が読めなくなる。要件 06-7）。
 *       日本時間に固定するのは、書く人が時差を意識しないため（Z や他の時差を混ぜると並べ替えを読み違える）
 *   (q) 巻の素材（validateStoryFiles のみ。opts.themeFileExists で実在判定を注入）：公開済み sec を持つ巻は
 *       public/vol[XX]/theme/ の 3 ファイル（core/theme.ts の THEME_FILES）が揃っている。最終巻の
 *       afterword.published=true（＝物語完結の stage に到達できる）なら public/final/theme/ の 3 ファイルも
 *       揃っている。規約で引くので story.json の書き損じでは見つからず、ここが唯一の関門になる
 *
 * 返り値：空配列なら整合。違反があれば人間可読なメッセージの配列（先頭に "(a)".."(o)" のタグ）。
 * 呼び出し側の運用：pages() プラグインは非空なら throw、テストは expect(errors).toEqual([]) 等。
 *
 * (q) が素材の実在を見てよいのは、対象を「その素材を表示しうるもの（公開済み sec を持つ巻・到達できる完結）」に
 * 限るから＝未公開の巻にスタブ画像を置かせない（スタブは公開直前の差し替え忘れという別のミスを生むだけ）。
 * (q) は dev サーバーの起動時だけ走る（素材を差し替えても再検査しない。(i) のあとがきと同じ割り切り）。
 */

import type { StoryData, Volume, PreviewSpec } from './types';
import { MAX_STORY_STAGE } from './volumes';
import { THEME_FILES, themeDir, type ThemeKey } from './core/theme';
import { charaPath, faceImage } from './core/chara';
import { hasEffectivePreview } from './core/preview';

// preview フィールドの形式検査 (j)。null/配列/{}/text 型不一致を弾く。
// **空文字（"" や空白のみ）は valid**：「preview 無し」と同義扱いにするため（事前配置テンプレ用途で
// 未着手 vol/ep に `preview: { text: "" }` を書けるようにする。要件 06-7・content-update.md の
// 「予告テキスト」節）。空 text は integrity (k)(l)(k')(e 強化) でも「preview 無扱い」で通す。
// 呼び出し側は「preview が定義されている」ことを確認してから呼ぶ（optional なので undefined は正常）。
// 戻り値：型として正しい PreviewSpec なら null、不正なら人間可読な理由文字列。
function _validatePreviewShape(preview: unknown): string | null {
    if (typeof preview !== 'object' || preview === null || Array.isArray(preview)) {
        return 'preview は { text: string } 形式のオブジェクトである必要がある';
    }
    const p = preview as Partial<PreviewSpec>;
    if (typeof p.text !== 'string') {
        return 'preview.text は string である必要がある';
    }
    return null;
}


// (n) 扉背景の位置指定の形式検査。定義されていて、パーセント表記（0〜100%）でも軸の合うキーワードでもなければ理由文字列。
// @@BG の xpos / ypos（parser.ts の parsePosition）と受ける形は同じだが、あちらは不正値を黙って既定へ戻し、
// こちらは build を止める（story.json は公開ゲート配下のデータなので、書き損じは公開前に直させる）。
// _validateCoverPosition(value: unknown, keywords: readonly string[]): string | null
function _validateCoverPosition(value: unknown, keywords: readonly string[]): string | null {
    const allowed = keywords.length === 0
        ? '"0%"〜"100%"'
        : `"0%"〜"100%" または ${keywords.map(k => `"${k}"`).join(' / ')}`;
    if (typeof value !== 'string') return `${allowed} の文字列である必要がある`;
    if (keywords.includes(value)) return null;
    const m = /^(\d+(?:\.\d+)?)%$/.exec(value);
    if (m === null || parseFloat(m[1]) > 100) return `"${value}" は不正（${allowed} のみ）`;
    return null;
}

// (a)〜(h) + (j)(k)(k')(l)(m)(n) の純データ検査。fs 非依存。
// validateStory(story: StoryData): string[]
export function validateStory(story: StoryData): string[] {
    const errors: string[] = [];

    // (m) vol 数に対して stage の上限が足りているか（読破 stage の分 +1 する）
    if (story.length + 1 > MAX_STORY_STAGE) {
        errors.push(
            `(m) vol ${story.length} 巻に対し stage 上限 ${MAX_STORY_STAGE} が不足：` +
            `volumes.ts の StoryStage 型と MAX_STORY_STAGE、src/styles/_base.css と src/styles/toc.css の ` +
            `--stage-${story.length + 1}-hue を追加すること`
        );
    }

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

    for (const vol of story) {
        _checkVolumeInternal(vol, errors);
        _checkVolumeAfterword(vol, errors);
        _checkVolumePreview(vol, errors);
        _checkVolumeCoverPosition(vol, errors);
        _checkVolumeSchedule(vol, errors);
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
    //     ＋完結 vol は**非空** preview を持てない（空 text preview は preview 無扱いで許容）
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
            if (hasEffectivePreview(ep.preview)) {
                errors.push(`(e) vol${vol.volume}: afterword.published=true だが ep${ep.id} に非空 preview が残存している（完結 vol は予告テキストを持てない）`);
            }
        }
        if (hasEffectivePreview(vol.preview)) {
            errors.push(`(e) vol${vol.volume}: afterword.published=true だが 非空 vol.preview が残存している（完結 vol は予告テキストを持てない）`);
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

// (j)(k)(k')(l) — preview フィールドの型検査と落とし忘れ検出
// (j) はフィールド形式（vol.preview / ep.preview 両方）、(k)(l) は「公開が始まった vol/ep から
// **非空** preview を落とし忘れていないか」、(k') は「非空 vol.preview と非空 ep.preview の併記禁止」。
// **空 text preview（`{ text: "" }` 等）は「preview 無し」と同義扱い**＝(k)(l)(k') の対象外
// （事前配置テンプレ用途を許容する）。(e) の完結 vol 側は _checkVolumeAfterword が担当する。
function _checkVolumePreview(vol: Volume, errors: string[]): void {
    // (j) vol.preview の型検査（空文字は valid・null/配列/型不一致のみ弾く）
    if (vol.preview !== undefined) {
        const reason = _validatePreviewShape(vol.preview);
        if (reason !== null) {
            errors.push(`(j) vol${vol.volume}: ${reason}`);
        }
    }
    // (j) ep.preview の型検査
    for (const ep of vol.episodes) {
        if (ep.preview !== undefined) {
            const reason = _validatePreviewShape(ep.preview);
            if (reason !== null) {
                errors.push(`(j) vol${vol.volume} ep${ep.id}: ${reason}`);
            }
        }
    }

    const volPreviewActive = hasEffectivePreview(vol.preview);

    // (k) 表示可能な ep（公開済み sec が1つ以上ある ep）を持つ vol は非空 vol.preview を持てない
    if (volPreviewActive) {
        const hasPublishedEp = vol.episodes.some(ep => ep.sections.some(s => s.published));
        if (hasPublishedEp) {
            errors.push(`(k) vol${vol.volume}: 公開済み sec を持つ ep があるのに非空 vol.preview が残存している（sec 公開時に vol.preview を空文字にするか削除すること）`);
        }
    }

    // (k') 非空 vol.preview を持つ vol は episodes 内で非空 ep.preview を持てない（silently hidden 防止）
    if (volPreviewActive) {
        for (const ep of vol.episodes) {
            if (hasEffectivePreview(ep.preview)) {
                errors.push(`(k') vol${vol.volume} ep${ep.id}: 非空 vol.preview と同時に非空 ep.preview を持てない（vol.preview は body 未生成のため ep.preview が目次に出ない・どちらか一方で表現する）`);
            }
        }
    }

    // (l) 公開済み sec が1つ以上ある ep は非空 ep.preview を持てない
    for (const ep of vol.episodes) {
        if (hasEffectivePreview(ep.preview) && ep.sections.some(s => s.published)) {
            errors.push(`(l) vol${vol.volume} ep${ep.id}: 公開済み sec があるのに非空 ep.preview が残存している（sec 公開時に ep.preview を空文字にするか削除すること）`);
        }
    }
}

// (n) — ep 扉背景の位置指定（coverPositionX / coverPositionY）の形式検査
function _checkVolumeCoverPosition(vol: Volume, errors: string[]): void {
    for (const ep of vol.episodes) {
        if (ep.coverPositionX !== undefined) {
            const reason = _validateCoverPosition(ep.coverPositionX, ['left', 'right']);
            if (reason !== null) errors.push(`(n) vol${vol.volume} ep${ep.id}: coverPositionX ${reason}`);
        }
        if (ep.coverPositionY !== undefined) {
            const reason = _validateCoverPosition(ep.coverPositionY, ['top', 'bottom']);
            if (reason !== null) errors.push(`(n) vol${vol.volume} ep${ep.id}: coverPositionY ${reason}`);
        }
        if (ep.tocCoverPositionY !== undefined) {
            const reason = _validateCoverPosition(ep.tocCoverPositionY, []);
            if (reason !== null) errors.push(`(n) vol${vol.volume} ep${ep.id}: tocCoverPositionY ${reason}`);
        }
    }
}

// (p) の形式検査。日本時間（+09:00）の ISO 8601 で、暦の上で実在する日時なら null、でなければ理由文字列。
// 正規表現だけだと 2026-02-30 が通る＝Date に通して年月日時分秒が書いたとおりに戻るかで見る。
// _validateScheduledAt(value: unknown): string | null
function _validateScheduledAt(value: unknown): string | null {
    const shape = '"YYYY-MM-DDTHH:MM+09:00"（秒は任意・日本時間）の文字列である必要がある';
    if (typeof value !== 'string') return shape;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\+09:00$/.exec(value);
    if (m === null) return `"${value}" は不正（${shape}）`;
    const [y, mo, d, h, mi, sec] = m.slice(1).map(v => (v === undefined ? 0 : Number(v)));
    // 日本時間の各値を UTC として組み立てて戻す（時差は固定なので +09:00 を外して比べてよい）
    const t = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
    const ok = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d &&
        t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === sec;
    return ok ? null : `"${value}" は存在しない日時`;
}

// (p) — sec.scheduledAt の形式と「公開済み sec には書けない」
function _checkVolumeSchedule(vol: Volume, errors: string[]): void {
    for (const ep of vol.episodes) {
        for (const sec of ep.sections) {
            if (sec.scheduledAt === undefined) continue;
            const where = `(p) vol${vol.volume} ep${ep.id} sec${sec.id}`;
            const reason = _validateScheduledAt(sec.scheduledAt);
            if (reason !== null) errors.push(`${where}: scheduledAt ${reason}`);
            if (sec.published) {
                errors.push(`${where}: 公開済みなのに scheduledAt が残っている（公開したら消すこと）`);
            }
        }
    }
}

// (q) — 巻の素材が規約の場所に揃っているか。対象は「その素材を表示しうる」ものだけ：
//   公開済み sec を持つ巻（その巻の stage に読者が到達できる）と、最終巻の afterword が公開済みのときの final。
// _checkThemeFiles(story: StoryData, exists: (path: string) => boolean, errors: string[]): void
function _checkThemeFiles(story: StoryData, exists: (path: string) => boolean, errors: string[]): void {
    const check = (key: ThemeKey, label: string, why: string): void => {
        const missing = THEME_FILES.filter(f => !exists(`${themeDir(key)}/${f}`));
        if (missing.length > 0) {
            errors.push(`(q) ${label}: ${why}のに public/${themeDir(key)}/ に ${missing.join(' / ')} が無い`);
        }
    };
    for (const vol of story) {
        if (vol.episodes.some(ep => ep.sections.some(s => s.published))) {
            check(vol.volume, `vol${vol.volume}`, '公開済み sec がある');
        }
    }
    const last = story.length === 0 ? undefined : story.reduce((a, b) => (b.volume > a.volume ? b : a));
    if (last?.afterword?.published === true) {
        check('final', 'final', `最終巻 vol${last.volume} のあとがきが公開済み（物語完結の stage に到達できる）`);
    }
}

// (o) — characters.json と story.json の整合。characters は JSON をそのまま受け取り、形もここで見る
// （読めなかった・壊れていた場合は呼び出し側が undefined を渡す＝「配列でない」として止まる）。
// characters.ts の resolveCharacters は「巻番号が Stage 以下の登録のうち最大のもの」を引くので、
// 次の 4 点が崩れると Stage に対して違う巻のキャラが出る：
//   - 形：配列で、各要素が整数の volume と配列の characters を持ち、各キャラは文字列の name / description / image を持つ
//   - 重複なし：同じ volume が 2 回出てこない（どちらを引くかが実装しだいになる）
//   - 存在する巻だけ：story.json に無い巻の登録があると、Stage 5（完結）が最終巻ではなくそれを引く
//   - 公開済みの巻には登録がある：公開済み sec を持つ巻＝その Stage に到達できる読者がいる巻
// 公開済みの巻のキャラは中身も見る（紹介文が空でない・画像の名前が書いてあれば全身と顔のファイルがある）。
// 形が崩れたキャラは形のエラーだけを出し、中身は見ない（同じキャラに 2 つ出さない）。
// _checkCharacters(story: StoryData, characters: unknown, exists: (path: string) => boolean, errors: string[]): void
function _checkCharacters(story: StoryData, characters: unknown, exists: (path: string) => boolean, errors: string[]): void {
    if (!Array.isArray(characters)) {
        errors.push('(o) public/characters.json が読めない、または配列でない');
        return;
    }

    const storyVolumes = new Set(story.map(v => v.volume));
    const counts = new Map<number, number>(); // volume → characters の件数
    type Chara = { name: string; description: string; image: string };
    const valid = new Map<number, Chara[]>(); // volume → 形の正しいキャラ（中身の検査に使う）
    characters.forEach((entry: unknown, i) => {
        const e = entry as { volume?: unknown; characters?: unknown } | null;
        if (typeof e !== 'object' || e === null || !Number.isInteger(e.volume) || !Array.isArray(e.characters)) {
            errors.push(`(o) characters.json[${i}]: 整数の volume と配列の characters を持つオブジェクトである必要がある`);
            return;
        }
        const volume = e.volume as number;
        const ok: Chara[] = [];
        // 各キャラの形：characters.ts は name / description をルビ展開し、image を "" か否かで分岐する
        e.characters.forEach((c: unknown, j) => {
            const ch = c as { name?: unknown; description?: unknown; image?: unknown } | null;
            if (typeof ch !== 'object' || ch === null ||
                typeof ch.name !== 'string' || typeof ch.description !== 'string' || typeof ch.image !== 'string') {
                errors.push(`(o) characters.json volume ${volume} の characters[${j}]: name / description / image は文字列である必要がある（画像が無ければ image は ""）`);
                return;
            }
            ok.push(ch as Chara);
        });
        if (counts.has(volume)) {
            errors.push(`(o) characters.json: volume ${volume} が重複している`);
            return;
        }
        counts.set(volume, e.characters.length);
        valid.set(volume, ok);
        if (!storyVolumes.has(volume)) {
            errors.push(`(o) characters.json: volume ${volume} は story.json に存在しない巻`);
        }
    });

    for (const vol of story) {
        const hasPublished = vol.episodes.some(ep => ep.sections.some(s => s.published));
        if (hasPublished && (counts.get(vol.volume) ?? 0) === 0) {
            errors.push(
                `(o) vol${vol.volume}: 公開済み sec があるのに characters.json にキャラ紹介が無い` +
                `（Stage ${vol.volume} の読者に出すキャラ紹介を public/characters.json に足すこと）`
            );
        }
        if (!hasPublished) continue;
        for (const c of valid.get(vol.volume) ?? []) {
            if (c.description.trim() === '') {
                errors.push(`(o) characters.json volume ${vol.volume} の ${c.name}: 紹介文（description）が空`);
            }
            if (c.image === '') continue;
            const missing = [c.image, faceImage(c.image)].filter(f => !exists(charaPath(f)));
            if (missing.length > 0) {
                errors.push(
                    `(o) characters.json volume ${vol.volume} の ${c.name}: public/chara/ に ${missing.join(' / ')} が無い` +
                    `（画像が無いなら image は ""。画像は tool/chara-crop で作る）`
                );
            }
        }
    }
}

// (a)〜(q) の完全検査（ファイル実在検査と characters.json との整合を含む）。
// fs 依存は呼び出し側に閉じ込める（exists 関数と読み込み済みの characters を注入する）。
// themeFileExists・charaFileExists は public からの相対パス（例 "vol01/theme/logo.webp"・"chara/vol1_リッカ.avif"）を受ける。
// validateStoryFiles(story, opts): string[]
export function validateStoryFiles(
    story: StoryData,
    opts: {
        afterwordTxtExists: (vol: number) => boolean;
        themeFileExists: (path: string) => boolean;
        charaFileExists: (path: string) => boolean;
        characters: unknown;
    }
): string[] {
    const errors = validateStory(story);
    _checkCharacters(story, opts.characters, opts.charaFileExists, errors);
    _checkThemeFiles(story, opts.themeFileExists, errors);

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
