/*
 * bookmark.ts
 * 責務: 栞・オートセーブ・既読（到達／読了）の localStorage 保存／復元／クリア／旧データ変換
 * 依存: なし（localStorage キー名・形式を index.ts / settings.ts と共有する）
 *
 * ── localStorage スキーマ（マルチページ移行・Phase 0 で確定した契約）──────────────────────
 * 既読は scene 単位を廃止し、sec 単位の「到達」「読了」2セットで持つ（読了は到達を含意）。
 *   "reached"     : SecKey[]         到達 sec の集合（"EP-SEC" 2桁ゼロ埋め）。用途は目次のセクション既読マーク
 *                                    記録: main.ts が本文ページのロード時に recordReached() を呼ぶ
 *   "read"        : SecKey[]         読了 sec の集合（"EP-SEC"）。用途は将来の章・巻読了判定の基礎
 *                                    記録: nav.ts が sec 末尾到達（#btn-next 表示）で recordRead() を呼ぶ
 *   "bookmarks"   : BookmarkEntry[]  最大3件・flat 形 { ep, sec, scene, scrollLeft, savedAt }。超過時は最古を削除
 *                                    記録: menu.ts が栞追加で addBookmark() を呼ぶ
 *   "autosave"    : AutoSaveEntry    最新1件のみ上書き { ep, sec, scrollLeft, savedAt }
 *                                    記録: reader.ts がスクロール通知をスロットルして saveAutoSave() を呼ぶ
 *   "pendingJump" : PendingJump      栞ジャンプ受け渡し { ep, sec, scene, scrollLeft }。書くのは menu.ts / index.ts、
 *                                    遷移先ページがロード時に読んで復元・消去する
 *   "pendingScrollEnd": SecAddress   戻る系の終端スクロール受け渡し { ep, sec }。書くのは title.ts（タイトル「戻る」＝前 ep 最終 sec）と
 *                                    nav.ts（本文の戻るボタン／開幕「もどる ›」＝前 sec）。遷移先がロード時に読んで本文末へスクロール・消去する（オートセーブより優先）
 *   "schemaVersion": string          スキーマ版数。旧データ移行を一度だけ走らせるための番兵
 *
 * ── 旧データ移行（init() で schemaVersion を見て未変換時のみ1回実行）──────────────────────
 *   旧 "sceneRead"（"ep-sec-scene" 3 セグメント）からの変換:
 *     完了マーカー "ep-sec-00"        → 当 sec を "read"（＋"reached"）に登録
 *     "ep-sec-XX"（XX ≥ 01）          → 当 sec を "reached" に登録
 *   旧 "bookmarks"（nested { address:{ep,sec,scene}, scrollLeft, savedAt }）→ flat 形へ。
 *     旧 scrollLeft はシーン座標で新と非互換のため使わず 0 とし、scene 番号のみ引き継ぐ（ジャンプ時に該当シーン先頭へ）
 *   ★ 旧 "sceneRead" キーは変換後も削除せず保持する（冪等・復旧可能・目次先開きでの参照余地を残す。ユーザー合意済み）
 *
 * セクション既読の判定ロジックは持たない。目次（index.ts）が "reached" を引くだけ。
 *
 * ── 外部サイト/直接アクセスでの自動記録抑止 ──────────────────────────────────────
 * recordReached / recordRead / saveAutoSave は _autoRecordSuppressed が true の間 no-op になる。
 * main.ts が起動時に遷移元を判定し setAutoRecordSuppressed() で設定する：外部サイト・直接アクセス
 * （referrer が同一オリジンでない）で開いた本文ページは、SNS 共有リンク等を「ちょっと見ただけ」で既読化／
 * オートセーブ上書きされるのを防ぐため記録しない。ただしオートセーブが当 sec を指す＝読みかけの再開なら
 * 記録を有効化する（判定は main.ts 側）。栞追加（addBookmark）など明示操作は抑止対象外。
 *
 * ── Phase 2 配線状況 ─────────────────────────────────────────────────────────────
 * 記録系（recordReached / recordRead / addBookmark / saveAutoSave / writePendingJump）を本フェーズで配線。
 * 消費系（getAutoSave / readPendingJump / clearPendingJump）は API を用意するのみで、利用は Phase 3
 * （初期スクロール位置の復元）で行う。
 */

import type { SceneAddress, SecAddress, AutoSaveEntry, PendingJump, SecKey } from './types';

// 栞1件。新形は flat（ep/sec/scene を直に持つ。旧 nested { address } は移行で flat 化する）。
export type BookmarkEntry = {
    ep: number;
    sec: number;
    scene: number;
    scrollLeft: number;
    savedAt: number;
};

const MAX_SLOTS = 3;
const SCHEMA_VERSION = '2';

const KEY_REACHED = 'reached';
const KEY_READ = 'read';
const KEY_BOOKMARKS = 'bookmarks';
const KEY_AUTOSAVE = 'autosave';
const KEY_PENDING_JUMP = 'pendingJump';
const KEY_PENDING_SCROLL_END = 'pendingScrollEnd';
const KEY_SCHEMA_VERSION = 'schemaVersion';
const KEY_LEGACY_SCENE_READ = 'sceneRead';

let _reached: Set<SecKey> = new Set();
let _read: Set<SecKey> = new Set();
let _bookmarks: BookmarkEntry[] = [];

// 自動記録（到達・読了・オートセーブ）の抑止フラグ。外部サイト/直接アクセスで開いた本文ページで立てる
// （main.ts が遷移元を判定して設定）。栞追加（addBookmark）など明示操作は対象外。既定は false（記録する）。
let _autoRecordSuppressed = false;

// ep / sec から "01-02" 形式の SecKey を生成する
function secKey(ep: number, sec: number): SecKey {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(ep)}-${pad(sec)}`;
}

// localStorage から到達／読了／栞を復元し、未変換なら旧データ移行を1回だけ走らせる。
// main.ts / title.ts が起動時に一度だけ呼ぶ。
// init(): void
export function init(): void {
    _reached = _loadStringSet(KEY_REACHED);
    _read = _loadStringSet(KEY_READ);
    _bookmarks = _loadBookmarks();
    _autoRecordSuppressed = false; // 抑止は main.ts が init 後に setAutoRecordSuppressed() で明示設定する

    if (localStorage.getItem(KEY_SCHEMA_VERSION) !== SCHEMA_VERSION) {
        _migrate();
        localStorage.setItem(KEY_SCHEMA_VERSION, SCHEMA_VERSION);
    }
}

// 自動記録（到達・読了・オートセーブ）の抑止を設定する。main.ts が起動時に遷移元を判定して呼ぶ。
// true の間は recordReached / recordRead / saveAutoSave が no-op になる（栞追加 addBookmark は対象外）。
// setAutoRecordSuppressed(suppressed: boolean): void
export function setAutoRecordSuppressed(suppressed: boolean): void {
    _autoRecordSuppressed = suppressed;
}

// ── 既読（到達／読了）──────────────────────────────────────────────

// 当 sec を到達として記録する。main.ts が本文ページのロード時に呼ぶ。
// recordReached(ep: number, sec: number): void
export function recordReached(ep: number, sec: number): void {
    if (_autoRecordSuppressed) return;
    if (_addTo(_reached, secKey(ep, sec))) _persistSet(KEY_REACHED, _reached);
}

// 当 sec を読了として記録する。読了は到達を含意するため reached にも追加する。
// nav.ts が sec 末尾到達（#btn-next 表示）時に呼ぶ。
// recordRead(ep: number, sec: number): void
export function recordRead(ep: number, sec: number): void {
    if (_autoRecordSuppressed) return;
    const key = secKey(ep, sec);
    let changed = _addTo(_read, key);
    if (changed) _persistSet(KEY_READ, _read);
    if (_addTo(_reached, key)) _persistSet(KEY_REACHED, _reached);
}

// 到達セット（"EP-SEC" 配列）を返す。
// getReached(): SecKey[]
export function getReached(): SecKey[] {
    return [..._reached];
}

// 読了セット（"EP-SEC" 配列）を返す。
// getRead(): SecKey[]
export function getRead(): SecKey[] {
    return [..._read];
}

// 到達・読了の両セットを削除する（設定の「既読をクリア」）。
// clearRead(): void
export function clearRead(): void {
    _reached = new Set();
    _read = new Set();
    localStorage.removeItem(KEY_REACHED);
    localStorage.removeItem(KEY_READ);
}

// ── 栞 ────────────────────────────────────────────────────────────

// 現在位置を栞に保存する。呼び出し元（menu.ts）が SceneAddress と #main-container.scrollLeft を渡す。
// 内部では flat 形で保存する。最大3件・超過時は最古を削除。
// addBookmark(address: SceneAddress, scrollLeft: number): void
export function addBookmark(address: SceneAddress, scrollLeft: number): void {
    const entry: BookmarkEntry = {
        ep: address.ep,
        sec: address.sec,
        scene: address.scene,
        scrollLeft,
        savedAt: Date.now(),
    };
    _bookmarks.push(entry);
    if (_bookmarks.length > MAX_SLOTS) {
        _bookmarks.sort((a, b) => a.savedAt - b.savedAt);
        _bookmarks.shift();
    }
    localStorage.setItem(KEY_BOOKMARKS, JSON.stringify(_bookmarks));
}

// 保存済み栞を全件返す。ジャンプは呼び出し元（menu.ts / index.ts）が行う。
// getBookmarks(): BookmarkEntry[]
export function getBookmarks(): BookmarkEntry[] {
    return [..._bookmarks];
}

// 全栞を削除する。
// clearSlots(): void
export function clearSlots(): void {
    _bookmarks = [];
    localStorage.removeItem(KEY_BOOKMARKS);
}

// ── オートセーブ ──────────────────────────────────────────────────

// 現在 sec の読書位置を最新1件だけ上書き保存する。スロットルは呼び出し元（reader.ts）が行う。
// saveAutoSave(ep: number, sec: number, scrollLeft: number): void
export function saveAutoSave(ep: number, sec: number, scrollLeft: number): void {
    if (_autoRecordSuppressed) return;
    const entry: AutoSaveEntry = { ep, sec, scrollLeft, savedAt: Date.now() };
    localStorage.setItem(KEY_AUTOSAVE, JSON.stringify(entry));
}

// オートセーブを返す。無ければ null。消費は Phase 3（初期スクロール位置の復元）。
// getAutoSave(): AutoSaveEntry | null
export function getAutoSave(): AutoSaveEntry | null {
    try {
        const raw = localStorage.getItem(KEY_AUTOSAVE);
        if (raw) return JSON.parse(raw) as AutoSaveEntry;
    } catch { /* ignore */ }
    return null;
}

// ── pendingJump（栞ジャンプの受け渡し）─────────────────────────────

// 栞ジャンプ情報を書く。遷移自体は呼び出し元（menu.ts / index.ts）が location.href で行う。
// writePendingJump(jump: PendingJump): void
export function writePendingJump(jump: PendingJump): void {
    localStorage.setItem(KEY_PENDING_JUMP, JSON.stringify(jump));
}

// pendingJump を読む。無ければ null。遷移先ページがロード時に読む（消費は Phase 3）。
// readPendingJump(): PendingJump | null
export function readPendingJump(): PendingJump | null {
    try {
        const raw = localStorage.getItem(KEY_PENDING_JUMP);
        if (raw) return JSON.parse(raw) as PendingJump;
    } catch { /* ignore */ }
    return null;
}

// pendingJump を消す（復元後に呼ぶ）。
// clearPendingJump(): void
export function clearPendingJump(): void {
    localStorage.removeItem(KEY_PENDING_JUMP);
}

// ── pendingScrollEnd（タイトル「戻る」の終端スクロール受け渡し）─────

// 終端スクロール対象 sec を書く。title.ts の「戻る」（前 ep 最終 sec）・nav.ts の戻る（前 sec・開幕「もどる ›」含む）が
// 遷移前に書き、遷移先がロード時に読んで本文末へ着地する。
// writePendingScrollEnd(ep: number, sec: number): void
export function writePendingScrollEnd(ep: number, sec: number): void {
    const entry: SecAddress = { ep, sec };
    localStorage.setItem(KEY_PENDING_SCROLL_END, JSON.stringify(entry));
}

// pendingScrollEnd を読む。無ければ null。遷移先ページ（main.ts）がロード時に読む。
// readPendingScrollEnd(): SecAddress | null
export function readPendingScrollEnd(): SecAddress | null {
    try {
        const raw = localStorage.getItem(KEY_PENDING_SCROLL_END);
        if (raw) return JSON.parse(raw) as SecAddress;
    } catch { /* ignore */ }
    return null;
}

// pendingScrollEnd を消す（末尾へスクロール後に呼ぶ）。
// clearPendingScrollEnd(): void
export function clearPendingScrollEnd(): void {
    localStorage.removeItem(KEY_PENDING_SCROLL_END);
}

// ── private helpers ───────────────────────────────────────────────

// Set に key を追加し、新規追加だったら true を返す（無駄な永続化を避けるため）。
function _addTo(set: Set<SecKey>, key: SecKey): boolean {
    if (set.has(key)) return false;
    set.add(key);
    return true;
}

function _persistSet(key: string, set: Set<SecKey>): void {
    localStorage.setItem(key, JSON.stringify([...set]));
}

function _loadStringSet(key: string): Set<SecKey> {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set();
}

// "bookmarks" を読む。新 flat 形・旧 nested 形のどちらも flat に正規化して返す。
function _loadBookmarks(): BookmarkEntry[] {
    try {
        const raw = localStorage.getItem(KEY_BOOKMARKS);
        if (!raw) return [];
        const list = JSON.parse(raw) as unknown[];
        return list.map(_normalizeBookmark).filter((b): b is BookmarkEntry => b !== null);
    } catch {
        return [];
    }
}

// 1件の栞を flat 形へ正規化する。flat・nested いずれも受け付ける。不正なら null。
function _normalizeBookmark(raw: unknown): BookmarkEntry | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const addr = (typeof o.address === 'object' && o.address !== null)
        ? (o.address as Record<string, unknown>)
        : o;
    const ep = Number(addr.ep);
    const sec = Number(addr.sec);
    const scene = Number(addr.scene);
    if (!Number.isFinite(ep) || !Number.isFinite(sec)) return null;
    // 旧 nested の scrollLeft はシーン座標で非互換のため引き継がない（flat の自分自身は除く）。
    const scrollLeft = (o.address !== undefined) ? 0 : Number(o.scrollLeft) || 0;
    const savedAt = Number(o.savedAt) || Date.now();
    return { ep, sec, scene: Number.isFinite(scene) ? scene : 0, scrollLeft, savedAt };
}

// 旧 sceneRead / 旧 bookmarks を新スキーマへ一度だけ変換する。
// init() が schemaVersion 未一致時のみ呼ぶ。旧 sceneRead キーは保持する。
function _migrate(): void {
    // 旧 sceneRead → reached / read
    const legacy = _loadStringSet(KEY_LEGACY_SCENE_READ);
    let reachedChanged = false;
    let readChanged = false;
    for (const k of legacy) {
        const parts = k.split('-'); // "ep-sec-scene"
        if (parts.length !== 3) continue;
        const key = `${parts[0]}-${parts[1]}`;
        if (parts[2] === '00') {
            if (_addTo(_read, key)) readChanged = true;
            if (_addTo(_reached, key)) reachedChanged = true;
        } else {
            if (_addTo(_reached, key)) reachedChanged = true;
        }
    }
    if (reachedChanged) _persistSet(KEY_REACHED, _reached);
    if (readChanged) _persistSet(KEY_READ, _read);

    // 旧 nested bookmarks → flat（_loadBookmarks が既に正規化済み。flat 形で書き戻す）
    if (_bookmarks.length > 0) {
        localStorage.setItem(KEY_BOOKMARKS, JSON.stringify(_bookmarks));
    }
}
