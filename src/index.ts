/*
 * index.ts
 * 責務: 目次ページ（index.html）の全機能制御
 * export: なし（script type="module" としてロードされるエントリポイント）
 * 依存: なし（src/ 内の他モジュールは import しない）
 *
 * 機能:
 *   - episodes.json を fetch して ep・sec 一覧を動的生成
 *   - localStorage のシーン既読データからセクション既読を判定・表示
 *   - 栞スロット（最大3件）を常時表示、個別クリア・ジャンプ対応
 *   - content-changelog.json / site-changelog.json を fetch して更新履歴を表示
 *   - 右下 FAB メニュー（設定・栞クリア・既読クリア・共有）
 *   - 設定ポップアップ（localStorage の読み書きのみ。目次への反映なし）
 *
 * localStorage キー（bookmark.ts / settings.ts と共有。変更時は両側を合わせること）:
 *   "bookmarks"          : BookmarkEntry[]  { address:{ep,sec,scene}, scrollLeft, savedAt }
 *   "sceneRead"          : string[]         "ep-sec-scene" 形式（ゼロ埋め2桁）
 *   "lirmena.fontSize"   : 'large' | 'medium' | 'small'   デフォルト 'medium'
 *   "lirmena.fontFamily" : 'serif' | 'sans'               デフォルト 'serif'
 *   "lirmena.lineGap"    : 'on' | 'off'                   デフォルト 'on'
 */

type Episode = { id: number; title: string; sections: { id: number; published: boolean }[] };
type BookmarkEntry = {
    address: { ep: number; sec: number; scene: number };
    scrollLeft: number;
    savedAt: number;
};
type ChangelogEntry = {
    version: string;
    date: string;
    changes: string[];
};

// localStorage キー（bookmark.ts / settings.ts と同一）
const LS_BOOKMARKS    = 'bookmarks';
const LS_SCENE_READ   = 'sceneRead';
const LS_FONT_SIZE    = 'lirmena.fontSize';
const LS_FONT_FAMILY  = 'lirmena.fontFamily';
const LS_LINE_GAP     = 'lirmena.lineGap';

const DEFAULTS = { fontSize: 'medium', fontFamily: 'serif', lineGap: 'on' } as const;

const GITHUB_REPO = 'ユーザー名/リポジトリ名';

let _episodes: Episode[] = [];
const CHANGELOG_INITIAL_COUNT = 3;

// 数値を2桁ゼロ埋め文字列に変換する
// pad(n: number): string
const pad = (n: number) => String(n).padStart(2, '0');

// ----- localStorage ヘルパー -----

// sceneRead を localStorage から読み込む
// loadSceneRead(): Set<string>
function loadSceneRead(): Set<string> {
    try {
        const raw = localStorage.getItem(LS_SCENE_READ);
        if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set();
}

// 栞リストを localStorage から読み込む
// loadBookmarks(): BookmarkEntry[]
function loadBookmarks(): BookmarkEntry[] {
    try {
        const raw = localStorage.getItem(LS_BOOKMARKS);
        if (raw) return JSON.parse(raw) as BookmarkEntry[];
    } catch { /* ignore */ }
    return [];
}

// ----- 既読判定 -----

// セクション既読判定: bookmark.ts が最終シーン到達時に記録する完了マーカー "ep-sec-00" の有無を返す
// isSectionRead(ep: number, sec: number, sceneRead: Set<string>): boolean
function isSectionRead(ep: number, sec: number, sceneRead: Set<string>): boolean {
    return sceneRead.has(`${pad(ep)}-${pad(sec)}-00`);
}

// ----- ep・sec 一覧 -----

// ep・sec 一覧を動的生成する。未公開 sec・公開済み sec が0の ep は非表示
// renderEpisodes(episodes: Episode[], sceneRead: Set<string>): void
function renderEpisodes(episodes: Episode[], sceneRead: Set<string>): void {
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
        titleEl.textContent = ep.title;
        epEl.appendChild(titleEl);

        const secListEl = document.createElement('div');
        secListEl.className = 'idx-chips';

        for (const sec of publishedSecs) {
            const read = isSectionRead(ep.id, sec.id, sceneRead);

            const link = document.createElement('a');
            link.className = 'idx-chip' + (read ? ' idx-chip--read' : '');
            link.href = `contents.html#${pad(ep.id)}-${pad(sec.id)}-${sec.id === 1 ? '00' : '01'}`;

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
        const { ep, sec, scene } = entry.address;
        const d = new Date(entry.savedAt);
        const dateStr = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const href = `contents.html#${pad(ep)}-${pad(sec)}-${pad(scene)}`;

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
        jumpBtn.addEventListener('click', () => {
            sessionStorage.setItem('bookmark-scroll', String(entry.scrollLeft));
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
        localStorage.removeItem(LS_SCENE_READ);
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
        localStorage.removeItem(LS_SCENE_READ);
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

// changelog エントリを DOM に描画する。CHANGELOG_INITIAL_COUNT を超える分は折りたたむ
// _renderChangelog(type: 'content' | 'site', entries: ChangelogEntry[]): void
function _renderChangelog(type: 'content' | 'site', entries: ChangelogEntry[]): void {
    const listEl   = document.getElementById(`${type}-changelog-list`);
    const toggleBtn = document.getElementById(`${type}-changelog-toggle`) as HTMLButtonElement | null;
    if (!listEl) return;
    listEl.innerHTML = '';

    entries.forEach((entry, i) => {
        const li = document.createElement('li');
        li.className = 'cl-entry';

        const header = document.createElement('p');
        header.className = 'cl-header';

        // 1つ古いエントリ（i+1）との比較 URL。最古エントリにはリンクなし
        const prevEntry = entries[i + 1];
        if (prevEntry) {
            const link = document.createElement('a');
            link.href = `https://github.com/${GITHUB_REPO}/compare/${type}-v${prevEntry.version}...${type}-v${entry.version}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'cl-version';
            link.textContent = `v${entry.version}`;
            header.appendChild(link);
        } else {
            const span = document.createElement('span');
            span.className = 'cl-version';
            span.textContent = `v${entry.version}`;
            header.appendChild(span);
        }

        const dateSpan = document.createElement('span');
        dateSpan.className = 'cl-date';
        dateSpan.textContent = entry.date;
        header.appendChild(dateSpan);
        li.appendChild(header);

        const changesList = document.createElement('ul');
        changesList.className = 'cl-changes';
        for (const change of entry.changes) {
            const changeLi = document.createElement('li');
            changeLi.textContent = change;
            changesList.appendChild(changeLi);
        }
        li.appendChild(changesList);

        if (i >= CHANGELOG_INITIAL_COUNT) li.hidden = true;
        listEl.appendChild(li);
    });

    if (entries.length > CHANGELOG_INITIAL_COUNT && toggleBtn) {
        toggleBtn.hidden = false;
        toggleBtn.addEventListener('click', () => {
            const expanding = toggleBtn.textContent === 'すべて表示';
            listEl.querySelectorAll<HTMLLIElement>('li').forEach((item, i) => {
                if (i >= CHANGELOG_INITIAL_COUNT) item.hidden = !expanding;
            });
            toggleBtn.textContent = expanding ? '閉じる' : 'すべて表示';
        });
    }
}

// changelog.json を fetch して描画する。失敗時はセクションを非表示にする
// loadChangelog(type: 'content' | 'site'): Promise<void>
async function loadChangelog(type: 'content' | 'site'): Promise<void> {
    try {
        const res = await fetch(`${type}-changelog.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const entries = (await res.json()) as ChangelogEntry[];
        _renderChangelog(type, entries);
    } catch {
        const section = document.getElementById(`${type}-changelog`);
        if (section) section.hidden = true;
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
    const sceneRead = loadSceneRead();
    renderEpisodes(episodes, sceneRead);
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
