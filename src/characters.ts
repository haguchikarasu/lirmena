/*
 * characters.ts
 * 責務: 人物の部品（顔の帯＋選んだ人の詳細）。器（要素）とデータを受け取って描くだけで、自分がシートに置かれたか
 *       ページに置かれたかは知らない（並べ方は器の幅と CSS が決める。_characters.css）。
 *       置き場所は 2 つ：資料シートの「人物」タブ（ui/world-sheet が呼ぶ。本文の menu.ts から開く）と、
 *       資料ページ characters.html（world-page.ts が呼ぶ。器に data-cv-fill を付け、スマホでは画面を使い切る並び＝シートとは別の並び）。
 * export: resolveCharacters(data: CharactersData, stage: StoryStage): CharacterEntry[]
 *         availableVolumes(data: CharactersData, stage: StoryStage): number[]
 *         faceImage(image: string): string
 *         render(el: HTMLElement, data: CharactersData, stage: StoryStage, opts?: RenderOptions): void
 *         viewToHash(view: CharacterView): string
 *         viewFromHash(hash: string): Partial<CharacterView>
 *         type CharacterView = { vol: number; name: string }
 *         type RenderOptions = { initial?: Partial<CharacterView>; onChange?: (view: CharacterView) => void }
 * 依存: ruby.ts（キャラ名/説明のルビ展開）, types.ts, volumes.ts（StoryStage の型のみ）。ui 層＝reader 層を import しない
 *
 * 分担（要件 06-8・design/modules/characters.md）：
 *   - 「どの Stage の紹介を出すか」は呼び出す側が決める。本文は「そのページが属する Stage」
 *     （vol n のページ＝Stage n）、資料ページは「読者の今の Stage」（computeStoryStage）を渡す
 *   - 「Stage からどの登録を引くか」はここだけが持つ（resolveCharacters）。呼び出す側は巻番号を扱わない
 *   - Stage までの巻が 2 つ以上あれば、以前の巻の紹介へ切り替えられる（先の巻は存在ごと出さない）。
 *     選択は顔の帯（一覧全体）のすぐ下に小さく置く（.cv-vols。人ごとの詳細の中ではなく一覧全体の下＝紹介全体の
 *     切り替えだとわかる。人物が増えても並びに混ざらないので崩れない）。最初は最新の巻。
 *     切り替えても、選んでいた人がその巻にもいれば同じ人のまま（いなければ先頭の人）。
 *   - いま見ている巻と人（CharacterView）は呼び出す側へ知らせ（onChange）、呼び出す側から最初の値を渡せる（initial）。
 *     資料シートの「ページで開く」が、選んだ巻と人をページへ引き継ぐため（URL の # に載せる＝viewToHash／viewFromHash）。
 *     initial の巻が Stage までに読める巻に無ければ使わない（先の巻を URL から開けない＝ネタバレしない）
 *     切り替えは履歴に積まない（ブラウザの「戻る」・資料ページの ‹ は巻の切り替えを遡らず、ページを離れる）。
 *     巻の選択は同じ紹介の見え方の切り替えで、ページの移動ではないため（資料ページのタブを履歴に積まないのと同じ）
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

// 巻の選択の頭に置くアイコン（本が並んだ形。_sheet.css の .ic＝線画）
const _IC_VOLS = '<svg class="ic cv-vols-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5h3.5v15H4zM9.5 4.5H13v15H9.5z"/><path d="M15.2 5.6l3.4-.9 3.4 14.5-3.4.8z"/></svg>';

const _src = (file: string): string => `${import.meta.env.BASE_URL}chara/${file}`;

// CharacterView: いま見ている紹介（何巻の時点か・誰か）。name は characters.json の name そのまま（ルビの記法ごと）。
export type CharacterView = { vol: number; name: string };
// RenderOptions: initial＝最初に見せる巻と人（無い・使えない値は既定＝最新の巻の 1 人目）。onChange＝描いた直後と、
// 巻・人が替わるたびに呼ぶ。
export type RenderOptions = { initial?: Partial<CharacterView>; onChange?: (view: CharacterView) => void };

// 見ている紹介を URL の # の文字列にする純関数（先頭の # は付けない）。例：vol=1&who=%E3%83%AA%E3%83%83%E3%82%AB
// viewToHash(view: CharacterView): string
export function viewToHash(view: CharacterView): string {
    return new URLSearchParams({ vol: String(view.vol), who: view.name }).toString();
}

// URL の #（先頭の # はあっても無くてもよい）から見る紹介を読む純関数。読めない項目は入れない。
// viewFromHash(hash: string): Partial<CharacterView>
export function viewFromHash(hash: string): Partial<CharacterView> {
    const q = new URLSearchParams(hash.replace(/^#/, ''));
    const view: Partial<CharacterView> = {};
    const vol = Number(q.get('vol'));
    if (Number.isInteger(vol) && vol > 0) view.vol = vol;
    const who = q.get('who');
    if (who) view.name = who;
    return view;
}

// render(el: HTMLElement, data: CharactersData, stage: StoryStage, opts?: RenderOptions): void
// el の中身を作り直して、Stage の紹介（最初の人を選んだ状態。opts.initial があればその巻と人）を描く。開くたびに呼んでよい。
// 紹介できる人がいなければ（データが無い・その巻の登録が空）「紹介できる人物はまだいません。」だけを出す（要件 06-8）。
export function render(el: HTMLElement, data: CharactersData, stage: StoryStage, opts: RenderOptions = {}): void {
    const vols = availableVolumes(data, stage);
    const want = opts.initial?.vol;
    let vol = want !== undefined && vols.includes(want) ? want : vols[vols.length - 1];
    let sel = 0;

    el.textContent = '';
    if (vol === undefined || !(data.find(e => e.volume === vol)?.characters.length)) {
        const empty = document.createElement('p');
        empty.className = 'cv-empty';
        empty.textContent = '紹介できる人物はまだいません。';
        el.appendChild(empty);
        return;
    }
    const root = document.createElement('article');
    root.className = 'cv';
    const faces = document.createElement('nav');
    faces.className = 'cv-faces';
    faces.setAttribute('aria-label', '人物');
    const detail = document.createElement('section');
    detail.className = 'cv-detail';
    el.appendChild(root);

    const list = (): CharacterEntry[] => data.find(e => e.volume === vol)?.characters ?? [];
    const notify = (): void => opts.onChange?.({ vol, name: list()[sel].name });
    if (opts.initial?.name !== undefined) sel = Math.max(0, list().findIndex(c => c.name === opts.initial!.name));

    // 巻を切り替える（顔の帯と詳細を描き直す）。選んでいた人がその巻にもいれば同じ人のまま（巻ごとの紹介を
    // 見比べるのが主な使い道）、いなければ先頭の人。巻のボタンは作り直さない（押したボタンにフォーカスを残す）
    const switchTo = (v: number): void => {
        if (v === vol) return;
        const name = list()[sel]?.name;
        vol = v;
        const i = list().findIndex(c => c.name === name);
        vnav.querySelectorAll('.cv-vol').forEach((b, j) => b.setAttribute('aria-pressed', String(vols[j] === vol)));
        drawFaces();
        faces.scrollLeft = 0;
        select(i < 0 ? 0 : i);
    };

    // 巻の選択（紹介全体の下）。巻が 1 つなら出さない
    const vnav = document.createElement('nav');
    vnav.className = 'cv-vols';
    vnav.setAttribute('aria-label', '何巻の時点の紹介か');
    // 作るのは 1 回だけ（切り替えでは aria-pressed だけ付け替える＝switchTo）
    const drawVols = (): void => {
        vnav.hidden = vols.length < 2;
        if (vnav.hidden) return;
        vnav.insertAdjacentHTML('beforeend', _IC_VOLS);
        for (const v of vols) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cv-vol';
            b.textContent = `${v}巻`;
            b.setAttribute('aria-pressed', String(v === vol));
            b.addEventListener('click', () => switchTo(v));
            vnav.appendChild(b);
        }
    };
    // 並びは 顔の帯 → 巻の選択 → 詳細（巻の選択は顔の帯のすぐ下。シートの半分の高さでも最初から見える。
    // スマホの資料ページは CSS の order で 詳細 → 顔の帯 → 巻の選択 に並べ替える）
    root.append(faces, vnav, detail);

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
        notify();
        // 選んだ人が帯の中で見えるように横へ送る（帯の外のページは動かさない）
        const cur = faces.querySelectorAll<HTMLElement>('.cv-face')[sel];
        if (cur && faces.scrollWidth > faces.clientWidth) {
            faces.scrollLeft = cur.offsetLeft - (faces.clientWidth - cur.offsetWidth) / 2;
        }
    };

    _wireWheel(faces);
    drawVols();
    drawFaces();
    select(sel);
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
