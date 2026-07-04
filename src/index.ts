/*
 * index.ts
 * 責務: 目次ページ（index.html）の全機能制御
 * export: なし（script type="module" としてロードされるエントリポイント）
 * 依存: なし（src/ 内の他モジュールは import しない）
 *
 * 機能:
 *   - episodes.json を fetch して ep・sec 一覧を動的生成（sec01 のリンク先はタイトルページ [ep]-00.html、sec02 以降は本文ページ）
 *   - ep タイトル・栞の場所表示の |漢字《かんじ》 をルビ展開（applyRuby＝src/ruby.ts と同一ロジックの inline 複製。独立方針のため）
 *   - 到達セット・読了セット（sec 単位）からセクションの既読/読破を表示（判定ロジックは持たず引くだけ）
 *     既読（到達）＝アクセント色／読破（読了）＝チェック ✓。両セットは独立（読破のみも起こり得る）
 *   - 栞欄を固定3スロット表示：スロット0＝オートセーブ（最上段・ジャンプ＋削除）、スロット1〜3（空き含む常時表示・個別クリア・ジャンプ）
 *   - 続きから読む：オートセーブがあればヒーロー下のボタンと FAB 項目を出し、pendingJump を書いて対象 sec へ遷移（着地先で復元）
 *   - content-changelog.json を fetch してコンテンツ更新履歴を表示
 *   - site-changelog.json を fetch してサイトバージョンバッジを更新（詳細一覧は表示しない）
 *   - ヒーローカード右下に content version / site version バッジを表示
 *   - 右下 FAB メニュー（続きから読む・栞をすべてクリア・既読をクリア・読破状況をクリア・設定・共有）
 *   - 設定ポップアップ（localStorage の読み書きのみ。目次への反映なし）
 *   - 内部遷移リンク（ep/sec 一覧・栞・続きから読む）は現在ページのクエリ（例 ?noga＝GA 無効化）を引き継ぐ（withQuery＝state.ts の _withQuery と同一ロジックの inline 複製。独立方針のため）
 *   - 共有（コピー/X/LINE）の URL はクエリを落とす（location.origin+pathname。dev フラグを読者に渡さないため）
 *
 * localStorage キー（bookmark.ts / settings.ts と共有。変更時は両側を合わせること）:
 *   "reached"            : string[]         到達 sec の集合 "ep-sec"（2桁ゼロ埋め）。既読マーク（色）の源。「既読をクリア」対象
 *   "read"              : string[]         読了 sec の集合 "ep-sec"。読破マーク（✓）の源。「読破状況をクリア」対象
 *   "autosave"           : { ep, sec, ratio, savedAt }   最新の読書位置（ratio はスクロール範囲比 0〜1・書字方向非依存）。スロット0／「続きから読む」の遷移先
 *   "bookmarks"          : BookmarkEntry[]  flat { slot, ep, sec, scene, ratio, savedAt }（slot=1..3・単一スロット。旧単一/方向別キーは bookmark.ts の移行元）
 *   "pendingJump"        : { ep, sec, scene, ratio }   栞ジャンプ受け渡し（ratio はスクロール範囲比 0〜1。書くだけ・消費は遷移先ページ）
 *   "sceneRead"          : string[]         旧 "ep-sec-scene" 形式。移行前に目次を先に開いた返読者向けフォールバック
 *   "lirmena.fontSize"    : 'large' | 'medium' | 'small'   デフォルト 'medium'
 *   "lirmena.fontFamily"  : 'serif' | 'sans'               デフォルト 'serif'
 *   "lirmena.lineGap"     : 'on' | 'off'                   デフォルト 'on'
 *   "lirmena.writingMode" : 'vertical' | 'horizontal'      デフォルト 'horizontal'（目次は保存のみ。反映は本文ページの axis）
 *
 * 既読マーク（色）は到達ベース（一般的な「開いたら既読」方式）。`reached` を引き、加えて移行前の返読者向けに
 * 旧 `sceneRead` の完了マーカー "ep-sec-00" もフォールバックで既読扱いする。読破マーク（✓）は読了ベースで `read`
 * を引き、同様に旧 "ep-sec-00" を読破扱いにする（bookmark.ts の移行と整合）。
 */

// 目次ページの CSS はこのエントリが import する（Vite が <link>（ハッシュ名）を自動注入）。
// 旧・ルート直下 index.css ＋ index.html の手書き <link> は廃止し src/styles/toc.css へ移した。
import './styles/toc.css';
import * as bookmark from './bookmark';

type Episode = { id: number; title: string; sections: { id: number; published: boolean }[] };
// 栞は flat 形＋固定スロット（slot=1..3）。旧 nested 形（{ address }）・旧 flat（slot 無し）は
// loadBookmarks() で正規化して読む（slot 無しは表示用に savedAt 昇順で採番）。
type BookmarkEntry = {
    slot: number;
    ep: number;
    sec: number;
    scene: number;
    ratio: number;
    savedAt: number;
};
type ContentChangelogEntry = {
    version: string;
    date: string;
    change: string;
    ep: number[];
    sha: string[];
};
type SiteChangelogEntry = {
    version: string;
    date: string;
    changes: string[];
};

// localStorage キー（bookmark.ts / settings.ts と同一）
const LS_REACHED      = 'reached';
const LS_READ         = 'read';
const LS_AUTOSAVE     = 'autosave';
const LS_BOOKMARKS    = 'bookmarks';
const LS_PENDING_JUMP = 'pendingJump';
const LS_SCENE_READ   = 'sceneRead';
const LS_FONT_SIZE    = 'lirmena.fontSize';
const LS_FONT_FAMILY  = 'lirmena.fontFamily';
const LS_LINE_GAP     = 'lirmena.lineGap';
const LS_WRITING_MODE = 'lirmena.writingMode';

const DEFAULTS = { fontSize: 'medium', fontFamily: 'serif', lineGap: 'on', writingMode: 'horizontal' } as const;

// 栞・オートセーブは読書位置をスクロール範囲比（割合・書字方向非依存）で持つため単一スロット（"bookmarks"/"autosave"）に
// 保存される（bookmark.ts と同一規則。schemaVersion 5 で方向別スロットから統合）。目次はその単一キーを引く。
// 「栞をクリア」は単一スロットを消す。
function clearAllBookmarkSlots(): void {
    localStorage.removeItem(LS_BOOKMARKS);
}

const GITHUB_REPO = 'haguchikarasu/lirmena';

let _episodes: Episode[] = [];
const CHANGELOG_INITIAL_COUNT = 3;

// 数値を2桁ゼロ埋め文字列に変換する
// pad(n: number): string
const pad = (n: number) => String(n).padStart(2, '0');
// state.ts の _withQuery と同等（目次は src/ を import しない独立方針のため複製）。
// 現在ページのクエリ（例 "?noga"）を相対 URL に引き継ぎ、マルチページ間で GA 無効化フラグを維持する。
const withQuery = (path: string): string => path + location.search;

// |base《rt》 記法をパースして ruby 要素とテキストノードを el に追加する。
// src/ruby.ts の applyRuby と同一ロジック。目次ページは src/ を import しない独立方針のため inline 複製する
// （localStorage キーと同じく、変更時は両側を合わせること）。innerHTML 不使用で XSS 安全。
// applyRuby(text: string, el: HTMLElement): void
function applyRuby(text: string, el: HTMLElement): void {
    const re = /\|([^《\n]+)《([^》\n]+)》/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(m[1]));
        const rt = document.createElement('rt');
        rt.textContent = m[2];
        ruby.appendChild(rt);
        el.appendChild(ruby);
        last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

// ----- localStorage ヘルパー -----

// 文字列配列セットを localStorage から読み込む
// loadStringSet(key: string): Set<string>
function loadStringSet(key: string): Set<string> {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set();
}

// 旧 "sceneRead" の完了マーカー "ep-sec-00"（＝読了相当）を "ep-sec" 集合として返す。
// 移行前に目次を先に開いた返読者向けのフォールバック源（reached/read 双方の取り込みに使う）。
// loadLegacyDoneSections(): Set<string>
function loadLegacyDoneSections(): Set<string> {
    const result = new Set<string>();
    for (const k of loadStringSet(LS_SCENE_READ)) {
        const parts = k.split('-'); // "ep-sec-scene"
        if (parts.length === 3 && parts[2] === '00') result.add(`${parts[0]}-${parts[1]}`);
    }
    return result;
}

// 到達済み（既読＝色）セクションの "ep-sec" 集合を返す。
// 新スキーマの "reached" ＋ 旧 "sceneRead" の完了マーカー（フォールバック）。
// loadReachedSections(): Set<string>
function loadReachedSections(): Set<string> {
    const result = loadStringSet(LS_REACHED);
    for (const k of loadLegacyDoneSections()) result.add(k);
    return result;
}

// 読了済み（読破＝✓）セクションの "ep-sec" 集合を返す。
// 新スキーマの "read" ＋ 旧 "sceneRead" の完了マーカー（フォールバック。完了マーカーは読了相当）。
// loadReadSections(): Set<string>
function loadReadSections(): Set<string> {
    const result = loadStringSet(LS_READ);
    for (const k of loadLegacyDoneSections()) result.add(k);
    return result;
}

// 栞リストを localStorage から読み込み flat 形に正規化する。flat・旧 nested の両方を受け付ける。
// slot（1..3）は保持し、未割当（旧 flat）は表示用に savedAt 昇順で空きスロットへ採番する
// （bookmark.ts の移行と同一規則。ここでは永続化しない）。
// loadBookmarks(): BookmarkEntry[]
function loadBookmarks(): BookmarkEntry[] {
    try {
        const raw = localStorage.getItem(LS_BOOKMARKS);
        if (!raw) return [];
        const list = JSON.parse(raw) as Array<Record<string, unknown>>;
        const entries = list.map((o) => {
            const addr = (o.address ?? o) as Record<string, unknown>;
            const slotRaw = Number(o.slot);
            const slot = (slotRaw === 1 || slotRaw === 2 || slotRaw === 3) ? slotRaw : 0;
            const ratio = Number(o.ratio);
            return {
                slot,
                ep: Number(addr.ep),
                sec: Number(addr.sec),
                scene: Number(addr.scene) || 0,
                ratio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0,
                savedAt: Number(o.savedAt) || Date.now(),
            };
        }).filter((b) => Number.isFinite(b.ep) && Number.isFinite(b.sec));

        // slot 未割当に空きスロットを採番（表示用・永続化なし）
        const taken = new Set(entries.filter(b => b.slot >= 1 && b.slot <= 3).map(b => b.slot));
        for (const b of entries.filter(b => b.slot === 0).sort((a, b) => a.savedAt - b.savedAt)) {
            for (let s = 1; s <= 3; s++) {
                if (!taken.has(s)) { b.slot = s; taken.add(s); break; }
            }
        }
        return entries;
    } catch { /* ignore */ }
    return [];
}

// ----- 既読/読破判定 -----

// セクションが集合（"ep-sec" の到達 or 読了セット）に含まれるかを返す（判定ロジックは持たず引くだけ）
// isSectionInSet(ep: number, sec: number, set: Set<string>): boolean
function isSectionInSet(ep: number, sec: number, set: Set<string>): boolean {
    return set.has(`${pad(ep)}-${pad(sec)}`);
}

// 既読（到達）を消す。目次の既読マーク（色）の源（reached）と、その旧フォールバック源 sceneRead を消す。
// 読了（read）は残す（「読破状況をクリア」が別途担当する）。
// clearReached(): void
function clearReached(): void {
    localStorage.removeItem(LS_REACHED);
    localStorage.removeItem(LS_SCENE_READ);
}

// 読破状況（読了）を消す。目次の読破マーク（✓）の源（read）を削除する。
// clearReadStatus(): void
function clearReadStatus(): void {
    localStorage.removeItem(LS_READ);
}

// オートセーブ（最新の読書位置）を読む。無ければ null。savedAt はスロット0の日時表示に使う。
// ratio（スクロール範囲比 0〜1）は「続きから読む」が pendingJump に載せて復元させるために返す。
// loadAutoSave(): { ep: number; sec: number; ratio: number; savedAt: number } | null
function loadAutoSave(): { ep: number; sec: number; ratio: number; savedAt: number } | null {
    try {
        const raw = localStorage.getItem(LS_AUTOSAVE);
        if (!raw) return null;
        const o = JSON.parse(raw) as { ep?: unknown; sec?: unknown; ratio?: unknown; savedAt?: unknown };
        const ep = Number(o.ep);
        const sec = Number(o.sec);
        if (Number.isFinite(ep) && Number.isFinite(sec)) {
            const ratio = Number(o.ratio);
            return { ep, sec, ratio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0, savedAt: Number(o.savedAt) || Date.now() };
        }
    } catch { /* ignore */ }
    return null;
}

// 「続きから読む」用に pendingJump を書く。続きから読むはサイト内クリック（明示前進ナビと同種）なので、
// main.ts の「明示前進ナビでは復元しない」gate に弾かれる。pendingJump（最優先）で確実に ratio を復元させる
// （栞ジャンプと同じ仕組み。bookmark.ts と共有する localStorage キー）。
// writeResumeJump(auto: { ep: number; sec: number; ratio: number }): void
function writeResumeJump(auto: { ep: number; sec: number; ratio: number }): void {
    localStorage.setItem(LS_PENDING_JUMP, JSON.stringify({ ep: auto.ep, sec: auto.sec, scene: 0, ratio: auto.ratio }));
}

// オートセーブ位置の sec 本文ページへ遷移する。遷移前に pendingJump を書き、着地先 main.ts が ratio を復元する。
// resumeReading(auto: { ep: number; sec: number; ratio: number }): void
function resumeReading(auto: { ep: number; sec: number; ratio: number }): void {
    writeResumeJump(auto);
    location.href = withQuery(`contents/${pad(auto.ep)}-${pad(auto.sec)}.html`);
}

// ヒーロー下の「続きから読む」本体ボタンを初期化する。
// オートセーブがあれば hidden を外して click を結線し、なければ hidden のままにする（要件 06-7）。
// initResumeButton(): void
function initResumeButton(): void {
    const btn = document.getElementById('idx-resume') as HTMLButtonElement | null;
    if (!btn) return;
    const auto = loadAutoSave();
    if (!auto) return;
    btn.hidden = false;
    btn.addEventListener('click', () => resumeReading(auto));
}

// ----- ep・sec 一覧 -----

// ep・sec 一覧を動的生成する。未公開 sec・公開済み sec が0の ep は非表示。
// 既読（到達＝色）と読破（読了＝✓）を独立に付与する（読破のみも起こり得る）。
// リンク先：sec01 は ep のタイトルページ（扉）`contents/[ep2桁]-00.html`、sec02 以降は本文ページ `contents/[ep2桁]-[sec2桁].html`。
// renderEpisodes(episodes: Episode[], reached: Set<string>, read: Set<string>): void
function renderEpisodes(episodes: Episode[], reached: Set<string>, read: Set<string>): void {
    const area = document.getElementById('episodes-area');
    if (!area) return;
    area.innerHTML = '';

    for (const ep of episodes) {
        const publishedSecs = ep.sections.filter(s => s.published);
        if (publishedSecs.length === 0) continue;

        const epEl = document.createElement('div');
        epEl.className = 'idx-ep';

        const titleEl = document.createElement('p');
        titleEl.className = 'idx-ep-title';
        // 接頭辞「第N話 」はルビ記法を含まず素のテキスト、ep.title 内の |漢字《かんじ》 のみ <ruby> 化される。
        applyRuby(`第${ep.id}話 ${ep.title}`, titleEl);
        epEl.appendChild(titleEl);

        const secListEl = document.createElement('div');
        secListEl.className = 'idx-chips';

        for (const sec of publishedSecs) {
            const isReached = isSectionInSet(ep.id, sec.id, reached);
            const isRead = isSectionInSet(ep.id, sec.id, read);

            const link = document.createElement('a');
            link.className = 'idx-chip'
                + (isReached ? ' idx-chip--reached' : '')
                + (isRead ? ' idx-chip--read' : '');
            // sec01 は ep の入口なのでタイトルページ（扉）へ。sec02 以降は本文ページへ直接。
            // 復元対象の栞・続きから読むの本文リンク（後述）は扉を挟まずそのまま本文へ。
            link.href = sec.id === 1
                ? withQuery(`contents/${pad(ep.id)}-00.html`)
                : withQuery(`contents/${pad(ep.id)}-${pad(sec.id)}.html`);

            const labelEl = document.createElement('span');
            labelEl.textContent = pad(sec.id);
            // 読破 > 既読 の優先で読み上げラベルを出し分ける
            if (isRead) link.setAttribute('aria-label', `${pad(sec.id)} 読破`);
            else if (isReached) link.setAttribute('aria-label', `${pad(sec.id)} 既読`);
            link.appendChild(labelEl);

            secListEl.appendChild(link);
        }

        epEl.appendChild(secListEl);
        area.appendChild(epEl);
    }

    if (area.children.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'loading-text';
        msg.textContent = '公開中のエピソードはまだありません。';
        area.appendChild(msg);
    }
}

// ----- 栞 -----

// savedAt を "YYYY/MM/DD HH:MM" 文字列にする。
// fmtDate(savedAt: number): string
function fmtDate(savedAt: number): string {
    const d = new Date(savedAt);
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ep・sec を「第N話 タイトル - SS」表記にする（タイトルが無ければ番号のみ）。
// locLabel(ep: number, sec: number): string
function locLabel(ep: number, sec: number): string {
    const epTitle = _episodes.find(e => e.id === ep)?.title ?? '';
    return epTitle ? `第${ep}話 ${epTitle} - ${pad(sec)}` : `第${ep}話 - ${pad(sec)}`;
}

// 1枚の栞カード（スロットラベル＋場所・日時＋アクション）を生成する。
// buildSlotCard(slotLabel, locText, dateText, actions): HTMLElement
function buildSlotCard(slotLabel: string, locText: string, dateText: string, actions: HTMLElement | null): HTMLElement {
    const card = document.createElement('article');
    card.className = 'idx-bm-card' + (actions ? '' : ' idx-bm-card--empty');

    const info = document.createElement('div');
    info.className = 'idx-bm-info';

    const slotEl = document.createElement('p');
    slotEl.className = 'idx-bm-slot';
    slotEl.textContent = slotLabel;
    info.appendChild(slotEl);

    const locEl = document.createElement('p');
    locEl.className = 'idx-bm-loc';
    // locText 内の ep タイトルの |漢字《かんじ》 を <ruby> 展開する（「第N話 」「 - SS」等の付加文字は素通り）。
    applyRuby(locText, locEl);
    info.appendChild(locEl);

    if (dateText) {
        const dateEl = document.createElement('p');
        dateEl.className = 'idx-bm-date';
        dateEl.textContent = dateText;
        info.appendChild(dateEl);
    }

    card.appendChild(info);
    if (actions) card.appendChild(actions);
    return card;
}

// 栞欄を固定スロットで描画する（再描画可）。
// スロット0＝オートセーブ（あれば最上段・ジャンプのみ）、スロット1〜3＝手動栞（空き含め常時表示）。
// renderBookmarks(): void
function renderBookmarks(): void {
    const container = document.getElementById('bookmark-slots');
    if (!container) return;
    container.innerHTML = '';

    // スロット0：オートセーブ（あるときだけ。auto は scene を持たないので（タイトル画面）注記なし）
    const auto = loadAutoSave();
    if (auto) {
        const actions = document.createElement('div');
        actions.className = 'idx-bm-btns';
        const resumeBtn = document.createElement('a');
        resumeBtn.className = 'idx-bm-go';
        resumeBtn.href = withQuery(`contents/${pad(auto.ep)}-${pad(auto.sec)}.html`);
        resumeBtn.textContent = '続きから読む';
        // 遷移前に pendingJump を書く（同期。着地先 main.ts が読んで scrollLeft を復元する）。
        // <a> のままにして中クリック等のネイティブ挙動を維持する（栞スロットのジャンプと同じ流儀）。
        resumeBtn.addEventListener('click', () => { writeResumeJump(auto); });
        actions.appendChild(resumeBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'idx-bm-del';
        delBtn.type = 'button';
        delBtn.textContent = '削除';
        // オートセーブ本体を消して再描画する。ヒーロー下／FAB の「続きから読む」は次回ロードで消える。
        delBtn.addEventListener('click', () => {
            localStorage.removeItem(LS_AUTOSAVE);
            renderBookmarks();
        });
        actions.appendChild(delBtn);

        const card = buildSlotCard('スロット0：オートセーブ', locLabel(auto.ep, auto.sec), fmtDate(auto.savedAt), actions);
        card.classList.add('idx-bm-card--auto');
        container.appendChild(card);
    }

    // スロット1〜3：手動栞（埋まっていればジャンプ＋削除、空きはプレースホルダ）
    const bySlot = new Map(loadBookmarks().map(b => [b.slot, b]));
    for (let slot = 1; slot <= 3; slot++) {
        const entry = bySlot.get(slot);
        if (!entry) {
            container.appendChild(buildSlotCard(`スロット${slot}`, '空き', '', null));
            continue;
        }

        const { ep, sec, scene } = entry;
        const actions = document.createElement('div');
        actions.className = 'idx-bm-btns';

        const jumpBtn = document.createElement('a');
        jumpBtn.className = 'idx-bm-go';
        jumpBtn.href = withQuery(`contents/${pad(ep)}-${pad(sec)}.html`);
        jumpBtn.textContent = 'ここから読む';
        // 遷移前に pendingJump を書く（同期。遷移先ページがロード時に読んで復元する）。
        jumpBtn.addEventListener('click', () => {
            localStorage.setItem(LS_PENDING_JUMP, JSON.stringify({ ep, sec, scene, ratio: entry.ratio }));
        });
        actions.appendChild(jumpBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'idx-bm-del';
        clearBtn.type = 'button';
        clearBtn.textContent = '削除';
        // savedAt でこの栞1件だけを削除して再描画する（保存形に slot が無い旧データでも一致する）
        clearBtn.addEventListener('click', () => {
            const remaining = loadBookmarks().filter(b => b.savedAt !== entry.savedAt);
            if (remaining.length === 0) {
                localStorage.removeItem(LS_BOOKMARKS);
            } else {
                localStorage.setItem(LS_BOOKMARKS, JSON.stringify(remaining));
            }
            renderBookmarks();
        });
        actions.appendChild(clearBtn);

        const locText = locLabel(ep, sec) + (scene === 0 ? '（タイトル画面）' : '');
        container.appendChild(buildSlotCard(`スロット${slot}`, locText, fmtDate(entry.savedAt), actions));
    }
}

// ----- 設定ポップアップ -----

// 設定ポップアップを DOM 構築し、イベントを登録する
// buildSettingsPopup(episodes: Episode[]): void
function buildSettingsPopup(episodes: Episode[]): void {
    const popup = document.getElementById('settings-popup');
    if (!popup) return;

    // LS キー → ボタンリストの対応（リセット時に active クラスを更新するため保持）
    const optEntries = new Map<string, Array<{ btn: HTMLButtonElement; value: string }>>();

    function readSetting(key: string, defaultVal: string): string {
        return localStorage.getItem(key) ?? defaultVal;
    }

    // 1行分の設定 UI（ラベル＋選択ボタン群）を生成する
    // buildRow(label, lsKey, defaultVal, opts): HTMLElement
    function buildRow(
        label: string,
        lsKey: string,
        defaultVal: string,
        opts: Array<{ value: string; label: string }>,
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = 'settings-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'settings-row__label';
        labelEl.textContent = label;
        row.appendChild(labelEl);

        const optsEl = document.createElement('div');
        optsEl.className = 'settings-row__opts';

        const current = readSetting(lsKey, defaultVal);
        const entries: Array<{ btn: HTMLButtonElement; value: string }> = [];

        for (const opt of opts) {
            const btn = document.createElement('button');
            btn.className = 'settings-opt';
            btn.type = 'button';
            btn.textContent = opt.label;
            if (current === opt.value) btn.classList.add('active');
            btn.addEventListener('click', () => {
                localStorage.setItem(lsKey, opt.value);
                for (const e of entries) {
                    e.btn.classList.toggle('active', e.value === opt.value);
                }
            });
            optsEl.appendChild(btn);
            entries.push({ btn, value: opt.value });
        }
        optEntries.set(lsKey, entries);
        row.appendChild(optsEl);
        return row;
    }

    // アクションボタン（クリア・リセット等）を生成する
    // buildAction(label, handler): HTMLButtonElement
    function buildAction(label: string, handler: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'settings-action';
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', handler);
        return btn;
    }

    // 全行の active クラスを localStorage の現在値に合わせて更新する（リセット時に使用）
    // refreshRows(): void
    function refreshRows(): void {
        const defs: [string, string][] = [
            [LS_FONT_SIZE,    DEFAULTS.fontSize],
            [LS_FONT_FAMILY,  DEFAULTS.fontFamily],
            [LS_LINE_GAP,     DEFAULTS.lineGap],
            [LS_WRITING_MODE, DEFAULTS.writingMode],
        ];
        for (const [key, def] of defs) {
            const current = readSetting(key, def);
            for (const e of optEntries.get(key) ?? []) {
                e.btn.classList.toggle('active', e.value === current);
            }
        }
    }

    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-panel__title';
    titleEl.textContent = '表示設定';
    panel.appendChild(titleEl);

    panel.appendChild(buildRow('文字サイズ', LS_FONT_SIZE, DEFAULTS.fontSize, [
        { value: 'small',  label: '小' },
        { value: 'medium', label: '中' },
        { value: 'large',  label: '大' },
    ]));
    panel.appendChild(buildRow('フォント', LS_FONT_FAMILY, DEFAULTS.fontFamily, [
        { value: 'serif', label: '明朝体' },
        { value: 'sans',  label: 'ゴシック体' },
    ]));
    panel.appendChild(buildRow('段落間の空行', LS_LINE_GAP, DEFAULTS.lineGap, [
        { value: 'on',  label: 'あり' },
        { value: 'off', label: 'なし' },
    ]));
    // 書字方向：目次は localStorage に保存するだけ（目次自体は横書き固定。次に本文ページを開いた時に axis が反映する）。
    panel.appendChild(buildRow('書字方向', LS_WRITING_MODE, DEFAULTS.writingMode, [
        { value: 'vertical',   label: '縦書き' },
        { value: 'horizontal', label: '横書き' },
    ]));

    const divider = document.createElement('div');
    divider.className = 'settings-divider';
    panel.appendChild(divider);

    panel.appendChild(buildAction('栞をクリア', () => {
        clearAllBookmarkSlots();
        renderBookmarks();
    }));
    panel.appendChild(buildAction('既読をクリア', () => {
        clearReached();
        renderEpisodes(episodes, loadReachedSections(), loadReadSections());
    }));
    panel.appendChild(buildAction('設定をリセット', () => {
        localStorage.removeItem(LS_FONT_SIZE);
        localStorage.removeItem(LS_FONT_FAMILY);
        localStorage.removeItem(LS_LINE_GAP);
        localStorage.removeItem(LS_WRITING_MODE);
        refreshRows();
    }));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => { popup.hidden = true; });
    panel.appendChild(closeBtn);

    popup.appendChild(panel);

    // ポップアップ背景クリックで閉じる
    popup.addEventListener('click', (e) => {
        if (e.target === popup) popup.hidden = true;
    });
}

// ----- 共有ポップアップ -----

// 共有ポップアップ（#share-popup）を DOM 構築し、背景クリックで閉じるイベントを登録する。
// 設定ポップアップと同じ .settings-panel / .settings-action / .settings-close 様式を流用する。
// buildSharePopup(sharePopup: HTMLElement): void
function buildSharePopup(sharePopup: HTMLElement): void {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-panel__title';
    titleEl.textContent = '共有';
    panel.appendChild(titleEl);

    const makeAction = (label: string, handler: () => void): HTMLButtonElement => {
        const btn = document.createElement('button');
        btn.className = 'settings-action';
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', () => { sharePopup.hidden = true; handler(); });
        return btn;
    };

    // 共有 URL は ?noga 等のクエリを落として自ページの正規 URL を出す（dev フラグを読者に渡さないため）
    const shareUrl = location.origin + location.pathname;
    panel.append(
        makeAction('リンクをコピー', () => {
            navigator.clipboard.writeText(shareUrl).catch(() => {});
        }),
        makeAction('Xでシェア', () => {
            window.open(
                `https://x.com/intent/tweet?url=${encodeURIComponent(shareUrl)}`,
                '_blank', 'noopener,noreferrer',
            );
        }),
        makeAction('LINEでシェア', () => {
            window.open(
                `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`,
                '_blank', 'noopener,noreferrer',
            );
        }),
    );

    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => { sharePopup.hidden = true; });
    panel.appendChild(closeBtn);

    sharePopup.appendChild(panel);

    sharePopup.addEventListener('click', (e) => {
        if (e.target === sharePopup) sharePopup.hidden = true;
    });
}

// ----- FAB メニュー -----

// 右下 FAB メニューを初期化する
// initFab(popup: HTMLElement, sharePopup: HTMLElement, episodes: Episode[]): void
function initFab(popup: HTMLElement, sharePopup: HTMLElement, episodes: Episode[]): void {
    const toggleOrNull = document.getElementById('fab-toggle');
    const panelOrNull  = document.getElementById('fab-panel');
    if (!toggleOrNull || !panelOrNull) return;

    // null でないことを確認済み。クロージャが非 null 型として参照できるよう再束縛する
    const toggle = toggleOrNull as HTMLButtonElement;
    const panel  = panelOrNull  as HTMLUListElement;

    function isOpen() { return !panel.hidden; }

    function openFab() {
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'メニューを閉じる');
        // 最初の項目にフォーカスを移す
        panel.querySelector<HTMLButtonElement>('.fab-item')?.focus();
    }

    function closeFab() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'メニューを開く');
    }

    // メニュー項目を1件追加する
    // addItem(label, handler): void
    function addItem(label: string, handler: () => void): void {
        const li = document.createElement('li');
        li.setAttribute('role', 'presentation');
        const btn = document.createElement('button');
        btn.className = 'fab-item';
        btn.type = 'button';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = label;
        btn.addEventListener('click', () => { closeFab(); handler(); });
        li.appendChild(btn);
        panel.appendChild(li);
    }

    // 続きから読む：オートセーブがある時だけ項目を出す（要件 06-7「なければ非表示」）
    const auto = loadAutoSave();
    if (auto) addItem('続きから読む', () => { resumeReading(auto); });
    addItem('栞をすべてクリア', () => {
        clearAllBookmarkSlots();
        renderBookmarks();
    });
    addItem('既読をクリア', () => {
        clearReached();
        renderEpisodes(episodes, loadReachedSections(), loadReadSections());
    });
    addItem('読破状況をクリア', () => {
        clearReadStatus();
        renderEpisodes(episodes, loadReachedSections(), loadReadSections());
    });
    addItem('設定', () => { popup.hidden = false; });
    addItem('共有', () => { sharePopup.hidden = false; });

    // トグルボタン
    toggle.addEventListener('click', () => { isOpen() ? closeFab() : openFab(); });

    // パネル外クリックで閉じる
    document.addEventListener('click', (e) => {
        const container = document.getElementById('fab-container');
        if (isOpen() && container && !container.contains(e.target as Node)) {
            closeFab();
        }
    });

    // パネル内の上下キーナビゲーション
    panel.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = Array.from(panel.querySelectorAll<HTMLButtonElement>('.fab-item'));
        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') {
            items[(idx + 1) % items.length]?.focus();
        } else {
            items[(idx - 1 + items.length) % items.length]?.focus();
        }
    });

    // Escape: 共有／設定ポップアップが開いていれば閉じる、それ以外は FAB をトグル
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!sharePopup.hidden) { sharePopup.hidden = true; return; }
        if (!popup.hidden) { popup.hidden = true; return; }
        isOpen() ? closeFab() : openFab();
    });
}

// ----- 更新履歴 -----

// 折りたたみトグルを初期化する（CHANGELOG_INITIAL_COUNT を超える分を隠す）
// _initChangelogToggle(listEl: HTMLElement, toggleBtn: HTMLButtonElement): void
function _initChangelogToggle(listEl: HTMLElement, toggleBtn: HTMLButtonElement | null): void {
    if (!toggleBtn) return;
    toggleBtn.hidden = false;
    toggleBtn.addEventListener('click', () => {
        const expanding = toggleBtn.textContent === 'すべて表示';
        listEl.querySelectorAll<HTMLLIElement>('li').forEach((item, i) => {
            if (i >= CHANGELOG_INITIAL_COUNT) item.hidden = !expanding;
        });
        toggleBtn.textContent = expanding ? '閉じる' : 'すべて表示';
    });
}

// コンテンツ更新履歴を DOM に描画する。ep ごとの差分リンク（SHA）を表示
// _renderContentChangelog(entries: ContentChangelogEntry[]): void
function _renderContentChangelog(entries: ContentChangelogEntry[]): void {
    const listEl    = document.getElementById('content-changelog-list');
    const toggleBtn = document.getElementById('content-changelog-toggle') as HTMLButtonElement | null;
    if (!listEl) return;
    listEl.innerHTML = '';

    const filtered = entries.filter(entry => entry.version.split('.')[2] === '0');
    filtered.forEach((entry, i) => {
        const li = document.createElement('li');
        li.className = 'cl-entry';

        const header = document.createElement('p');
        header.className = 'cl-header';

        const versionSpan = document.createElement('span');
        versionSpan.className = 'cl-version';
        versionSpan.textContent = `v${entry.version}`;
        header.appendChild(versionSpan);

        const dateSpan = document.createElement('span');
        dateSpan.className = 'cl-date';
        dateSpan.textContent = entry.date;
        header.appendChild(dateSpan);
        li.appendChild(header);

        const changeEl = document.createElement('p');
        changeEl.className = 'cl-change';
        changeEl.textContent = entry.change;
        li.appendChild(changeEl);

        if (entry.ep.length > 0) {
            const epLinks = document.createElement('div');
            epLinks.className = 'cl-ep-links';
            entry.ep.forEach((epNum, j) => {
                const link = document.createElement('a');
                link.href = `https://github.com/${GITHUB_REPO}/commit/${entry.sha[j]}`;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.className = 'cl-ep-link';
                link.textContent = `第${epNum}話`;
                epLinks.appendChild(link);
            });
            li.appendChild(epLinks);
        }

        if (i >= CHANGELOG_INITIAL_COUNT) li.hidden = true;
        listEl.appendChild(li);
    });

    if (filtered.length > CHANGELOG_INITIAL_COUNT) _initChangelogToggle(listEl, toggleBtn);
}

// ヒーローカードのバージョンバッジを更新する
// _updateVersionBadge(type: 'content' | 'site', version: string): void
function _updateVersionBadge(type: 'content' | 'site', version: string): void {
    const el = document.getElementById(`badge-${type}-version`);
    if (el) el.textContent = `${type} version ${version}`;
}

// changelog.json を fetch してバッジ更新・コンテンツ一覧描画を行う。失敗時はコンテンツセクションを非表示にする
// loadChangelog(type: 'content' | 'site'): Promise<void>
async function loadChangelog(type: 'content' | 'site'): Promise<void> {
    try {
        const res = await fetch(`changelog/${type}-changelog.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (type === 'content') {
            const entries = (await res.json()) as ContentChangelogEntry[];
            _updateVersionBadge('content', entries[0]?.version ?? '');
            _renderContentChangelog(entries);
        } else {
            const entries = (await res.json()) as SiteChangelogEntry[];
            _updateVersionBadge('site', entries[0]?.version ?? '');
        }
    } catch {
        if (type === 'content') {
            const section = document.getElementById('content-changelog');
            if (section) section.hidden = true;
        }
    }
}

// ----- エントリポイント -----

// main(): Promise<void>
async function main(): Promise<void> {
    // 栞・オートセーブのスキーマ移行（schemaVersion 5：単一スロット化＋スクロール範囲比への割合化）を確実に走らせる。
    // 目次は bookmark の表示 API は使わず localStorage を直読みするが、移行は bookmark.ts が一元管理するため init を起動する。
    bookmark.init();

    let episodes: Episode[] = [];

    try {
        const res = await fetch('episodes.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        episodes = (await res.json()) as Episode[];
    } catch {
        const area = document.getElementById('episodes-area');
        if (area) {
            area.innerHTML = '';
            const msg = document.createElement('p');
            msg.className = 'loading-text';
            msg.textContent = 'エピソードの読み込みに失敗しました。';
            area.appendChild(msg);
        }
    }

    _episodes = episodes;
    renderEpisodes(episodes, loadReachedSections(), loadReadSections());
    renderBookmarks();
    loadChangelog('content');
    loadChangelog('site');

    initResumeButton();

    const popup = document.getElementById('settings-popup');
    const sharePopup = document.getElementById('share-popup');
    if (popup && sharePopup) {
        buildSettingsPopup(episodes);
        buildSharePopup(sharePopup);
        initFab(popup, sharePopup, episodes);
    }
}

main();
