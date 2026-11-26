/*
 * map.ts
 * 責務: 地図の部品（エシュカの地図を器いっぱいに収めて、＋／− で拡大する）。器（要素）を受け取って描くだけで、
 *       自分がシートに置かれたかページに置かれたかは知らない。置き場所は資料シートの「地図」タブ
 *       （ui/world-sheet が呼ぶ）と資料ページ map.html（world-page.ts が呼ぶ）。見た目は _map.css。
 * export: mount(el: HTMLElement): void
 * 依存: なし（DOM と fetch・DOMParser、import.meta.env.BASE_URL だけを読むリーフ。.dependency-cruiser.cjs の LEAF に入れてある）
 *
 * 組み（要件 06-14・design/modules/map.md）：
 *   枠 figure#map-popup.mv（スクロールしない）＞ スクロールする箱 .mv-scroll ＞ 絵。＋／−（.mv-zoom）は枠の上に
 *   absolute で置く＝絵をどの向きに動かしてもボタンは動かない（スクロールする箱の中に sticky で置くと、横に払ったとき
 *   絵と一緒に流れる）。拡大は 1／2／3 段（CSS の data-zoom。幅 100／200／400%）。拡大・縮小の前後で、見えている範囲の中心を保つ。
 *   PC（マウス）は拡大中に地図をつかんで動かせる（手のひら）。指はブラウザのスクロールに任せる（pointerType で分ける）。
 *   「原寸で開く ↗」は同じ SVG を別タブで開く（拡大より細かく見たい読者向け）。URL に #s0〜#s5 を付けて、開いた先でも
 *   いまの stage（あとがきは #s0＝無彩色）の色で出す。
 *   端の段（1 段で −、3 段で ＋）のボタンは disabled にせず aria-disabled="true" を付ける（押したボタン自身が
 *   無効になるとキーボードのフォーカスが消えるため）。押しても何も起きないよう click 側で止める。
 *   枠には data-paper="light" を付ける＝枠・ボタンもライトの紙面の色（_map.css）。
 *
 * 地図（SVG）：
 *   - 色を stage で替えるため <img> ではなくページに埋める（<img> の SVG にはページの属性も CSS 変数も届かない）。
 *     SVG の中の CSS が <html data-story-stage>・<body data-kind="afterword"> を見て色を替える＝ここからは何も渡さない
 *   - 器（枠・箱・ボタン・リンク）は同期で作り、SVG だけを取得してから箱に入れる。mount は void のまま（呼び出し元は待たない）。
 *     取得前の箱は受け皿 .mv-art の aspect-ratio（_map.css）が確保する＝届いても中身が跳ねない
 *   - 取得は mount() の中＝**タブを開くまで地図を落とさない**（world-sheet は地図のタブを初めて開いたときだけ
 *     mount を呼ぶ。地図は 1 枚固定なので作り直さない。失敗しても作り直さない）
 *   - 失敗（通信の例外／!res.ok／parsererror／ルートが svg でない）は中身を文言に差し替えてリンクを外す＝
 *     「何も出ない枠と、押しても 404 のリンク」を読者に見せない
 *   - SVG は自分の生成物（執筆/地図/source/render_map.py --svg）。念のため script 要素は落としてから入れる
 */

// 地図の置き場所（BASE_URL からの相対）。vol に帰属しないサイト共通画像なので public/img/ 直下。
// ファイル名を ASCII にしてあるのは、fetch する URL に日本語名が入ったときのエンコーディング事故を避けるため
// （public/chara/*.avif は日本語名で運用できているので規約ではなく今回の選択。design/modules/map.md）。
const SVG_PATH = 'img/eshka-map.svg';
const ZOOM_MAX = 3;

// mount(el: HTMLElement): void
// el の中身を地図で置き換え、＋／−・手のひら・失敗時の差し替えを結線する。1 つの器に 1 回だけ呼ぶ。
export function mount(el: HTMLElement): void {
    const href = `${import.meta.env.BASE_URL}${SVG_PATH}`;
    el.textContent = '';

    const fig = document.createElement('figure');
    fig.id = 'map-popup';
    fig.className = 'mv';
    fig.dataset.zoom = '1';
    fig.dataset.paper = 'light';

    const box = document.createElement('section');
    box.className = 'mv-scroll';
    // 受け皿：SVG が届く前から地図の比率の箱を取る（拡大の段の幅もここに当たる）
    const art = document.createElement('section');
    art.className = 'mv-art';
    box.appendChild(art);

    const zoom = document.createElement('nav');
    zoom.className = 'mv-zoom';
    zoom.setAttribute('aria-label', '拡大・縮小');
    const zoomBtn = (dir: 1 | -1, label: string, path: string): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mv-zoom-btn';
        b.setAttribute('aria-label', label);
        b.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
        // 端の段のボタンは aria-disabled で「押せない」を伝えるだけなので、作動は自分で止める
        b.addEventListener('click', () => {
            if (b.getAttribute('aria-disabled') === 'true') return;
            _zoom(fig, box, dir);
        });
        return b;
    };
    zoom.append(zoomBtn(1, '拡大', 'M12 5v14M5 12h14'), zoomBtn(-1, '縮小', 'M5 12h14'));

    const open = document.createElement('a');
    open.id = 'map-popup-open';
    open.className = 'mv-open';
    open.href = _openHref(href);
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = '原寸で開く';
    // stage は開いている間に上がりうる（本文を読み終えた瞬間）ので、押す直前にも組み直す
    open.addEventListener('click', () => { open.href = _openHref(href); });

    fig.append(box, zoom, open);
    el.appendChild(fig);
    _updateZoomButtons(fig);
    _wireGrab(fig, box);
    void _load(href, art, fig);
}

// 「原寸で開く」の URL。開いた先の SVG は単体の文書なのでページの属性が届かない＝stage をフラグメントで渡す
// （SVG の中の :has(#sN:target) が受ける）。あとがきは #s0（無彩色）。
// _openHref(href: string): string
function _openHref(href: string): string {
    if (document.body.dataset.kind === 'afterword') return `${href}#s0`;
    const n = Number(document.documentElement.dataset.storyStage);
    return `${href}#s${n >= 1 && n <= 5 ? n : 1}`;
}

// SVG を取得して受け皿に入れる。失敗はすべて _showError に集める。
// _load(href: string, art: HTMLElement, fig: HTMLElement): Promise<void>
async function _load(href: string, art: HTMLElement, fig: HTMLElement): Promise<void> {
    try {
        const res = await fetch(href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
        const root = doc.documentElement;
        if (doc.querySelector('parsererror') || root.localName !== 'svg') throw new Error('SVG ではない');
        root.querySelectorAll('script').forEach((s) => s.remove());
        art.replaceChildren(document.importNode(root, true));
    } catch {
        _showError(fig);
    }
}

// 拡大・縮小する。前後で、見えている範囲の中心が同じ場所に留まるようにする。
// _zoom(fig: HTMLElement, box: HTMLElement, dir: 1 | -1): void
function _zoom(fig: HTMLElement, box: HTMLElement, dir: 1 | -1): void {
    const cx = (box.scrollLeft + box.clientWidth / 2) / box.scrollWidth;
    const cy = (box.scrollTop + box.clientHeight / 2) / box.scrollHeight;
    fig.dataset.zoom = String(Math.min(ZOOM_MAX, Math.max(1, Number(fig.dataset.zoom) + dir)));
    box.scrollLeft = cx * box.scrollWidth - box.clientWidth / 2;
    box.scrollTop = cy * box.scrollHeight - box.clientHeight / 2;
    _updateZoomButtons(fig);
}

// 端の段では押しても変わらないボタンに aria-disabled="true" を付け、それ以外では属性を外す。
// disabled にしないのは、押したボタン自身が無効になるとキーボードのフォーカスが消えるため。
// 押しても何も起きないことは click 側のガード（mount）が受け持つ。
// _updateZoomButtons(fig: HTMLElement): void
function _updateZoomButtons(fig: HTMLElement): void {
    const z = Number(fig.dataset.zoom);
    const [plus, minus] = fig.querySelectorAll<HTMLButtonElement>('.mv-zoom-btn');
    const set = (b: HTMLButtonElement | undefined, off: boolean): void => {
        if (!b) return;
        if (off) b.setAttribute('aria-disabled', 'true');
        else b.removeAttribute('aria-disabled');
    };
    set(plus, z >= ZOOM_MAX);
    set(minus, z <= 1);
}

// PC（マウス）：拡大中は地図をつかんで動かせる（手のひら）。指はブラウザのスクロールに任せる。
// カーソルの見た目は _map.css の (hover: hover) and (pointer: fine) の中だけ。
// _wireGrab(fig: HTMLElement, box: HTMLElement): void
function _wireGrab(fig: HTMLElement, box: HTMLElement): void {
    let grab: { x: number; y: number; l: number; t: number } | null = null;
    box.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0 || fig.dataset.zoom === '1') return;
        grab = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop };
        box.setPointerCapture(e.pointerId);
        fig.dataset.grabbing = '';
        e.preventDefault();   // 文字選択などの既定の動きを止める
    });
    box.addEventListener('pointermove', (e) => {
        if (!grab) return;
        box.scrollLeft = grab.l - (e.clientX - grab.x);
        box.scrollTop = grab.t - (e.clientY - grab.y);
    });
    const release = (): void => { grab = null; delete fig.dataset.grabbing; };
    box.addEventListener('pointerup', release);
    box.addEventListener('pointercancel', release);
}

// 地図の取得に失敗したとき、中身を文言に差し替える。
// _showError(fig: HTMLElement): void
function _showError(fig: HTMLElement): void {
    if (fig.querySelector('#map-popup-error')) return;
    fig.textContent = '';
    const msg = document.createElement('p');
    msg.id = 'map-popup-error';
    msg.textContent = '地図を読み込めませんでした。';
    fig.appendChild(msg);
}
