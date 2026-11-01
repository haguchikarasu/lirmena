/*
 * settings.ts
 * 責務: 本文ページの表示設定の「反映」（reader 層）。書字方向・段落の区切り（空行／字下げ）・フォント・文字サイズ・
 *       文字の太さ・読書点位置を CSS 変数 or <html data-writing-mode> 属性へ反映し、本文側の現在値を持つ。
 *       設定は 3 つに分かれている：
 *         core/settings-model … 値の規則（キー・既定値・有効値・PRESETS・localStorage の読み書き）。目次と共有
 *         ui/settings-panel   … ポップアップの結線（markup は templates/parts/settings.html）。目次と共有
 *         settings.ts（ここ）  … 本文への反映と読書位置の復元の合図。目次は使わない＝目次が縦書きになる事故が起きない
 * export: init(), open(), getReadingAnchor(), setReadingAnchor(), getSettings(),
 *         getPresets(), getActivePreset(), applyPreset(), isAllDefault()
 *         型 Settings / PresetId / Preset（core/settings-model の再 export）
 * 依存: core/settings-model、ui/settings-panel（パネルの host をここが実装する）。
 *   栞・既読・読破のクリア・書字方向変更後の処理のコールバックは main.ts から注入
 *   書字方向を切り替えたら onWritingModeChange() を呼ぶ（実際に値が変わったときだけ）。main.ts がこれを受けて
 *   切替前の読書位置（reader.getLastRatio）を新方向のスクロール量へ復元し、マーカー再配置・背景再 emit を行う（A-4）。
 *   ただし applyPreset() だけは書字方向が変わらなくても必ず呼ぶ（理由は下の「プリセット」節）。
 *   3つのクリアボタン（栞をクリア／既読をクリア／読破状況をクリア）は ui/settings-panel が window.confirm() で承認を取ってから callback を呼ぶ。
 *   getSettings(): Settings は現在の表示設定（書字方向・段落間空行・フォント・文字サイズ・文字の太さ）のコピーを返す。
 *   main.ts が analytics.send() への引数として使う（表示設定は settings.ts が単一の源として所有）。
 *
 * 設定項目とデフォルト値（定義は core/settings-model）。以下は**設定パネルの行順**（＝要件 06-4 の設定項目表の順。
 * 行の並びの実体は templates/parts/settings.html）で並べてある:
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
 * プリセット: 表示設定5項目の名前付きの組み合わせ（ウェブ小説風／書籍風）。定義は core/settings-model が単一の源として持ち、
 *   firstrun.ts が getPresets() でカードを生成する。目次も同じ定義を使う（以前は目次が複製を持っていた）。
 *   選択状態は永続化しない派生状態：現在値が定義と完全一致するときだけカードが .active になり（getActivePreset）、
 *   個別行を1つでも変えれば自動的に外れる（＝カスタム）。DEFAULTS はどちらのプリセットとも一致しない。
 *   applyPreset() は書字方向が変わったかに関わらず**常に** onWritingModeChange() を呼ぶ。このコールバックの実体
 *   （main.ts の _onWritingModeChange）は「読書位置の復元→マーカー再配置→scroll 再発火」で、書字方向専用ではなく
 *   レイアウト変更後の位置復元だから（_onDeviceChange も同じ中身）。プリセットは最大5項目を一度に変え、特に lineGap は
 *   全段落から段落間マージンを抜いて文書長を大きく変えるため、単一行の変更で許容してきたズレとはスケールが違う。
 *   **「実際に変わったときだけ呼ぶ」という他の経路の規律から意図的に外れている箇所なので、戻さないこと。**
 *
 * 書字方向の契約: writingMode だけは CSS 変数でなく <html data-writing-mode> 属性へ反映する。
 *   axis.ts がこの属性を唯一の真実源として読む。settings→axis の import は張らず、DOM 属性＋localStorage キーで疎結合に保つ
 *   （.dependency-cruiser.cjs の allowed に settings→axis は無い＝依存を張らないことが機械で守られている）。
 */

import {
    DEFAULTS,
    PRESETS,
    READING_ANCHOR_DEFAULT,
    activePresetId,
    loadReadingAnchor,
    loadSettings,
    sameSettings,
    saveReadingAnchor,
    saveSetting,
    saveSettings,
    type FontFamily,
    type FontSize,
    type FontWeight,
    type LineGap,
    type Preset,
    type PresetId,
    type Settings,
} from './core/settings-model';
import * as panel from './ui/settings-panel';

export type { Preset, PresetId, Settings } from './core/settings-model';

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

// 設定を localStorage から復元し CSS 変数に反映し、設定ポップアップ（ui/settings-panel）を結線する。
// callbacks.onClearBookmarks / onClearReached / onClearRead を設定画面の3クリアボタン（栞・既読・読破状況）に、
// onWritingModeChange を書字方向変更後の復元に割り当てる。#settings-popup が無ければパネルの結線だけ飛ばす。
// init(callbacks: { onClearBookmarks: () => void; onClearReached: () => void; onClearRead: () => void; onWritingModeChange: () => void }): void
export function init(callbacks: { onClearBookmarks: () => void; onClearReached: () => void; onClearRead: () => void; onWritingModeChange: () => void }): void {
    _callbacks = callbacks;
    _current = loadSettings();
    _readingAnchor = loadReadingAnchor();
    _applyAll();
    _applyReadingAnchor();
    panel.init({
        current: () => _current,
        select: _selectOption,
        preset: applyPreset,
        reset: _reset,
        clearBookmarks: () => _callbacks.onClearBookmarks(),
        clearReached: () => _callbacks.onClearReached(),
        clearRead: () => _callbacks.onClearRead(),
    }, { closeOnEscape: true });
}

// 設定ポップアップを開く（#settings-popup の hidden 属性を外す）。
// open(): void
export function open(): void {
    panel.open();
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

// プリセット定義のコピーを返す（values まで複製するので呼び出し側の変更が内部に及ばない）。
// firstrun.ts が初回ダイアログのカード生成に使う。
// getPresets(): Preset[]
export function getPresets(): Preset[] {
    return PRESETS.map((p) => ({ ...p, values: { ...p.values } }));
}

// 現在値が完全一致するプリセットの id を返す。一致しなければ null（＝カスタム）。
// 永続化しない派生状態＝個別行を1つでも変えれば自動的に null になる。DEFAULTS はどちらとも一致しない。
// getActivePreset(): PresetId | null
export function getActivePreset(): PresetId | null {
    return activePresetId(_current);
}

// プリセットを適用する（5項目を一括で差し替え・保存・反映し、選択表示を更新する）。
// 5項目のどれかが実際に変わったときは、書字方向が変わらなくても onWritingModeChange() を呼ぶ（理由は冒頭の「プリセット」節）。
// 順序が契約：_applyAll（属性反映）より後でないと axis.ts が旧方向で読む。
// applyPreset(id: PresetId): void
export function applyPreset(id: PresetId): void {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const changed = !sameSettings(preset.values, _current);
    _current = { ...preset.values };
    saveSettings(_current);
    _applyAll();
    panel.refresh();
    // 5項目のどれかが実際に変わったときだけ位置を復元する。根拠が「レイアウトが変わったから」なので、
    // 既に当たっているカードの再タップでスクロール再計算を走らせるのは筋が通らない。
    if (changed) _callbacks.onWritingModeChange();
}

// 表示設定5項目がすべて DEFAULTS と同値か（＝一度も設定を変えていないと見なせるか）。
// firstrun.ts が初回ダイアログを出すかの判定に使う。読書点（readingAnchor）は見ない。
// キーの有無ではなく**値**で判定するので、「設定をリセット」した読者も true に戻る。
// isAllDefault(): boolean
export function isAllDefault(): boolean {
    return sameSettings(DEFAULTS, _current);
}

// 読書点を % で設定し、localStorage 保存＋ CSS 変数 --reading-anchor へ反映する。[0,100] にクランプ。
// tutorial.ts のドロップが呼ぶ（ドラッグ中のライブ更新は tutorial が CSS 変数を直接書く）。
// setReadingAnchor(percent: number): void
export function setReadingAnchor(percent: number): void {
    _readingAnchor = saveReadingAnchor(percent);
    _applyReadingAnchor();
}

// 設定行のボタン（panel の host.select）：1 項目を保存・反映する。
// 書字方向を実際に切り替えたときだけ、main.ts に切替前位置の復元・マーカー再配置を依頼する（A-4）。
// _selectOption(key: keyof Settings, value: string): void
function _selectOption(key: keyof Settings, value: string): void {
    const changed = (_current[key] as string) !== value;
    _current = { ..._current, [key]: value };
    saveSetting(key, value);
    _applySetting(key);
    if (key === 'writingMode' && changed) _callbacks.onWritingModeChange();
}

// 「設定をリセット」（panel の host.reset）：5 項目を既定へ戻して保存・反映し、読書点も既定へ戻す。
// _reset(): void
function _reset(): void {
    const modeChanged = _current.writingMode !== DEFAULTS.writingMode;
    _current = { ...DEFAULTS };
    saveSettings(_current);
    _applyAll();
    setReadingAnchor(READING_ANCHOR_DEFAULT);
    // リセットで書字方向が変わったら（縦書き→既定の横書き）切替前位置を復元する（A-4）。
    if (modeChanged) _callbacks.onWritingModeChange();
}

// _readingAnchor を CSS 変数 --reading-anchor（"45%"）として documentElement に反映する。
// _applyReadingAnchor(): void
function _applyReadingAnchor(): void {
    document.documentElement.style.setProperty('--reading-anchor', `${_readingAnchor}%`);
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
