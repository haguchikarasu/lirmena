/*
 * map.ts
 * 責務: 地図の部品（エシュカの地図を器いっぱいに収めて、＋／− で拡大する）。器（要素）を受け取って描くだけで、
 *       自分がシートに置かれたかページに置かれたかは知らない。いまの置き場所は資料シートの「地図」タブ
 *       （ui/world-sheet が呼ぶ）。見た目は _map.css。
 * export: mount(el: HTMLElement): void
 * 依存: なし（DOM と import.meta.env.BASE_URL だけを読むリーフ。.dependency-cruiser.cjs の LEAF に入れてある）
 *
 * 組み（要件 06-14・design/modules/map.md）：
 *   枠 figure#map-popup.mv（スクロールしない）＞ スクロールする箱 .mv-scroll ＞ 絵。＋／−（.mv-zoom）は枠の上に
 *   absolute で置く＝絵をどの向きに動かしてもボタンは動かない（スクロールする箱の中に sticky で置くと、横に払ったとき
 *   絵と一緒に流れる）。拡大は 1／2／3 段（CSS の data-zoom）。拡大・縮小の前後で、見えている範囲の中心を保つ。
 *   PC（マウス）は拡大中に地図をつかんで動かせる（手のひら）。指はブラウザのスクロールに任せる（pointerType で分ける）。
 *   「原寸で開く ↗」は同じ画像を別タブで開く（拡大より細かく見たい読者向け）。
 *
 * 画像：
 *   - src は mount() で入れる＝**タブを開くまで 231KB を落とさない**（world-sheet は地図のタブを初めて開いたときだけ
 *     mount を呼ぶ。地図は 1 枚固定なので作り直さない）
 *   - 読み込みに失敗したら（配置漏れ・改名）中身を文言に差し替えてリンクを外す＝「壊れた画像アイコンと押しても 404 の
 *     リンク」を読者に見せない
 */

// 地図画像の置き場所（BASE_URL からの相対）。vol に帰属しないサイト共通画像なので public/img/ 直下。
// ファイル名を ASCII にしてあるのは、fetch する URL に日本語名が入ったときのエンコーディング事故を避けるため
// （public/chara/*.avif は日本語名で運用できているので規約ではなく今回の選択。design/modules/map.md）。
const IMAGE_PATH = 'img/eshka-map.avif';
const ZOOM_MAX = 3;

// mount(el: HTMLElement): void
// el の中身を地図で置き換え、＋／−・手のひら・失敗時の差し替えを結線する。1 つの器に 1 回だけ呼ぶ。
export function mount(el: HTMLElement): void {
    const href = `${import.meta.env.BASE_URL}${IMAGE_PATH}`;
    el.textContent = '';

    const fig = document.createElement('figure');
    fig.id = 'map-popup';
    fig.className = 'mv';
    fig.dataset.zoom = '1';

    const box = document.createElement('section');
    box.className = 'mv-scroll';
    const img = document.createElement('img');
    img.alt = 'エシュカの地図';
    // width/height 属性は「読み込み前の箱」を確保するために置く（画像の到着で中身が跳ねない）
    img.width = 1775;
    img.height = 1920;
    img.draggable = false;
    img.addEventListener('error', () => _showError(fig));
    img.src = href;
    box.appendChild(img);

    const zoom = document.createElement('nav');
    zoom.className = 'mv-zoom';
    zoom.setAttribute('aria-label', '拡大・縮小');
    const zoomBtn = (dir: 1 | -1, label: string, path: string): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mv-zoom-btn';
        b.setAttribute('aria-label', label);
        b.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
        b.addEventListener('click', () => _zoom(fig, box, dir));
        return b;
    };
    zoom.append(zoomBtn(1, '拡大', 'M12 5v14M5 12h14'), zoomBtn(-1, '縮小', 'M5 12h14'));

    const open = document.createElement('a');
    open.id = 'map-popup-open';
    open.className = 'mv-open';
    open.href = href;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = '原寸で開く';

    fig.append(box, zoom, open);
    el.appendChild(fig);
    _updateZoomButtons(fig);
    _wireGrab(fig, box);
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

// 端の段では押しても変わらないボタンを押せなくする。
// _updateZoomButtons(fig: HTMLElement): void
function _updateZoomButtons(fig: HTMLElement): void {
    const z = Number(fig.dataset.zoom);
    const [plus, minus] = fig.querySelectorAll<HTMLButtonElement>('.mv-zoom-btn');
    if (plus) plus.disabled = z >= ZOOM_MAX;
    if (minus) minus.disabled = z <= 1;
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
        e.preventDefault();   // 画像を持ち出す既定の動きと文字選択を止める
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

// 画像の読み込みに失敗したとき、中身を文言に差し替える。
// _showError(fig: HTMLElement): void
function _showError(fig: HTMLElement): void {
    if (fig.querySelector('#map-popup-error')) return;
    fig.textContent = '';
    const msg = document.createElement('p');
    msg.id = 'map-popup-error';
    msg.textContent = '地図を読み込めませんでした。';
    fig.appendChild(msg);
}
