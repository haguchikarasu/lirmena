/*
 * settings.ts
 * 責務: フォントサイズ・フォント・段落間マージンの localStorage 保存・CSS変数反映・ポップアップ開閉
 * export: init(), open()
 * 依存: なし（栞・既読クリアのコールバックは main.ts から注入）
 *
 * 設定項目とデフォルト値（定数で定義）:
 *   fontSize:   "large" | "medium" | "small"   デフォルト "medium"
 *   fontFamily: "serif" | "sans"               デフォルト "serif"
 *   lineGap:    "on" | "off"                   デフォルト "on"
 *
 * CSS変数:
 *   --font-size, --font-family, --paragraph-margin（値は CSS 変数定義ファイルで管理）
 */

type FontSize = 'large' | 'medium' | 'small';
type FontFamily = 'serif' | 'sans';
type LineGap = 'on' | 'off';

interface Settings {
    fontSize: FontSize;
    fontFamily: FontFamily;
    lineGap: LineGap;
}

const DEFAULTS: Settings = {
    fontSize: 'medium',
    fontFamily: 'serif',
    lineGap: 'on',
};

const LS_KEYS: Record<keyof Settings, string> = {
    fontSize: 'lirmena.fontSize',
    fontFamily: 'lirmena.fontFamily',
    lineGap: 'lirmena.lineGap',
};

const CSS_VARS = {
    fontSize: { large: 'var(--font-size-lg)', medium: 'var(--font-size-md)', small: 'var(--font-size-sm)' },
    fontFamily: { serif: 'var(--font-family-serif)', sans: 'var(--font-family-sans)' },
    lineGap: { on: 'var(--paragraph-margin-on)', off: 'var(--paragraph-margin-off)' },
} satisfies { fontSize: Record<FontSize, string>; fontFamily: Record<FontFamily, string>; lineGap: Record<LineGap, string> };

let _current: Settings = { ...DEFAULTS };
let _callbacks: { onClearBookmarks: () => void; onClearRead: () => void } = {
    onClearBookmarks: () => {},
    onClearRead: () => {},
};
let _popup: HTMLElement | null = null;
const _optEntries = new Map<keyof Settings, Array<{ btn: HTMLButtonElement; value: string }>>();

// 設定を localStorage から復元し CSS 変数に反映する。
// callbacks.onClearBookmarks / onClearRead を設定画面のクリアボタンに割り当てる。
// init(callbacks: { onClearBookmarks: () => void; onClearRead: () => void }): void
export function init(callbacks: { onClearBookmarks: () => void; onClearRead: () => void }): void {
    _callbacks = callbacks;
    _current = _load();
    _applyAll();
    _buildPopup();
}

// 設定ポップアップを開く（#settings-popup の hidden 属性を外す）。
// open(): void
export function open(): void {
    if (_popup) _popup.hidden = false;
}

// 全設定項目を localStorage から読み込んで返す。
// 未設定・不正値は DEFAULTS にフォールバックする。
// _load(): Settings
function _load(): Settings {
    return {
        fontSize: _readEnum(LS_KEYS.fontSize, ['large', 'medium', 'small'] as const, DEFAULTS.fontSize),
        fontFamily: _readEnum(LS_KEYS.fontFamily, ['serif', 'sans'] as const, DEFAULTS.fontFamily),
        lineGap: _readEnum(LS_KEYS.lineGap, ['on', 'off'] as const, DEFAULTS.lineGap),
    };
}

// localStorage から key を読み取り、valid に含まれる値なら返す。未設定・不正値は fallback を返す。
// _readEnum<T extends string>(key: string, valid: readonly T[], fallback: T): T
function _readEnum<T extends string>(key: string, valid: readonly T[], fallback: T): T {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return (valid as readonly string[]).includes(v) ? (v as T) : fallback;
}

// _current の全設定項目に対応する CSS 変数を document.documentElement に反映する。
// _applyAll(): void
function _applyAll(): void {
    const root = document.documentElement;
    root.style.setProperty('--font-size', CSS_VARS.fontSize[_current.fontSize]);
    root.style.setProperty('--font-family', CSS_VARS.fontFamily[_current.fontFamily]);
    root.style.setProperty('--paragraph-margin', CSS_VARS.lineGap[_current.lineGap]);
}

// key に対応する CSS 変数のみを _current の値で反映する（ボタン操作時の単一項目更新用）。
// _applySetting(key: keyof Settings): void
function _applySetting(key: keyof Settings): void {
    const root = document.documentElement;
    if (key === 'fontSize') {
        root.style.setProperty('--font-size', CSS_VARS.fontSize[_current.fontSize]);
    } else if (key === 'fontFamily') {
        root.style.setProperty('--font-family', CSS_VARS.fontFamily[_current.fontFamily]);
    } else {
        root.style.setProperty('--paragraph-margin', CSS_VARS.lineGap[_current.lineGap]);
    }
}

// _current の全設定項目を localStorage に保存する（リセット時に使用）。
// _saveAll(): void
function _saveAll(): void {
    for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
        localStorage.setItem(LS_KEYS[key], _current[key]);
    }
}

// #settings-popup 内に設定パネルを DOM 生成し、各種イベントを登録する。
// パネル外クリック・ESC キーで閉じる挙動もここで設定する。
// 依存: #settings-popup（DOM）
// _buildPopup(): void
function _buildPopup(): void {
    _popup = document.querySelector<HTMLElement>('#settings-popup');
    if (!_popup) return;

    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-panel__title';
    titleEl.textContent = '表示設定';
    panel.appendChild(titleEl);

    panel.appendChild(_buildRow('文字サイズ', 'fontSize', [
        { value: 'small', label: '小' },
        { value: 'medium', label: '中' },
        { value: 'large', label: '大' },
    ]));
    panel.appendChild(_buildRow('フォント', 'fontFamily', [
        { value: 'serif', label: '明朝体' },
        { value: 'sans', label: 'ゴシック体' },
    ]));
    panel.appendChild(_buildRow('段落間の空行', 'lineGap', [
        { value: 'on', label: 'あり' },
        { value: 'off', label: 'なし' },
    ]));

    const divider = document.createElement('div');
    divider.className = 'settings-divider';
    panel.appendChild(divider);

    panel.appendChild(_buildAction('栞をクリア', () => { _callbacks.onClearBookmarks(); }));
    panel.appendChild(_buildAction('既読をクリア', () => { _callbacks.onClearRead(); }));
    panel.appendChild(_buildAction('設定をリセット', () => {
        _current = { ...DEFAULTS };
        _saveAll();
        _applyAll();
        _refreshOpts();
    }));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => { _popup!.hidden = true; });
    panel.appendChild(closeBtn);

    _popup.appendChild(panel);

    _popup.addEventListener('click', (e) => {
        if (e.target === _popup) _popup!.hidden = true;
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _popup && !_popup.hidden) _popup.hidden = true;
    });
}

// 設定1項目分の行要素（ラベル＋選択ボタン群）を生成して返す。
// 生成したボタンを _optEntries に登録し、_refreshRow から参照できるようにする。
// _buildRow(label: string, key: keyof Settings, opts: Array<{ value: string; label: string }>): HTMLElement
function _buildRow(
    label: string,
    key: keyof Settings,
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

    const entries: Array<{ btn: HTMLButtonElement; value: string }> = [];
    for (const opt of opts) {
        const btn = document.createElement('button');
        btn.className = 'settings-opt';
        btn.type = 'button';
        btn.textContent = opt.label;
        if ((_current[key] as string) === opt.value) btn.classList.add('active');
        btn.addEventListener('click', () => {
            Object.assign(_current, { [key]: opt.value });
            localStorage.setItem(LS_KEYS[key], opt.value);
            _applySetting(key);
            _refreshRow(key);
        });
        optsEl.appendChild(btn);
        entries.push({ btn, value: opt.value });
    }
    _optEntries.set(key, entries);
    row.appendChild(optsEl);

    return row;
}

// アクションボタン（栞クリア・既読クリア・リセット）を生成して返す。
// _buildAction(label: string, handler: () => void): HTMLButtonElement
function _buildAction(label: string, handler: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'settings-action';
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', handler);
    return btn;
}

// key の行にある選択ボタンの .active クラスを _current の値に合わせて更新する。
// _refreshRow(key: keyof Settings): void
function _refreshRow(key: keyof Settings): void {
    const entries = _optEntries.get(key);
    if (!entries) return;
    const current = _current[key] as string;
    for (const { btn, value } of entries) {
        btn.classList.toggle('active', value === current);
    }
}

// 全設定行の選択ボタンの .active クラスを _current の値に合わせて一括更新する（リセット時に使用）。
// _refreshOpts(): void
function _refreshOpts(): void {
    for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
        _refreshRow(key);
    }
}
