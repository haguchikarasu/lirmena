/*
 * settings.ts
 * 責務: 書字方向・段落の区切り（空行／字下げ）・フォント・文字サイズ・文字の太さ・読書点位置の localStorage 保存・反映（CSS変数 or 属性）・ポップアップ開閉
 * export: init(), open(), getReadingAnchor(), setReadingAnchor(), getSettings()
 * 依存: なし（栞・既読・読破のクリア・書字方向変更後の処理のコールバックは main.ts から注入）
 *   書字方向を切り替えたら onWritingModeChange() を呼ぶ（実際に値が変わったときだけ）。main.ts がこれを受けて
 *   切替前の読書位置（reader.getLastRatio）を新方向のスクロール量へ復元し、マーカー再配置・背景再 emit を行う（A-4）。
 *   3つのクリアボタン（栞をクリア／既読をクリア／読破状況をクリア）は window.confirm() で承認を取ってから callback を呼ぶ。
 *   getSettings(): Settings は現在の表示設定（書字方向・段落間空行・フォント・文字サイズ・文字の太さ）のコピーを返す。
 *   main.ts が analytics.send() への引数として使う（表示設定は settings.ts が単一の源として所有）。
 *
 * 設定項目とデフォルト値（定数で定義）。以下は**設定パネルの行順**（＝要件 06-4 の設定項目表の順）で並べてある。
 * 下の Settings / DEFAULTS / LS_KEYS / _load() の宣言順とは独立（_saveAll / _refreshOpts は Object.keys 走査で順序非依存）:
 *   writingMode:  "vertical" | "horizontal"      デフォルト "horizontal"（CSS変数でなく <html data-writing-mode> 属性へ反映）
 *   lineGap:      "on" | "off"                   デフォルト "on"
 *   fontFamily:   "serif" | "sans"               デフォルト "serif"
 *   fontSize:     "large" | "medium" | "small"   デフォルト "medium"
 *   fontWeight:   "normal" | "bold"              デフォルト "normal"（通常=400 / 太字=700。本文段落にのみ効く）
 *   readingAnchor: 連続 %（本文表示幅基準）       デフォルト READING_ANCHOR_DEFAULT（中央〜やや読み終わり側）
 *
 * CSS変数:
 *   --font-size, --font-family, --paragraph-margin, --paragraph-indent, --font-weight（値は CSS 変数定義ファイルで管理）
 *   lineGap だけは CSS 変数を2本（--paragraph-margin と --paragraph-indent）**必ずセットで**駆動する。
 *     段落の区切りは空行か字下げのどちらか一方で表すため（要件 06-4）。あり＝マージン 1em・字下げ 0、
 *     なし＝マージン 0・字下げ 1em。片方だけ書くと両方効いて二重の段落区切りに戻る。
 *     字下げの適用先は renderer が .indent を付けた段落だけ（行頭が全角スペース／始め括弧類なら付かない・要件 05-4）。
 *   --reading-anchor: 読書点（基準点）の連続 % 値。settings.ts が単一の源として所有・永続化する。
 *     tutorial.ts のドラッグが setReadingAnchor() を呼んで更新し、bg.ts は CSS 変数を読むのみ（要件 06-4 / 06-12）。
 *
 * 書字方向の契約: writingMode だけは CSS 変数でなく <html data-writing-mode> 属性へ反映する。
 *   axis.ts がこの属性を唯一の真実源として読む。settings→axis の import は張らず、DOM 属性＋localStorage キーで疎結合に保つ
 *   （.dependency-cruiser.cjs の allowed に settings→axis は無い＝依存を張らないことが機械で守られている）。
 */

type FontSize = 'large' | 'medium' | 'small';
type FontFamily = 'serif' | 'sans';
type LineGap = 'on' | 'off';
type FontWeight = 'normal' | 'bold';
// axis.ts の WritingMode と同値。両者は import で結ばず <html data-writing-mode> 属性＝DOM 契約で疎結合に保つ。
type WritingMode = 'vertical' | 'horizontal';

export interface Settings {
    fontSize: FontSize;
    fontFamily: FontFamily;
    lineGap: LineGap;
    fontWeight: FontWeight;
    writingMode: WritingMode;
}

const DEFAULTS: Settings = {
    fontSize: 'medium',
    fontFamily: 'serif',
    lineGap: 'on',
    fontWeight: 'normal',
    writingMode: 'horizontal',
};

const LS_KEYS: Record<keyof Settings, string> = {
    fontSize: 'lirmena.fontSize',
    fontFamily: 'lirmena.fontFamily',
    lineGap: 'lirmena.lineGap',
    fontWeight: 'lirmena.fontWeight',
    writingMode: 'lirmena.writingMode',
};

// 読書点（基準点）。本文表示幅基準の連続 % 値。中央（50）よりやや読み終わり側（縦書きでは左寄り）。
const READING_ANCHOR_DEFAULT = 45;
const LS_READING_ANCHOR = 'lirmena.readingAnchor';
let _readingAnchor = READING_ANCHOR_DEFAULT;

const CSS_VARS = {
    fontSize: { large: 'var(--font-size-lg)', medium: 'var(--font-size-md)', small: 'var(--font-size-sm)' },
    fontFamily: { serif: 'var(--font-family-serif)', sans: 'var(--font-family-sans)' },
    lineGap: { on: 'var(--paragraph-margin-on)', off: 'var(--paragraph-margin-off)' },
    fontWeight: { normal: 'var(--font-weight-normal)', bold: 'var(--font-weight-bold)' },
} satisfies { fontSize: Record<FontSize, string>; fontFamily: Record<FontFamily, string>; lineGap: Record<LineGap, string>; fontWeight: Record<FontWeight, string> };

// lineGap が駆動するもう1本の CSS 変数（CSS_VARS は Settings のキーに縛られているので別に持つ）。
// 値の向きに注意：キーは設定「段落間の空行」の値であって字下げの有無ではない（空行あり→字下げ 0em）。
const PARAGRAPH_INDENT: Record<LineGap, string> = {
    on: 'var(--paragraph-indent-on)',
    off: 'var(--paragraph-indent-off)',
};

let _current: Settings = { ...DEFAULTS };
let _callbacks: { onClearBookmarks: () => void; onClearReached: () => void; onClearRead: () => void; onWritingModeChange: () => void } = {
    onClearBookmarks: () => {},
    onClearReached: () => {},
    onClearRead: () => {},
    onWritingModeChange: () => {},
};
let _popup: HTMLElement | null = null;
const _optEntries = new Map<keyof Settings, Array<{ btn: HTMLButtonElement; value: string }>>();

// 設定を localStorage から復元し CSS 変数に反映する。
// callbacks.onClearBookmarks / onClearReached / onClearRead を設定画面の3クリアボタン（栞・既読・読破状況）に、
// onWritingModeChange を書字方向変更後の復元に割り当てる。
// init(callbacks: { onClearBookmarks: () => void; onClearReached: () => void; onClearRead: () => void; onWritingModeChange: () => void }): void
export function init(callbacks: { onClearBookmarks: () => void; onClearReached: () => void; onClearRead: () => void; onWritingModeChange: () => void }): void {
    _callbacks = callbacks;
    _current = _load();
    _readingAnchor = _loadReadingAnchor();
    _applyAll();
    _applyReadingAnchor();
    _buildPopup();
}

// 設定ポップアップを開く（#settings-popup の hidden 属性を外す）。
// open(): void
export function open(): void {
    if (_popup) _popup.hidden = false;
}

// 読書点（基準点）の現在値を % で返す。bg.ts は CSS 変数経由で読むが、tutorial.ts はドラッグ初期値に使う。
// getReadingAnchor(): number
export function getReadingAnchor(): number {
    return _readingAnchor;
}

// 現在の全設定項目のコピーを返す（呼び出し側が変更しても内部状態に影響しない）。
// main.ts が analytics.send() への引数として使う。
// getSettings(): Settings
export function getSettings(): Settings {
    return { ..._current };
}

// 読書点を % で設定し、localStorage 保存＋ CSS 変数 --reading-anchor へ反映する。[0,100] にクランプ。
// tutorial.ts のドロップが呼ぶ（ドラッグ中のライブ更新は tutorial が CSS 変数を直接書く）。
// setReadingAnchor(percent: number): void
export function setReadingAnchor(percent: number): void {
    _readingAnchor = Math.min(100, Math.max(0, percent));
    localStorage.setItem(LS_READING_ANCHOR, String(_readingAnchor));
    _applyReadingAnchor();
}

// localStorage から読書点を読み込む。未設定・不正値は READING_ANCHOR_DEFAULT。
// _loadReadingAnchor(): number
function _loadReadingAnchor(): number {
    const raw = localStorage.getItem(LS_READING_ANCHOR);
    const v = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(v)) return READING_ANCHOR_DEFAULT;
    return Math.min(100, Math.max(0, v));
}

// _readingAnchor を CSS 変数 --reading-anchor（"45%"）として documentElement に反映する。
// _applyReadingAnchor(): void
function _applyReadingAnchor(): void {
    document.documentElement.style.setProperty('--reading-anchor', `${_readingAnchor}%`);
}

// 全設定項目を localStorage から読み込んで返す。
// 未設定・不正値は DEFAULTS にフォールバックする。
// _load(): Settings
function _load(): Settings {
    return {
        fontSize: _readEnum(LS_KEYS.fontSize, ['large', 'medium', 'small'] as const, DEFAULTS.fontSize),
        fontFamily: _readEnum(LS_KEYS.fontFamily, ['serif', 'sans'] as const, DEFAULTS.fontFamily),
        lineGap: _readEnum(LS_KEYS.lineGap, ['on', 'off'] as const, DEFAULTS.lineGap),
        fontWeight: _readEnum(LS_KEYS.fontWeight, ['normal', 'bold'] as const, DEFAULTS.fontWeight),
        writingMode: _readEnum(LS_KEYS.writingMode, ['vertical', 'horizontal'] as const, DEFAULTS.writingMode),
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
    root.style.setProperty('--paragraph-indent', PARAGRAPH_INDENT[_current.lineGap]);
    root.style.setProperty('--font-weight', CSS_VARS.fontWeight[_current.fontWeight]);
    root.setAttribute('data-writing-mode', _current.writingMode);
}

// key に対応する反映先のみを _current の値で更新する（ボタン操作時の単一項目更新用）。
// 通常は CSS 変数だが、writingMode だけは <html data-writing-mode> 属性へ反映する。
// _applySetting(key: keyof Settings): void
function _applySetting(key: keyof Settings): void {
    const root = document.documentElement;
    if (key === 'fontSize') {
        root.style.setProperty('--font-size', CSS_VARS.fontSize[_current.fontSize]);
    } else if (key === 'fontFamily') {
        root.style.setProperty('--font-family', CSS_VARS.fontFamily[_current.fontFamily]);
    } else if (key === 'lineGap') {
        // 段落間マージンと字下げは排他。2本セットで書く（片方だけだと二重の段落区切りに戻る）。
        root.style.setProperty('--paragraph-margin', CSS_VARS.lineGap[_current.lineGap]);
        root.style.setProperty('--paragraph-indent', PARAGRAPH_INDENT[_current.lineGap]);
    } else if (key === 'fontWeight') {
        root.style.setProperty('--font-weight', CSS_VARS.fontWeight[_current.fontWeight]);
    } else {
        // writingMode: CSS 変数でなく属性へ。axis.ts がこの属性を読む。
        root.setAttribute('data-writing-mode', _current.writingMode);
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
// 設定行の並びは要件 06-4 の設定項目表の順（書字方向→段落間の空行→フォント→文字サイズ→文字の太さ）。
// 目次ページ src/index.ts の buildSettingsPopup() が同じ markup・同じ localStorage キーで**同じ並び**を
// 手で揃えた二重実装になっている（index.ts は settings.ts を import しない＝リーフ間非依存を保つため）。
// 行を足す・並びを変えるときは index.ts 側も同時に直すこと（向こうは行定義・refreshRows の defs・
// リセットの removeItem・IF コメントが別々なので追従漏れが起きやすい）。ズレは e2e/settings-order.spec.ts が検出する。
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

    panel.appendChild(_buildRow('書字方向', 'writingMode', [
        { value: 'vertical', label: '縦書き' },
        { value: 'horizontal', label: '横書き' },
    ]));
    panel.appendChild(_buildRow('段落間の空行', 'lineGap', [
        { value: 'on', label: 'あり' },
        { value: 'off', label: 'なし' },
    ]));
    panel.appendChild(_buildRow('フォント', 'fontFamily', [
        { value: 'serif', label: '明朝体' },
        { value: 'sans', label: 'ゴシック体' },
    ]));
    panel.appendChild(_buildRow('文字サイズ', 'fontSize', [
        { value: 'small', label: '小' },
        { value: 'medium', label: '中' },
        { value: 'large', label: '大' },
    ]));
    panel.appendChild(_buildRow('文字の太さ', 'fontWeight', [
        { value: 'normal', label: '通常' },
        { value: 'bold', label: '太字' },
    ]));

    const divider = document.createElement('div');
    divider.className = 'settings-divider';
    panel.appendChild(divider);

    panel.appendChild(_buildAction('栞をクリア', () => {
        _confirmAndRun('保存した栞をすべて削除しますか？', () => _callbacks.onClearBookmarks());
    }));
    panel.appendChild(_buildAction('既読をクリア', () => {
        _confirmAndRun('既読の記録をすべて削除しますか？', () => _callbacks.onClearReached());
    }));
    panel.appendChild(_buildAction('読破状況をクリア', () => {
        _confirmAndRun('読破の記録をすべて削除しますか？', () => _callbacks.onClearRead());
    }));
    panel.appendChild(_buildAction('設定をリセット', () => {
        const modeChanged = _current.writingMode !== DEFAULTS.writingMode;
        _current = { ...DEFAULTS };
        _saveAll();
        _applyAll();
        setReadingAnchor(READING_ANCHOR_DEFAULT);
        _refreshOpts();
        // リセットで書字方向が変わったら（縦書き→既定の横書き）切替前位置を復元する（A-4）。
        if (modeChanged) _callbacks.onWritingModeChange();
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
            const changed = (_current[key] as string) !== opt.value;
            Object.assign(_current, { [key]: opt.value });
            localStorage.setItem(LS_KEYS[key], opt.value);
            _applySetting(key);
            _refreshRow(key);
            // 書字方向を実際に切り替えたときだけ、main.ts に切替前位置の復元・マーカー再配置を依頼する（A-4）。
            if (key === 'writingMode' && changed) _callbacks.onWritingModeChange();
        });
        optsEl.appendChild(btn);
        entries.push({ btn, value: opt.value });
    }
    _optEntries.set(key, entries);
    row.appendChild(optsEl);

    return row;
}

// アクションボタン（栞クリア・既読クリア・読破状況クリア・リセット）を生成して返す。
// _buildAction(label: string, handler: () => void): HTMLButtonElement
function _buildAction(label: string, handler: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'settings-action';
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', handler);
    return btn;
}

// destructive アクション（栞・既読・読破の削除）用の confirm ラッパ。OK なら run() を呼ぶ、キャンセルなら何もしない。
// _confirmAndRun(msg: string, run: () => void): void
function _confirmAndRun(msg: string, run: () => void): void {
    if (window.confirm(msg)) run();
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
