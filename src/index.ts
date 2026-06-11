/*
 * index.ts
 * 責務: 目次ページ（index.html）の全機能制御
 * export: なし（script type="module" としてロードされるエントリポイント）
 * 依存: なし（src/ 内の他モジュールは import しない）
 *
 * 機能:
 *   - episodes.json を fetch して ep・sec 一覧を動的生成
 *   - 到達セット（sec 単位）からセクション既読を表示（判定ロジックは持たず引くだけ）
 *   - 栞スロット（最大3件）を常時表示、個別クリア・ジャンプ対応（ジャンプは pendingJump を書く）
 *   - content-changelog.json を fetch してコンテンツ更新履歴を表示
 *   - site-changelog.json を fetch してサイトバージョンバッジを更新（詳細一覧は表示しない）
 *   - ヒーローカード右下に content version / site version バッジを表示
 *   - 右下 FAB メニュー（設定・栞クリア・既読クリア・共有）
 *   - 設定ポップアップ（localStorage の読み書きのみ。目次への反映なし）
 *
 * localStorage キー（bookmark.ts / settings.ts と共有。変更時は両側を合わせること）:
 *   "reached"            : string[]         到達 sec の集合 "ep-sec"（2桁ゼロ埋め）。既読マークの源
 *   "read"              : string[]         読了 sec の集合 "ep-sec"。クリア対象（表示には未使用）
 *   "bookmarks"          : BookmarkEntry[]  flat { ep, sec, scene, scrollLeft, savedAt }（旧 nested も後方互換で読む）
 *   "pendingJump"        : { ep, sec, scene, scrollLeft }   栞ジャンプ受け渡し（書くだけ・消費は遷移先ページ）
 *   "sceneRead"          : string[]         旧 "ep-sec-scene" 形式。移行前に目次を先に開いた返読者向けフォールバック
 *   "lirmena.fontSize"   : 'large' | 'medium' | 'small'   デフォルト 'medium'
 *   "lirmena.fontFamily" : 'serif' | 'sans'               デフォルト 'serif'
 *   "lirmena.lineGap"    : 'on' | 'off'                   デフォルト 'on'
 *
 * 既読マークは到達ベース（一般的な「開いたら既読」方式）。`reached` を引き、加えて移行前の返読者向けに
 * 旧 `sceneRead` の完了マーカー "ep-sec-00" もフォールバックで既読扱いする（bookmark.ts の移行と整合）。
 */

type Episode = { id: number; title: string; sections: { id: number; published: boolean }[] };
// 栞は flat 形。旧 nested 形（{ address }）は loadBookmarks() で flat に正規化して読む。
type BookmarkEntry = {
    ep: number;
    sec: number;
    scene: number;
    scrollLeft: number;
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
const LS_BOOKMARKS    = 'bookmarks';
const LS_PENDING_JUMP = 'pendingJump';
const LS_SCENE_READ   = 'sceneRead';
const LS_FONT_SIZE    = 'lirmena.fontSize';
const LS_FONT_FAMILY  = 'lirmena.fontFamily';
const LS_LINE_GAP     = 'lirmena.lineGap';

const DEFAULTS = { fontSize: 'medium', fontFamily: 'serif', lineGap: 'on' } as const;

const GITHUB_REPO = 'haguchikarasu/lirmena';

let _episodes: Episode[] = [];
const CHANGELOG_INITIAL_COUNT = 3;

// 数値を2桁ゼロ埋め文字列に変換する
// pad(n: number): string
const pad = (n: number) => String(n).padStart(2, '0');

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

// 到達済みセクションの "ep-sec" 集合を返す。
// 新スキーマの "reached"（到達ベース）に加え、移行前に目次を先に開いた返読者向けに
// 旧 "sceneRead" の完了マーカー "ep-sec-00" もフォールバックで取り込む。
// loadReachedSections(): Set<string>
function loadReachedSections(): Set<string> {
    const result = loadStringSet(LS_REACHED);
    for (const k of loadStringSet(LS_SCENE_READ)) {
        const parts = k.split('-'); // "ep-sec-scene"
        if (parts.length === 3 && parts[2] === '00') result.add(`${parts[0]}-${parts[1]}`);
    }
    return result;
}

// 栞リストを localStorage から読み込み flat 形に正規化する。flat・旧 nested の両方を受け付ける。
// loadBookmarks(): BookmarkEntry[]
function loadBookmarks(): BookmarkEntry[] {
    try {
        const raw = localStorage.getItem(LS_BOOKMARKS);
        if (!raw) return [];
        const list = JSON.parse(raw) as Array<Record<string, unknown>>;
        return list.map((o) => {
            const addr = (o.address ?? o) as Record<string, unknown>;
            return {
                ep: Number(addr.ep),
                sec: Number(addr.sec),
                scene: Number(addr.scene) || 0,
                scrollLeft: o.address ? 0 : (Number(o.scrollLeft) || 0),
                savedAt: Number(o.savedAt) || Date.now(),
            };
        }).filter((b) => Number.isFinite(b.ep) && Number.isFinite(b.sec));
    } catch { /* ignore */ }
    return [];
}

// ----- 既読判定 -----

// セクション既読判定: 到達セット（"ep-sec"）に含まれるかを返す（判定ロジックは持たず引くだけ）
// isSectionRead(ep: number, sec: number, reached: Set<string>): boolean
function isSectionRead(ep: number, sec: number, reached: Set<string>): boolean {
    return reached.has(`${pad(ep)}-${pad(sec)}`);
}

// 既読をすべて消す。新スキーマ（reached/read）に加え、フォールバック源の旧 sceneRead も消す。
// clearAllRead(): void
function clearAllRead(): void {
    localStorage.removeItem(LS_REACHED);
    localStorage.removeItem(LS_READ);
    localStorage.removeItem(LS_SCENE_READ);
}

// ----- ep・sec 一覧 -----

// ep・sec 一覧を動的生成する。未公開 sec・公開済み sec が0の ep は非表示
// renderEpisodes(episodes: Episode[], reached: Set<string>): void
function renderEpisodes(episodes: Episode[], reached: Set<string>): void {
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
        titleEl.textContent = `第${ep.id}話 ${ep.title}`;
        epEl.appendChild(titleEl);

        const secListEl = document.createElement('div');
        secListEl.className = 'idx-chips';

        for (const sec of publishedSecs) {
            const read = isSectionRead(ep.id, sec.id, reached);

            const link = document.createElement('a');
            link.className = 'idx-chip' + (read ? ' idx-chip--read' : '');
            link.href = `contents/${pad(ep.id)}-${pad(sec.id)}.html`;

            const labelEl = document.createElement('span');
            labelEl.textContent = pad(sec.id);
            if (read) link.setAttribute('aria-label', `${pad(sec.id)} 既読`);
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

// 栞スロットを描画する（再描画可）
// renderBookmarks(): void
function renderBookmarks(): void {
    const container = document.getElementById('bookmark-slots');
    if (!container) return;
    container.innerHTML = '';

    const bookmarks = loadBookmarks().sort((a, b) => b.savedAt - a.savedAt).slice(0, 3);

    if (bookmarks.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'bookmarks-empty';
        empty.textContent = '栞はまだありません。';
        container.appendChild(empty);
        return;
    }

    for (const entry of bookmarks) {
        const { ep, sec, scene } = entry;
        const d = new Date(entry.savedAt);
        const dateStr = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const href = `contents/${pad(ep)}-${pad(sec)}.html`;

        const slot = document.createElement('div');
        slot.className = 'idx-bm-card';

        const info = document.createElement('div');
        info.className = 'idx-bm-info';

        const epTitle = _episodes.find(e => e.id === ep)?.title ?? '';
        const epSecEl = document.createElement('p');
        epSecEl.className = 'idx-bm-loc';
        const locBase = epTitle ? `第${ep}話 ${epTitle} - ${pad(sec)}` : `第${ep}話 - ${pad(sec)}`;
        epSecEl.textContent = locBase + (scene === 0 ? '（タイトル画面）' : '');
        info.appendChild(epSecEl);

        const dateEl = document.createElement('p');
        dateEl.className = 'idx-bm-date';
        dateEl.textContent = dateStr;
        info.appendChild(dateEl);

        const actions = document.createElement('div');
        actions.className = 'idx-bm-btns';

        const jumpBtn = document.createElement('a');
        jumpBtn.className = 'idx-bm-go';
        jumpBtn.href = href;
        jumpBtn.textContent = 'ここから読む';
        // 遷移前に pendingJump を書く（同期。遷移先ページがロード時に読んで復元する＝消費は Phase 3）。
        jumpBtn.addEventListener('click', () => {
            localStorage.setItem(LS_PENDING_JUMP, JSON.stringify({ ep, sec, scene, scrollLeft: entry.scrollLeft }));
        });
        actions.appendChild(jumpBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'idx-bm-del';
        clearBtn.type = 'button';
        clearBtn.textContent = '削除';
        // savedAt でこの栞1件だけを削除して再描画する
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

        slot.appendChild(info);
        slot.appendChild(actions);
        container.appendChild(slot);
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
            [LS_FONT_SIZE,   DEFAULTS.fontSize],
            [LS_FONT_FAMILY, DEFAULTS.fontFamily],
            [LS_LINE_GAP,    DEFAULTS.lineGap],
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

    const divider = document.createElement('div');
    divider.className = 'settings-divider';
    panel.appendChild(divider);

    panel.appendChild(buildAction('栞をクリア', () => {
        localStorage.removeItem(LS_BOOKMARKS);
        renderBookmarks();
    }));
    panel.appendChild(buildAction('既読をクリア', () => {
        clearAllRead();
        renderEpisodes(episodes, new Set());
    }));
    panel.appendChild(buildAction('設定をリセット', () => {
        localStorage.removeItem(LS_FONT_SIZE);
        localStorage.removeItem(LS_FONT_FAMILY);
        localStorage.removeItem(LS_LINE_GAP);
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

// ----- FAB メニュー -----

// 右下 FAB メニューを初期化する
// initFab(popup: HTMLElement, episodes: Episode[]): void
function initFab(popup: HTMLElement, episodes: Episode[]): void {
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

    addItem('設定', () => { popup.hidden = false; });
    addItem('栞をすべてクリア', () => {
        localStorage.removeItem(LS_BOOKMARKS);
        renderBookmarks();
    });
    addItem('既読をクリア', () => {
        clearAllRead();
        renderEpisodes(episodes, new Set());
    });
    addItem('URLをコピー', async () => {
        try {
            await navigator.clipboard.writeText(location.href);
            alert('URLをコピーしました');
        } catch {
            alert('コピーに失敗しました。URLを手動でコピーしてください。');
        }
    });
    addItem('Xで共有', () => {
        window.open(
            `https://x.com/intent/tweet?url=${encodeURIComponent(location.href)}`,
            '_blank', 'noopener,noreferrer',
        );
    });
    addItem('LINEで共有', () => {
        window.open(
            `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(location.href)}`,
            '_blank', 'noopener,noreferrer',
        );
    });

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

    // Escape: 設定ポップアップが開いていれば閉じる、それ以外は FAB をトグル
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
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
    const reached = loadReachedSections();
    renderEpisodes(episodes, reached);
    renderBookmarks();
    loadChangelog('content');
    loadChangelog('site');

    const popup = document.getElementById('settings-popup');
    if (popup) {
        buildSettingsPopup(episodes);
        initFab(popup, episodes);
    }
}

main();
