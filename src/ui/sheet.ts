/*
 * ui/sheet.ts
 * 責務: シートの器（<dialog class="sheet">）の開閉と操作。器の markup は各ページの HTML（共通のものは差し込みの断片
 *       templates/parts/*.html）が持ち、ここは「開く・閉じる・背景・閉じるボタン・掴んで段を変える・Esc の例外」だけを結ぶ。
 *       中身（人物・地図・用語・設定・共有・栞）は知らない。
 * export: type Detent = 'fit' | 'half' | 'full'
 *         init(dlg: HTMLDialogElement, opts?: { onEscape?: (e: KeyboardEvent) => boolean }): void
 *         open(dlg: HTMLDialogElement, opts?: { detent?: Detent; opener?: HTMLElement | null }): void
 *         close(dlg: HTMLDialogElement): void
 *         isOpen(dlg: HTMLDialogElement | null): boolean
 *         anyOpen(): boolean — ページに開いている <dialog> があるか（Escape・鑑賞モードの判定が使う）
 * 依存: DOM だけ。ui 層＝reader 層を import しない。
 *
 * 器の約束（design/modules/sheet.md）：
 *   <dialog class="sheet" data-detent="half|full|fit"> ＞ .sheet-grab（掴む所）＋ .sheet-head（見出し・タブ・閉じる）＋ .sheet-body
 *   [data-sheet-close] … 閉じるボタン（いくつあってもよい）
 *
 * なぜ <dialog> の showModal() か：最前面の層（top layer）に出るので z-index の調整が要らない、開くとフォーカスが中に入り
 *   裏は操作できなくなる、Esc で閉じる順番（一番上から閉じる）をブラウザが持つ、CloseWatcher に対応したブラウザでは
 *   Android の戻る操作でも閉じる。戻るの代用（history.pushState）はしない＝history.state の読書位置を汚さない。
 *
 * 段（detent）：スマホは下から出る。half＝半分（本文の上が見える）／full＝ほぼ全画面／fit＝中身の高さ（共有・栞・設定）。
 *   段は「開いたときの高さ」。掴む所か見出しの帯（タブ・閉じるボタンの上からでもよい）を動かすと高さが指について
 *   きて、離した所で止まる（画面の下の方で離すか、下へ
 *   勢いよく払うと閉じる。_wireDrag）。PC（幅 901px 以上）は右から出るパネルで掴む操作は無い
 *   （fit だけは右下の小さなカード。設定は fit でも右のパネル）。見た目は _sheet.css。
 *
 * Esc の例外：opts.onEscape が false を返すと、その Esc では閉じない（keydown の preventDefault で閉じる要求を止める）。
 *   cancel イベントの preventDefault では止めない——Chrome は利用者の操作なしに続けて取り消しを止めるとそれを無視する
 *   ことがあり、Esc はその「操作」に数えられない。用語の検索欄（文字があるときは欄を消すだけ）と日本語の変換中が使う。
 */

export type Detent = 'fit' | 'half' | 'full';

// 閉じたときにフォーカスを戻す先。開いた要素がもう見えない（メニューの項目は閉じたパネルの中）ことがあるので
// 呼び出し側が渡す。渡されなければ開く直前のフォーカス先（ブラウザの既定の戻り先と同じ）
const _openers = new WeakMap<HTMLDialogElement, HTMLElement | null>();

// PC の右パネルに切り替わる幅。_sheet.css の @media (min-width: 901px) と同じ値
const PC_QUERY = '(min-width: 901px)';

// init(dlg: HTMLDialogElement, opts?: { onEscape?: (e: KeyboardEvent) => boolean }): void
// 器に 1 回だけ結線する（背景・閉じるボタン・Esc の例外・フォーカスの戻り先・掴む操作）。
export function init(dlg: HTMLDialogElement, opts: { onEscape?: (e: KeyboardEvent) => boolean } = {}): void {
    // 背景（::backdrop）を押したときのクリックは dialog 自身に来る。器の矩形の外なら背景
    dlg.addEventListener('click', (e) => {
        if (e.target !== dlg) return;
        const r = dlg.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(dlg);
    });
    for (const btn of dlg.querySelectorAll<HTMLElement>('[data-sheet-close]')) {
        btn.addEventListener('click', () => close(dlg));
    }
    if (opts.onEscape) {
        const onEscape = opts.onEscape;
        dlg.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !onEscape(e)) e.preventDefault();
        });
    }
    dlg.addEventListener('close', () => {
        const opener = _openers.get(dlg);
        _openers.delete(dlg);
        if (opener?.isConnected) opener.focus();
    });
    _wireDrag(dlg);
}

// open(dlg: HTMLDialogElement, opts?: { detent?: Detent; opener?: HTMLElement | null }): void
// detent を省くと器の data-detent のまま（無ければ half）。開いているものを開き直すと段だけ変わる。
export function open(dlg: HTMLDialogElement, opts: { detent?: Detent; opener?: HTMLElement | null } = {}): void {
    if (opts.detent && opts.detent !== dlg.dataset.detent) {
        dlg.dataset.detent = opts.detent;
        dlg.style.height = '';   // 掴んで止めた高さより、明示された段を優先する
    }
    dlg.dataset.detent ??= 'half';
    if (dlg.open) return;
    _openers.set(dlg, opts.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    dlg.showModal();
}

// close(dlg: HTMLDialogElement): void
export function close(dlg: HTMLDialogElement): void {
    if (dlg.open) dlg.close();
}

// isOpen(dlg: HTMLDialogElement | null): boolean
export function isOpen(dlg: HTMLDialogElement | null): boolean {
    return dlg?.open ?? false;
}

// anyOpen(): boolean
// 開いている <dialog>（シート・確認）があるか。各ページの Escape 処理は、これが true の間は手を出さない
// （閉じる順番はブラウザが持つ）。鑑賞モードは CSS セレクタ dialog[open] で同じことを見ている（immersive.ts）。
export function anyOpen(): boolean {
    return document.querySelector('dialog[open]') !== null;
}

// 掴んで動かせる高さの上限（画面の高さに対する割合）。_sheet.css の full（92dvh）と同じ値
const MAX_RATIO = 0.92;
// 離した高さがこれより低ければ閉じる（画面の下の方では止めない）。ただし中身の高さの小さなシート（共有・栞）は
// もともとこの線のすぐ上にあり、少し下げただけで閉じてしまうので、線を「中身の高さの半分」まで下げる（_closeAt）
const CLOSE_RATIO = 0.3;
const FIT_CLOSE_RATIO = 0.5;
// これより高く止めたら full とみなす（人物のタブが「絵を大きく見せる並び」に変わる。_characters.css）
const FULL_RATIO = 0.8;
// 下向きにこの速さ（px/ms）以上で払って離したら、高さに関わらず閉じる
const FLING_SPEED = 0.8;
// 最後に動いてからこれ（ms）以上止まってから離したら、払ったのではなく「そこで止めた」とみなす
// （指を止めても pointermove は来ないので、最後に動いたときの速さが残ってしまう）
const REST_MS = 100;

// ボタンの上から動かし始めたとき、これ（px）以上縦に動いたら「押す」ではなく「掴んだ」とみなす
const SLOP_PX = 8;

// スマホ：掴む所（.sheet-grab）か見出しの帯（.sheet-head）を上下に動かすと、シートの高さが指についてくる。
// 離した所でそのまま止まる（段に吸い寄せない）。ただし画面の下の方（CLOSE_RATIO 未満。小さな fit は中身の半分未満）で離すか、
// 下へ勢いよく払ったら閉じる。上限は MAX_RATIO。fit（中身の高さ）は中身より高くは伸ばさない。
// 止めた高さは style.height（px）に持ち、閉じたら消す（次に開くと data-detent の高さに戻る）。
// data-detent は離したときに高さから決め直す（FULL_RATIO 以上なら full、それ以外は fit のまま／half）。
//
// 見出しの帯のボタン（タブ・閉じる）の上から動かし始めてもよい：押した時点では掴まず、SLOP_PX 以上縦に動いたら
// 掴む（そのボタンの click は取り消す）。掴む所は 22px と細く、すぐ下のタブに指が掛かると掴めなかった
// （2026-11-02 の指摘。資料シートは見出しの帯がほぼタブで埋まっている）。入力欄とリンクの上からは掴まない。
// _wireDrag(dlg: HTMLDialogElement): void
function _wireDrag(dlg: HTMLDialogElement): void {
    type Drag = { y0: number; h0: number; max: number; closeAt: number; lastY: number; lastT: number; v: number; id: number; on: boolean };
    let drag: Drag | null = null;
    // fit の中身の高さ（掴んで止めると style.height が入って測れなくなるので、最初に掴んだときに控える。閉じたら捨てる）
    let fitH: number | null = null;
    let swallowClick = false;
    // 開いたときの段（HTML の data-detent）。掴んで full にしたまま閉じても、次は元の段で開く（下の close）
    const baseDetent = dlg.dataset.detent;
    dlg.addEventListener('pointerdown', (e) => {
        swallowClick = false;
        const t = e.target as Element | null;
        if (!t?.closest('.sheet-grab, .sheet-head') || t.closest('a, input')) return;
        if (window.matchMedia(PC_QUERY).matches) return;
        const h0 = dlg.getBoundingClientRect().height;
        const vh = window.innerHeight;
        if (dlg.dataset.detent === 'fit' && !dlg.style.height) fitH = h0;
        const isFit = dlg.dataset.detent === 'fit' && fitH !== null;
        const max = isFit ? fitH! : vh * MAX_RATIO;
        const closeAt = isFit ? Math.min(vh * CLOSE_RATIO, fitH! * FIT_CLOSE_RATIO) : vh * CLOSE_RATIO;
        drag = { y0: e.clientY, h0, max: Math.max(h0, max), closeAt, lastY: e.clientY, lastT: e.timeStamp, v: 0, id: e.pointerId, on: false };
        // ボタンの上でなければすぐ掴む。ボタンの上なら動くまで待つ（ただ押しただけならボタンとして働く）
        if (!t.closest('button')) _grab(drag);
    });
    const _grab = (d: Drag): void => {
        d.on = true;
        dlg.classList.add('is-dragging');   // 高さの transition を止める（指に遅れないように）
        try { dlg.setPointerCapture(d.id); } catch { /* 合成イベントなど、捕まえられない指は捕まえない */ }
    };
    dlg.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (!drag.on) {
            if (Math.abs(e.clientY - drag.y0) < SLOP_PX) return;
            _grab(drag);
            swallowClick = true;
        }
        const dt = e.timeStamp - drag.lastT;
        if (dt > 0) drag.v = (e.clientY - drag.lastY) / dt;
        drag.lastY = e.clientY;
        drag.lastT = e.timeStamp;
        const h = Math.min(drag.max, Math.max(0, drag.h0 - (e.clientY - drag.y0)));
        dlg.style.height = `${h}px`;
    });
    // 掴んだあとに来る click（ボタンの上から動かし始めたとき）は、ボタンにも背景の判定にも渡さない
    dlg.addEventListener('click', (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);
    const end = (cancelled: boolean, t: number): void => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (!d.on) return;
        const v = t - d.lastT > REST_MS ? 0 : d.v;
        // 高さを測る（＝スタイルを確定させる）のは transition を戻す前。先に戻すと、最後に描いた高さから
        // 指を離した高さへの transition が走り、止めた所から巻き戻って見える
        const h = dlg.getBoundingClientRect().height;
        dlg.classList.remove('is-dragging');
        const vh = window.innerHeight;
        if (!cancelled && (h < d.closeAt || v > FLING_SPEED)) {
            close(dlg);
            return;
        }
        if (h < d.closeAt) dlg.style.height = `${d.closeAt}px`;
        if (dlg.dataset.detent !== 'fit') dlg.dataset.detent = h >= vh * FULL_RATIO ? 'full' : 'half';
    };
    // 掴んだあとの click は pointerup と同じ流れで来る。来ないこともある（離した所が別の要素の上など）ので、
    // 流れが終わったら取り消しの印を下ろす。残すと、次のキーボードの Enter／Space（pointerdown を伴わない
    // click）が飲まれる
    const settle = (): void => { window.setTimeout(() => { swallowClick = false; }, 0); };
    dlg.addEventListener('pointerup', (e) => { end(false, e.timeStamp); settle(); });
    dlg.addEventListener('pointercancel', (e) => { end(true, e.timeStamp); settle(); });
    // マウスで掴んでいる間、指の下に来た画像（人物の顔など）のネイティブのドラッグが始まると pointercancel が来て
    // 途中で止まる。掴んでいる間はネイティブのドラッグを始めさせない
    dlg.addEventListener('dragstart', (e) => { if (drag?.on) e.preventDefault(); });
    // 止めた高さと掴んで変えた段は、次に開いたときに持ち越さない
    dlg.addEventListener('close', () => {
        dlg.style.height = '';
        fitH = null;
        if (baseDetent) dlg.dataset.detent = baseDetent;
    });
}
