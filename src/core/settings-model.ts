/*
 * core/settings-model.ts
 * 責務: 表示設定（書字方向・段落の区切り・フォント・文字サイズ・文字の太さ）と読書点の「値」の規則。
 *       localStorage のキー・既定値・有効値・プリセットの定義と、その読み書きを持つ。
 *       **画面への反映（CSS 変数・<html data-writing-mode>）は持たない**＝本文側の settings.ts（reader 層）だけが行う。
 *       目次はこのモジュールと ui/settings-panel だけを使うので、目次の <html> に書字方向が書かれて目次が縦書きになる
 *       事故が構造的に起きない。
 * export: 型 Settings / PresetId / Preset / FontSize / FontFamily / LineGap / FontWeight / WritingMode
 *         DEFAULTS: Readonly<Settings>                 — 既定値（どちらのプリセットとも一致しない）
 *         PRESETS: readonly Preset[]                   — プリセット定義の単一の源（ウェブ小説風／書籍風）
 *         LS_KEYS: Readonly<Record<keyof Settings, string>> — 表示設定 5 項目の localStorage キー
 *         READING_ANCHOR_DEFAULT: number / LS_READING_ANCHOR: string
 *         loadSettings(): Settings                     — 未設定・不正値は既定へ倒す
 *         saveSetting(key: keyof Settings, value: string): void
 *         saveSettings(values: Settings): void         — 5 項目を全部書く
 *         removeSettings(): void                       — 5 項目と読書点のキーを消す（目次の「設定をリセット」）
 *         loadReadingAnchor(): number                  — 未設定・不正値は既定、[0,100] にクランプ
 *         saveReadingAnchor(percent: number): number   — [0,100] にクランプして保存し、保存した値を返す
 *         sameSettings(a: Settings, b: Settings): boolean
 *         activePresetId(values: Settings): PresetId | null — 完全一致するプリセット。無ければ null（＝カスタム）
 * 依存: なし（document・要素に触らない。localStorage は使う）＝core 層。
 *       呼び出し元：settings.ts（本文の反映）、index.ts（目次）、firstrun.ts は settings.ts 経由。
 *
 * Preset.values は Partial<Settings> ではなく Settings（全キー必須）＝6つ目の設定項目を足したとき、
 * プリセット側の定義漏れが tsc で落ちる。desc は values から導ける文字列を手で書いたもので、
 * 食い違いは settings.test.ts が導出ルールで突き合わせて検出する。
 * 以前は目次（index.ts）が PRESETS・既定値・有効値の複製を持っていた（e2e/settings-preset.spec.ts が同期を見張っていた）。
 */

export type FontSize = 'large' | 'medium' | 'small';
export type FontFamily = 'serif' | 'sans';
export type LineGap = 'on' | 'off';
export type FontWeight = 'normal' | 'bold';
// axis.ts の WritingMode と同値。両者は import で結ばず <html data-writing-mode> 属性＝DOM 契約で疎結合に保つ。
export type WritingMode = 'vertical' | 'horizontal';

export interface Settings {
    fontSize: FontSize;
    fontFamily: FontFamily;
    lineGap: LineGap;
    fontWeight: FontWeight;
    writingMode: WritingMode;
}

export const DEFAULTS: Readonly<Settings> = {
    fontSize: 'medium',
    fontFamily: 'serif',
    lineGap: 'on',
    fontWeight: 'normal',
    writingMode: 'horizontal',
};

export type PresetId = 'web' | 'book';

export interface Preset {
    id: PresetId;
    name: string;
    desc: string;
    values: Settings;
}

// **どちらの values も DEFAULTS とは一致しない**（初回に読み方を質問する導線の前提。settings.test.ts が固定している）。
export const PRESETS: readonly Preset[] = [
    {
        id: 'web',
        name: 'ウェブ小説風',
        desc: '横書き・空行あり / ゴシック体',
        values: { writingMode: 'horizontal', lineGap: 'on', fontFamily: 'sans', fontSize: 'medium', fontWeight: 'normal' },
    },
    {
        id: 'book',
        name: '書籍風',
        desc: '縦書き・字下げ / 明朝体',
        values: { writingMode: 'vertical', lineGap: 'off', fontFamily: 'serif', fontSize: 'medium', fontWeight: 'normal' },
    },
];

export const LS_KEYS: Readonly<Record<keyof Settings, string>> = {
    fontSize: 'lirmena.fontSize',
    fontFamily: 'lirmena.fontFamily',
    lineGap: 'lirmena.lineGap',
    fontWeight: 'lirmena.fontWeight',
    writingMode: 'lirmena.writingMode',
};

// 読書点（基準点）。本文表示幅基準の連続 % 値。中央（50）よりやや読み終わり側（縦書きでは左寄り）。
export const READING_ANCHOR_DEFAULT = 45;
export const LS_READING_ANCHOR = 'lirmena.readingAnchor';

// 全設定項目を localStorage から読む。未設定・不正値は DEFAULTS へ倒す
// （目次と本文で同じ規則にする＝残留値があっても両ページのプリセット選択表示がズレない）。
// loadSettings(): Settings
export function loadSettings(): Settings {
    return {
        fontSize: _readEnum(LS_KEYS.fontSize, ['large', 'medium', 'small'] as const, DEFAULTS.fontSize),
        fontFamily: _readEnum(LS_KEYS.fontFamily, ['serif', 'sans'] as const, DEFAULTS.fontFamily),
        lineGap: _readEnum(LS_KEYS.lineGap, ['on', 'off'] as const, DEFAULTS.lineGap),
        fontWeight: _readEnum(LS_KEYS.fontWeight, ['normal', 'bold'] as const, DEFAULTS.fontWeight),
        writingMode: _readEnum(LS_KEYS.writingMode, ['vertical', 'horizontal'] as const, DEFAULTS.writingMode),
    };
}

// 1 項目だけ保存する（設定行のボタン）。
// saveSetting(key: keyof Settings, value: string): void
export function saveSetting(key: keyof Settings, value: string): void {
    localStorage.setItem(LS_KEYS[key], value);
}

// 5 項目すべてを保存する（プリセット・本文の「設定をリセット」）。
// saveSettings(values: Settings): void
export function saveSettings(values: Settings): void {
    for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
        localStorage.setItem(LS_KEYS[key], values[key]);
    }
}

// 5 項目と読書点のキーを消す（目次の「設定をリセット」）。読み手（loadSettings / loadReadingAnchor）が
// null を既定へ倒すので、本文側の「既定値を書く」リセットと読み手にとっては同値。
// 読書点を含めるのは「設定をリセット」がグローバルな初期化だから（要件 06-4）。
// removeSettings(): void
export function removeSettings(): void {
    for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
        localStorage.removeItem(LS_KEYS[key]);
    }
    localStorage.removeItem(LS_READING_ANCHOR);
}

// localStorage から読書点を読む。未設定・不正値は READING_ANCHOR_DEFAULT。[0,100] にクランプ。
// loadReadingAnchor(): number
export function loadReadingAnchor(): number {
    const raw = localStorage.getItem(LS_READING_ANCHOR);
    const v = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(v)) return READING_ANCHOR_DEFAULT;
    return _clampPercent(v);
}

// 読書点を [0,100] にクランプして保存し、保存した値を返す。
// saveReadingAnchor(percent: number): number
export function saveReadingAnchor(percent: number): number {
    const v = _clampPercent(percent);
    localStorage.setItem(LS_READING_ANCHOR, String(v));
    return v;
}

// 表示設定2組が全項目同値か。Object.keys(DEFAULTS) 走査なので設定項目が増えても自動追従する。
// sameSettings(a: Settings, b: Settings): boolean
export function sameSettings(a: Settings, b: Settings): boolean {
    return (Object.keys(DEFAULTS) as Array<keyof Settings>).every((k) => a[k] === b[k]);
}

// 現在値が完全一致するプリセットの id。一致しなければ null（＝カスタム）。永続化しない派生状態。
// activePresetId(values: Settings): PresetId | null
export function activePresetId(values: Settings): PresetId | null {
    const hit = PRESETS.find((p) => sameSettings(p.values, values));
    return hit ? hit.id : null;
}

// localStorage から key を読み取り、valid に含まれる値なら返す。未設定・不正値は fallback。
function _readEnum<T extends string>(key: string, valid: readonly T[], fallback: T): T {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return (valid as readonly string[]).includes(v) ? (v as T) : fallback;
}

function _clampPercent(v: number): number {
    return Math.min(100, Math.max(0, v));
}
