/*
 * characters.ts
 * 責務: 人物の部品（顔の帯＋選んだ人の詳細）。器（要素）とデータを受け取って描くだけで、自分がシートに置かれたか
 *       ページに置かれたかは知らない（並べ方は器の幅と CSS が決める。_characters.css）。
 *       いまの置き場所は資料シートの「人物」タブ（ui/world-sheet が呼ぶ。本文の menu.ts と目次の index.ts から開く）。
 * export: resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[]
 *         availableVolumes(data: CharactersData, stage: StoryStage): number[]
 *         faceImage(image: string): string
 *         render(el: HTMLElement, data: CharactersData, stage: StoryStage): void
 * 依存: ruby.ts（キャラ名/説明のルビ展開）, types.ts, volumes.ts（StoryStage の型のみ）。ui 層＝reader 層を import しない
 *
 * 分担（要件 06-8・design/modules/characters.md）：
 *   - 「どの Stage の紹介を出すか」は呼び出す側が決める。本文は「そのページが属する Stage」
 *     （vol n のページ＝Stage n）、目次は「読者の今の Stage」（computeStoryStage）を渡す
 *   - 「Stage からどの登録を引くか」はここだけが持つ（resolveCharacters）。呼び出す側は巻番号を扱わない
 *   - Stage までの巻が 2 つ以上あれば「何巻時点の紹介か」を切り替えるボタンを出す（先の巻は存在ごと出さない）
 *
 * 画像（public/chara/。作るのは tool/chara-crop）：
 *   - image（例 vol1_リッカ.avif）＝白い背景のままの全身（余白を詰めたもの）。顔は同じ名前に -face を足したもの
 *     （vol1_リッカ-face.avif・256px の正方形）。カードの地は元画像の白 #fafafa に合わせてある（CSS）
 *   - image が "" のキャラは全身を出さず、顔の所には名前の頭文字を置く（要件 06-8）
 *
 * 操作：顔を押すとその人。スマホでは全身の絵を左右に払うと隣の人（左へ払う＝次の人。指だけ。マウスは顔を押す）。
 *   顔の帯が横にはみ出しているときは、マウスのホイールの縦の回転で帯を横へ送る（端まで行ったら縦のスクロールへ渡す）。
 */

import { applyRuby } from './ruby';
import type { CharactersData, CharacterEntry } from './types';
import type { StoryStage } from './volumes';

// Stage に対応するキャラ紹介を返す純関数。規則は「巻番号が Stage 以下の登録のうち、巻番号が最大のもの」：
// Stage 1〜4 は同じ番号の巻、Stage 5（物語完結）は最終巻（vol4）になる。
// 巻数（story.json）を受け取らずに Stage 5 → 最終巻を決めるための形で、前提（公開済みの巻には登録がある／
// story.json に無い巻・重複した巻の登録は無い）は story-integrity の (o) がビルドで保証する。
// 該当が無ければ空配列。
// resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[]
export function resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[] {
    let best: CharactersData[number] | undefined;
    for (const entry of data) {
        if (entry.volume <= stage && (best === undefined || entry.volume > best.volume)) best = entry;
    }
    return best?.characters ?? [];
}

// Stage までに読める巻のうち、登録のある巻を小さい順に返す純関数（「何巻時点の紹介か」の切り替えの選択肢）。
// 最後の要素が resolveCharacters の選ぶ巻と一致する。
// availableVolumes(data: CharactersData, stage: StoryStage): number[]
export function availableVolumes(data: CharactersData, stage: StoryStage): number[] {
    return data.filter(e => e.volume <= stage).map(e => e.volume).sort((a, b) => a - b);
}

// 全身の画像名から顔の画像名を作る純関数（拡張子の前に -face を足す）。
// faceImage(image: string): string
export function faceImage(image: string): string {
    return image.replace(/(\.[A-Za-z0-9]+)$/, '-face$1');
}

const _src = (file: string): string => `${import.meta.env.BASE_URL}chara/${file}`;

// render(el: HTMLElement, data: CharactersData, stage: StoryStage): void
// el の中身を作り直して、Stage の紹介（最初の人を選んだ状態）を描く。開くたびに呼んでよい。
export function render(el: HTMLElement, data: CharactersData, stage: StoryStage): void {
    const vols = availableVolumes(data, stage);
    let vol = vols[vols.length - 1];
    let sel = 0;

    el.textContent = '';
    const root = document.createElement('article');
    root.className = 'cv';
    const faces = document.createElement('nav');
    faces.className = 'cv-faces';
    faces.setAttribute('aria-label', '人物');
    const detail = document.createElement('section');
    detail.className = 'cv-detail';
    root.append(faces, detail);
    el.appendChild(root);

    const list = (): CharacterEntry[] => data.find(e => e.volume === vol)?.characters ?? [];

    if (vol === undefined || list().length === 0) {
        const empty = document.createElement('p');
        empty.className = 'cv-empty';
        empty.textContent = '紹介できる人物はまだいません。';
        detail.appendChild(empty);
        return;
    }

    const drawFaces = (): void => {
        faces.textContent = '';
        list().forEach((c, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cv-face';
            b.setAttribute('aria-pressed', String(i === sel));
            if (c.image !== '') {
                const img = document.createElement('img');
                img.src = _src(faceImage(c.image));
                img.alt = '';
                img.loading = 'lazy';
                b.appendChild(img);
            } else {
                const initial = document.createElement('span');
                initial.className = 'cv-face-initial';
                initial.setAttribute('aria-hidden', 'true');
                initial.textContent = c.name.replace(/^\|/, '').charAt(0);
                b.appendChild(initial);
            }
            const name = document.createElement('span');
            name.className = 'cv-face-name';
            applyRuby(c.name, name);
            b.appendChild(name);
            b.addEventListener('click', () => select(i));
            faces.appendChild(b);
        });
    };

    const drawDetail = (): void => {
        const c = list()[sel];
        detail.textContent = '';
        if (c.image !== '') {
            const pic = document.createElement('img');
            pic.className = 'cv-portrait';
            pic.src = _src(c.image);
            pic.alt = '';
            _wireSwipe(pic, (dir) => {
                const next = sel + dir;
                if (next >= 0 && next < list().length) select(next);
            });
            detail.appendChild(pic);
        }
        const text = document.createElement('section');
        text.className = 'cv-text';
        if (vols.length > 1) {
            const nav = document.createElement('nav');
            nav.className = 'cv-vols';
            nav.setAttribute('aria-label', '何巻時点の紹介か');
            for (const v of vols) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'cv-vol';
                b.textContent = String(v);
                b.setAttribute('aria-label', `第${v}巻の時点`);
                b.setAttribute('aria-pressed', String(v === vol));
                b.addEventListener('click', () => {
                    if (v === vol) return;
                    vol = v;
                    sel = 0;
                    drawFaces();
                    drawDetail();
                });
                nav.appendChild(b);
            }
            text.appendChild(nav);
        }
        const name = document.createElement('h3');
        name.className = 'cv-name';
        applyRuby(c.name, name);
        const desc = document.createElement('p');
        desc.className = 'cv-desc';
        applyRuby(c.description, desc);
        text.append(name, desc);
        detail.appendChild(text);
    };

    const select = (i: number): void => {
        sel = i;
        faces.querySelectorAll('.cv-face').forEach((b, j) => b.setAttribute('aria-pressed', String(j === sel)));
        drawDetail();
        // 選んだ人が帯の中で見えるように横へ送る（帯の外のページは動かさない）
        const cur = faces.children[sel] as HTMLElement | undefined;
        if (cur && faces.scrollWidth > faces.clientWidth) {
            faces.scrollLeft = cur.offsetLeft - (faces.clientWidth - cur.offsetWidth) / 2;
        }
    };

    _wireWheel(faces);
    drawFaces();
    drawDetail();
}

// 顔の帯をマウスのホイール（縦の回転）で横へ送る。横にはみ出しているとき（スマホ・シートの幅の帯）だけ働き、
// 端まで送りきったらその先の回転は奪わない（シートの中身の縦スクロールへ渡す）。格子の並び（広い器）では帯が
// はみ出さないので何もしない。横の回転（トラックパッドの横払い・Shift＋ホイール）はブラウザに任せる。
// 送りは滑らかにする（ブラウザの smooth スクロールに任せる＝JS で毎フレーム動かさない）。回転が続けて来たら
// 行き先（target）に足していく：いまの位置から足すと、滑っている途中の位置を基準にして 1 刻みが短くなる。
// 動きを減らす設定（prefers-reduced-motion）のときは滑らかにしない。
// _wireWheel(faces: HTMLElement): void
function _wireWheel(faces: HTMLElement): void {
    let target: number | null = null;
    // 止まったら行き先を捨てる（顔を押したときの送り・指での送りのあとに古い行き先を使わない）。
    // scrollend は Safari の対応が新しいので、scroll が 150ms 来なくなったことで代える
    let idle = 0;
    faces.addEventListener('scroll', () => {
        window.clearTimeout(idle);
        idle = window.setTimeout(() => { target = null; }, 150);
    }, { passive: true });
    faces.addEventListener('wheel', (e) => {
        if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        const max = faces.scrollWidth - faces.clientWidth;
        if (max <= 0) return;
        // deltaMode 1（行単位。Firefox のマウス）は 1 行＝およそ 40px として px に直す
        const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
        const from = target ?? faces.scrollLeft;
        if ((dy < 0 && from <= 0) || (dy > 0 && from >= max - 1)) return;
        e.preventDefault();
        target = Math.min(max, Math.max(0, from + dy));
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        faces.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' });
        if (reduce) target = null;
    }, { passive: false });
}

// 全身の絵を左右に払ったら隣の人へ（左へ払う＝次の人＝+1）。横の動きだけを拾い、縦のスクロールはブラウザに任せる
// （CSS の touch-action: pan-y）。マウスは顔を押せば足りるので拾わない。
// _wireSwipe(pic: HTMLElement, go: (dir: 1 | -1) => void): void
function _wireSwipe(pic: HTMLElement, go: (dir: 1 | -1) => void): void {
    let x0: number | null = null;
    pic.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') x0 = e.clientX; });
    pic.addEventListener('pointerup', (e) => {
        if (x0 === null) return;
        const dx = e.clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    });
    pic.addEventListener('pointercancel', () => { x0 = null; });
}
