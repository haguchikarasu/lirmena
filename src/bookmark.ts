/*
 * bookmark.ts
 * 責務: 栞・オートセーブ・既読（到達／読了）の localStorage 保存／復元／クリア／旧データ変換に加え、
 *       履歴エントリ（history.state）への per-entry スクロール位置の保存／復元（ブラウザ戻る/進むの位置復元用）。
 *       ＝ブラウザ永続化（localStorage ＋ 履歴エントリ state）を一手に担う。
 * 依存: なし（読書位置はスクロール範囲比＝割合で持つため書字方向に依存せず、axis を参照しない）。
 *       localStorage キー名・形式を index.ts / settings.ts と共有する。history はグローバル API
 *
 * ── localStorage スキーマ（マルチページ移行・Phase 0 で確定した契約。schemaVersion 5 で位置を割合化）──────
 * 既読は scene 単位を廃止し、sec 単位の「到達」「読了」2セットで持つ（読了は到達を含意）。
 *   "reached"     : SecKey[]         到達 sec の集合（"EP-SEC" 2桁ゼロ埋め）。用途は目次のセクション既読マーク（色）。
 *                                    記録: main.ts が本文ページのロード時に recordReached() を呼ぶ。設定「既読をクリア」の対象
 *   "read"        : SecKey[]         読了 sec の集合（"EP-SEC"）。用途は目次のセクション読破マーク（✓）＋ stage 判定の基礎。
 *                                    記録: nav.ts が sec 末尾到達（#btn-next 表示）で recordRead() を呼ぶ。設定「読破状況をクリア」の対象
 *   "bookmarks"   : BookmarkEntry[]  固定3スロット・flat 形 { slot, ep, sec, scene, ratio, savedAt }（slot=1..3）。
 *                                    ratio はスクロール範囲比（0〜1・書字方向非依存）。方向で座標スケールが異なる差を割合で吸収するため
 *                                    縦書き⇔横書きで同一スロットを共有する（schemaVersion 5 で方向別スロットから単一スロットへ統合）。
 *                                    読者が保存先 slot を選び、同 slot は上書きする。記録: menu.ts が栞追加で addBookmark(address, ratio, slot) を呼ぶ
 *   "autosave"    : AutoSaveEntry    最新1件のみ上書き { ep, sec, ratio, savedAt }。ratio はスクロール範囲比（0〜1・方向非依存）
 *                                    記録: reader.ts がスクロール通知をスロットルして saveAutoSave() を呼ぶ
 *   "pendingJump" : PendingJump      位置ジャンプ受け渡し { ep, sec, scene, ratio }。栞ジャンプ（menu.ts / index.ts）と
 *                                    「続きから読む」（index.ts がオートセーブの ratio を載せる）が書く。
 *                                    遷移先ページがロード時に読んで復元・消去する（明示前進ナビより優先＝必ず復元される）
 *   "pendingScrollEnd": SecAddress   戻る系の終端スクロール受け渡し { ep, sec }。書くのは title.ts（タイトル「戻る」＝前 ep 最終 sec）と
 *                                    nav.ts（本文の戻るボタン／開幕「もどる ›」＝前 sec）。遷移先がロード時に読んで本文末へスクロール・消去する（オートセーブより優先）
 *   "schemaVersion": string          スキーマ版数。旧データ移行を一度だけ走らせるための番兵
 *
 * ── 履歴エントリのスクロール位置（history.state。localStorage ではない）─────────────────
 *   "lirmenaRatio"（history.state 内のキー）  現在の履歴エントリに刻むスクロール範囲比（0〜1）。
 *     autosave の単一スロットと違い履歴エントリごとに位置を保持できるため、戻る/進むで HTML 再読込
 *     （bfcache 破棄）されても per-entry に復元できる。割合なので書字方向を跨いでも一貫する。
 *     記録: reader.ts がスクロール通知をスロットルして saveScrollToHistory() を呼ぶ（autosave と同じスロットルに相乗り）
 *     消費: main.ts の初期スクロール復元が readScrollFromHistory() を読む（前進ナビでない時・autosave より優先）
 *
 * ── 旧データ移行（init() で schemaVersion を見て未変換時のみ1回実行）──────────────────────
 *   旧 "sceneRead"（"ep-sec-scene" 3 セグメント）からの変換（★ schemaVersion 未設定＝pre-multipage のときだけ実行）:
 *     完了マーカー "ep-sec-00"        → 当 sec を "read"（＋"reached"）に登録
 *     "ep-sec-XX"（XX ≥ 01）          → 当 sec を "reached" に登録
 *     ※ sceneRead 変換と schemaVersion キーは同じ移行で同時導入されたため、schemaVersion が既にあるユーザーは変換済み。
 *       版数を上げて再 _migrate する際に再変換すると、保持した sceneRead からクリア済みの reached/read を書き戻してしまう
 *       （クリア状態の復活）。よって schemaVersion === null のときだけ走らせる。栞/オートセーブの移行は版数に依らず実行する。
 *   schemaVersion →5: 栞・オートセーブを単一スロット・割合（ratio）へ統合する。旧 "bookmarks"/"autosave"（v3 単一キー・
 *     forward 進行 px もしくは生 scrollLeft）と "bookmarks.{vertical|horizontal}"/"autosave.{vertical|horizontal}"（v4・未デプロイ）が
 *     源。旧位置は保存時の可動域が不明で割合へ変換できないため、栞は ep/sec/scene のみ引き継ぎ ratio=0（scene>0 は復元時に
 *     シーン先頭へ粗着地）、オートセーブは ep/sec のみ引き継ぎ ratio=0（再開時に sec 先頭へ）とする。位置の厳密さは一度だけ失われる。
 *     方向別キー（v4）は孤児になるため掃除する。旧単一キーは冪等・復旧のため残す。
 *   ★ 旧 "sceneRead" キーは変換後も削除せず保持する（冪等・復旧可能・目次先開きでの参照余地を残す。ユーザー合意済み）。
 *     ただし例外：設定の「既読をクリア」（clearReached）／「読破状況をクリア」（clearRead）実行時は削除する。
 *     残しておくと目次側 index.ts の loadReachedSections/loadReadSections が旧マーカー "ep-sec-00" から既読／読破を
 *     復活させてしまうため（クリア＝ユーザーの明示意思を尊重＝既読／読破の復活を防ぐ）。
 *
 * セクション既読の判定ロジックは持たない。目次（index.ts）が "reached" を引くだけ。
 *
 * ── 外部サイト/直接アクセスでの自動記録抑止 ──────────────────────────────────────
 * recordReached / recordRead は _reachedReadSuppressed の間 no-op、saveAutoSave は _autoSaveSuppressed の間 no-op になる。
 * main.ts が起動時に遷移元を判定し setAutoRecordSuppressed({ reachedRead, autoSave }) で 2 系統を独立に設定する
 * （判定条件は suppression.ts の純関数へ切り出し）。到達・読了とオートセーブで抑止条件を分けるのは、オートセーブが
 * 単一スロット・上書き型のため「過去に一度開いただけ（reached のみ）の sec を外部から再訪」した際に読者の
 * 現在の読みかけ位置を奪わないため（到達・読了は加算的で害がない）。栞追加（addBookmark）と saveScrollToHistory は
 * いずれのフラグの対象外＝明示操作／履歴 state は常に動く。
 */

import type {
    SceneAddress,
    SecAddress,
    AutoSaveEntry,
    PendingJump,
    SecKey,
    AfterwordKey,
    AutoSaveAfterwordEntry,
    PendingJumpAfterword,
} from './types';

// 栞1件。flat 形＋固定スロット（slot=1..3）。ratio はスクロール範囲比（0〜1・書字方向非依存）。
// 旧 nested { address }・旧 flat（slot 無し／px scrollLeft）は移行で flat 化・割合化（ratio=0）する。
export type BookmarkEntry = {
    slot: number;
    ep: number;
    sec: number;
    scene: number;
    ratio: number;
    savedAt: number;
};

const MAX_SLOTS = 3;
const SCHEMA_VERSION = '5';

const KEY_REACHED = 'reached';
const KEY_READ = 'read';
const KEY_BOOKMARKS = 'bookmarks';
const KEY_AUTOSAVE = 'autosave';
const KEY_PENDING_JUMP = 'pendingJump';
const KEY_PENDING_SCROLL_END = 'pendingScrollEnd';
const KEY_AUTOSAVE_AFTERWORD = 'autosaveAfterword';
const KEY_PENDING_JUMP_AFTERWORD = 'pendingJumpAfterword';
const KEY_SCHEMA_VERSION = 'schemaVersion';
const KEY_LEGACY_SCENE_READ = 'sceneRead';

// history.state 内のスクロール位置キー（localStorage ではない）。割合化（schemaVersion 5）に伴い旧 "lirmenaScrollLeft"（生 px）から
// 改名し、旧 px エントリを読まず無視する（横書き対応デプロイ直後の戻る/進むで legacy px が誤った端へ復元されるのを防ぐ）。
const HISTORY_RATIO_KEY = 'lirmenaRatio';

let _reached: Set<SecKey> = new Set();
let _read: Set<SecKey> = new Set();
let _bookmarks: BookmarkEntry[] = [];

// 自動記録の抑止フラグ。到達・読了とオートセーブで 2 系統に分ける（判定条件が異なるため）。
// 外部サイト/直接アクセスで開いた本文ページで main.ts が立てる（判定条件は suppression.ts の純関数）。
// 栞追加（addBookmark）と saveScrollToHistory はいずれの対象外＝明示操作／履歴 state は常に動く。既定は false（記録する）。
let _reachedReadSuppressed = false;
let _autoSaveSuppressed = false;

// setAutoRecordSuppressed の入力。到達・読了系（reachedRead）とオートセーブ系（autoSave）を独立に制御する。
export type AutoRecordSuppression = {
    reachedRead: boolean;
    autoSave: boolean;
};

// 0〜1 にクランプする。割合（ratio）の保存・読取で範囲外の値を正す。
function _clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

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
    _reachedReadSuppressed = false; // 抑止は main.ts が init 後に setAutoRecordSuppressed() で明示設定する
    _autoSaveSuppressed = false;

    if (localStorage.getItem(KEY_SCHEMA_VERSION) !== SCHEMA_VERSION) {
        _migrate();
        localStorage.setItem(KEY_SCHEMA_VERSION, SCHEMA_VERSION);
    }

    _bookmarks = _loadBookmarks();
}

// 自動記録の抑止を 2 系統独立に設定する。main.ts が起動時に遷移元と読者の履歴を判定して呼ぶ。
// reachedRead=true の間 recordReached / recordRead が no-op、autoSave=true の間 saveAutoSave が no-op になる
// （栞追加 addBookmark と saveScrollToHistory は対象外）。
// setAutoRecordSuppressed(suppression: AutoRecordSuppression): void
export function setAutoRecordSuppressed(suppression: AutoRecordSuppression): void {
    _reachedReadSuppressed = suppression.reachedRead;
    _autoSaveSuppressed = suppression.autoSave;
}

// ── 既読（到達／読了）──────────────────────────────────────────────

// 当 sec を到達として記録する。main.ts が本文ページのロード時に呼ぶ。
// recordReached(ep: number, sec: number): void
export function recordReached(ep: number, sec: number): void {
    if (_reachedReadSuppressed) return;
    if (_addTo(_reached, secKey(ep, sec))) _persistSet(KEY_REACHED, _reached);
}

// 当 sec を読了として記録する。読了は到達を含意するため reached にも追加する。
// nav.ts が sec 末尾到達（#btn-next 表示）時に呼ぶ。
// recordRead(ep: number, sec: number): void
export function recordRead(ep: number, sec: number): void {
    if (_reachedReadSuppressed) return;
    const key = secKey(ep, sec);
    const changed = _addTo(_read, key);
    if (changed) _persistSet(KEY_READ, _read);
    if (_addTo(_reached, key)) _persistSet(KEY_REACHED, _reached);
}

// 到達セットに ep/sec が含まれるか。外部流入抑止判定（main.ts）で「当 sec 痕跡」の一つとして使う。
// hasReached(ep: number, sec: number): boolean
export function hasReached(ep: number, sec: number): boolean {
    return _reached.has(secKey(ep, sec));
}

// 読了セットに ep/sec が含まれるか。外部流入抑止判定（main.ts）で「前 sec 読了」「当 sec 痕跡」の判定材料として使う。
// hasRead(ep: number, sec: number): boolean
export function hasRead(ep: number, sec: number): boolean {
    return _read.has(secKey(ep, sec));
}

// autosave スロット（唯一の 1 件）が当ページの ep/sec を指しているか＝直前まで読んでいたセクションへ戻ってきたか。
// 現行の main.ts _isResuming を bookmark 側に移設した相当。外部流入抑止判定で「読みかけ再開」の例外として使う。
// isAutoSaveAt(ep: number, sec: number): boolean
export function isAutoSaveAt(ep: number, sec: number): boolean {
    const auto = getAutoSave();
    return auto !== null && auto.ep === ep && auto.sec === sec;
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

// 既読（到達）セットを削除する（設定の「既読をクリア」）。読了（読破）は残す。
// 旧 "sceneRead" フォールバック源も併せて削除する（残しておくと目次側 index.ts が旧マーカーから既読を復活させるため。
// クリア＝ユーザーの明示意思なので冪等・復旧の原則より「既読の復活防止」を優先＝目次側 clearReached と同方針）。
// clearReached(): void
export function clearReached(): void {
    _reached = new Set();
    localStorage.removeItem(KEY_REACHED);
    localStorage.removeItem(KEY_LEGACY_SCENE_READ);
}

// 読了（読破）セットを削除する（設定の「読破状況をクリア」）。既読（到達）は残す。
// 旧 "sceneRead" フォールバック源も併せて削除する（残しておくと目次側 index.ts の loadReadSections が
// 完了マーカー "ep-sec-00" から読破を復活させるため。clearReached と同方針＝既読／読破どちらの明示クリアも sceneRead を消す）。
// data-story-stage は main.ts が起動時に1回書くだけなので即時反映されない＝次回ロード反映（既存の非対称に揃える）。
// clearRead(): void
export function clearRead(): void {
    _read = new Set();
    localStorage.removeItem(KEY_READ);
    localStorage.removeItem(KEY_LEGACY_SCENE_READ);
}

// ── 栞 ────────────────────────────────────────────────────────────

// 現在位置を指定スロット（1..3）へ保存する。呼び出し元（menu.ts）が SceneAddress・スクロール範囲比 ratio（0〜1）・
// 読者が選んだ slot を渡す。同 slot の既存エントリは上書きする（固定スロットモデル）。
// addBookmark(address: SceneAddress, ratio: number, slot: number): void
export function addBookmark(address: SceneAddress, ratio: number, slot: number): void {
    _bookmarks = _loadBookmarks();
    const entry: BookmarkEntry = {
        slot,
        ep: address.ep,
        sec: address.sec,
        scene: address.scene,
        ratio: _clamp01(ratio),
        savedAt: Date.now(),
    };
    _bookmarks = _bookmarks.filter(b => b.slot !== slot);
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
    _bookmarks = _loadBookmarks();
    return [..._bookmarks];
}

// 全栞を削除する（「栞をクリア」）。
// clearSlots(): void
export function clearSlots(): void {
    _bookmarks = [];
    localStorage.removeItem(KEY_BOOKMARKS);
}

// ── オートセーブ ──────────────────────────────────────────────────

// 現在 sec の読書位置（スクロール範囲比 ratio・0〜1）を最新1件だけ上書き保存する。スロットルは呼び出し元（reader.ts）が行う。
// saveAutoSave(ep: number, sec: number, ratio: number): void
export function saveAutoSave(ep: number, sec: number, ratio: number): void {
    if (_autoSaveSuppressed) return;
    const entry: AutoSaveEntry = { ep, sec, ratio: _clamp01(ratio), savedAt: Date.now() };
    localStorage.setItem(KEY_AUTOSAVE, JSON.stringify(entry));
}

// オートセーブを返す。無ければ null。消費は main.ts（初期スクロール位置の復元）。
// getAutoSave(): AutoSaveEntry | null
export function getAutoSave(): AutoSaveEntry | null {
    return _readAutoSaveFromKey(KEY_AUTOSAVE);
}

// 指定キーのオートセーブを読む。ratio は割合（0〜1）へ正規化する。無ければ null。
function _readAutoSaveFromKey(key: string): AutoSaveEntry | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const o = JSON.parse(raw) as Record<string, unknown>;
        const ep = Number(o.ep);
        const sec = Number(o.sec);
        if (!Number.isFinite(ep) || !Number.isFinite(sec)) return null;
        const ratio = Number(o.ratio);
        return {
            ep,
            sec,
            ratio: Number.isFinite(ratio) ? _clamp01(ratio) : 0,
            savedAt: Number(o.savedAt) || Date.now(),
        };
    } catch { /* ignore */ }
    return null;
}

// ── 履歴エントリのスクロール位置（history.state）──────────────────────

// 現在の履歴エントリにスクロール範囲比 ratio（0〜1）を刻む（戻る/進むで HTML 再読込された場合の per-entry 復元用）。
// reader.ts が autosave と同じスロットルで呼ぶ。抑止フラグの対象にしない：history.state は
// localStorage を汚さず、外部流入ページでも戻り位置を残せた方がよい（既読化・プライバシーと無関係。
// 復元側 main.ts が _isInAppNavigation でガードする）。
// saveScrollToHistory(ratio: number): void
export function saveScrollToHistory(ratio: number): void {
    history.replaceState(nextHistoryState(history.state, _clamp01(ratio)), '');
}

// 現在の履歴エントリに刻まれたスクロール範囲比を読む。無ければ null。main.ts が初期スクロール復元で読む。
// readScrollFromHistory(): number | null
export function readScrollFromHistory(): number | null {
    return readHistoryRatio(history.state);
}

// 既存 history.state を温存しつつ ratio を上書きした新しい state を返す（純関数）。
// prev が非オブジェクト/null なら空オブジェクト扱い。history.state は他要因でも書かれうるため ...base で既存を保つ。
// nextHistoryState(prev: unknown, ratio: number): Record<string, unknown> & { lirmenaRatio: number }
export function nextHistoryState(
    prev: unknown,
    ratio: number,
): Record<string, unknown> & { lirmenaRatio: number } {
    const base = (typeof prev === 'object' && prev !== null) ? prev as Record<string, unknown> : {};
    return { ...base, [HISTORY_RATIO_KEY]: ratio };
}

// history.state からスクロール範囲比を取り出す（純関数）。lirmenaRatio が [0,1] の有限数なら返す（0 は有効値）。
// それ以外（キー無し・非数・範囲外・非オブジェクト・null・旧 px キー lirmenaScrollLeft）は null。
// readHistoryRatio(state: unknown): number | null
export function readHistoryRatio(state: unknown): number | null {
    if (typeof state !== 'object' || state === null) return null;
    const v = (state as Record<string, unknown>)[HISTORY_RATIO_KEY];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

// ── pendingJump（栞ジャンプの受け渡し）─────────────────────────────

// 位置ジャンプ情報を書く（栞ジャンプ／続きから読むの復元）。遷移自体は呼び出し元（menu.ts / index.ts）が location.href で行う。
// writePendingJump(jump: PendingJump): void
export function writePendingJump(jump: PendingJump): void {
    localStorage.setItem(KEY_PENDING_JUMP, JSON.stringify(jump));
}

// pendingJump を読む。無ければ null。遷移先ページがロード時に読む。
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

// ── あとがき（vol[XX]-af）─────────────────────────────────────────────
//
// 巻末あとがきページ用の到達／読了／オートセーブ／pendingJump。
// 到達／読了キーは本文 sec と同じ localStorage キー（"reached" / "read"）に "vol01-af" 形式で追加する
// （キー regex `^vol\d{2}-af$` で本文 sec 用 `^\d{2}-\d{2}$` と区別可能）。
// stage 判定（volumes.computeStoryStage）は本文 sec 用の regex でフィルタするので、あとがきキーは stage に影響しない。
// autosave / pendingJump は独立キー（autosaveAfterword / pendingJumpAfterword）で並立させる：既存 autosave スキーマ
// を union に拡張すると影響範囲が大きく、また本文とあとがきは別ページで並行して「続きから読む」候補になり得るため。
// index.ts の「続きから読む」は autosave（本文）と autosaveAfterword（あとがき）を savedAt 比較で新しい方を採用する。
// 抑止フラグ（_reachedReadSuppressed / _autoSaveSuppressed）は本文 sec と共通で、あとがきも同じ扱い（あとがきに
// 外部から迷い込んでも同ゲート）。

// あとがきキーの生成："vol01-af" 形式
function afterwordKey(vol: number): AfterwordKey {
    return `vol${String(vol).padStart(2, '0')}-af`;
}

// 当 vol のあとがきを到達として記録する。main.ts（あとがきモード）がロード時に呼ぶ。
// recordReachedAfterword(vol: number): void
export function recordReachedAfterword(vol: number): void {
    if (_reachedReadSuppressed) return;
    if (_addTo(_reached, afterwordKey(vol))) _persistSet(KEY_REACHED, _reached);
}

// 当 vol のあとがきを読了として記録する。読了は到達を含意する。
// nav.ts（あとがきモード）が末尾到達で呼ぶ。
// recordReadAfterword(vol: number): void
export function recordReadAfterword(vol: number): void {
    if (_reachedReadSuppressed) return;
    const key = afterwordKey(vol);
    const changed = _addTo(_read, key);
    if (changed) _persistSet(KEY_READ, _read);
    if (_addTo(_reached, key)) _persistSet(KEY_REACHED, _reached);
}

// hasReachedAfterword(vol: number): boolean
export function hasReachedAfterword(vol: number): boolean {
    return _reached.has(afterwordKey(vol));
}

// hasReadAfterword(vol: number): boolean
export function hasReadAfterword(vol: number): boolean {
    return _read.has(afterwordKey(vol));
}

// あとがきのオートセーブ（独立キー autosaveAfterword）を保存。スロットルは呼び出し元（reader.ts）が行う。
// saveAutoSaveAfterword(vol: number, ratio: number): void
export function saveAutoSaveAfterword(vol: number, ratio: number): void {
    if (_autoSaveSuppressed) return;
    const entry: AutoSaveAfterwordEntry = { vol, ratio: _clamp01(ratio), savedAt: Date.now() };
    localStorage.setItem(KEY_AUTOSAVE_AFTERWORD, JSON.stringify(entry));
}

// あとがきのオートセーブを返す。無ければ null。「続きから読む」は本編と savedAt 比較で新しい方を採用する。
// getAutoSaveAfterword(): AutoSaveAfterwordEntry | null
export function getAutoSaveAfterword(): AutoSaveAfterwordEntry | null {
    try {
        const raw = localStorage.getItem(KEY_AUTOSAVE_AFTERWORD);
        if (!raw) return null;
        const o = JSON.parse(raw) as Record<string, unknown>;
        const vol = Number(o.vol);
        if (!Number.isFinite(vol)) return null;
        const ratio = Number(o.ratio);
        return {
            vol,
            ratio: Number.isFinite(ratio) ? _clamp01(ratio) : 0,
            savedAt: Number(o.savedAt) || Date.now(),
        };
    } catch { /* ignore */ }
    return null;
}

// autosaveAfterword が当 vol を指しているか＝外部流入抑止判定の「読みかけ再開」例外に使う。
// isAutoSaveAfterwordAt(vol: number): boolean
export function isAutoSaveAfterwordAt(vol: number): boolean {
    const auto = getAutoSaveAfterword();
    return auto !== null && auto.vol === vol;
}

// あとがき用の pendingJump（栞ジャンプ／「続きから読む」の位置受け渡し。独立キー pendingJumpAfterword）。
// writePendingJumpAfterword(jump: PendingJumpAfterword): void
export function writePendingJumpAfterword(jump: PendingJumpAfterword): void {
    localStorage.setItem(KEY_PENDING_JUMP_AFTERWORD, JSON.stringify(jump));
}

// readPendingJumpAfterword(): PendingJumpAfterword | null
export function readPendingJumpAfterword(): PendingJumpAfterword | null {
    try {
        const raw = localStorage.getItem(KEY_PENDING_JUMP_AFTERWORD);
        if (raw) return JSON.parse(raw) as PendingJumpAfterword;
    } catch { /* ignore */ }
    return null;
}

// clearPendingJumpAfterword(): void
export function clearPendingJumpAfterword(): void {
    localStorage.removeItem(KEY_PENDING_JUMP_AFTERWORD);
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

// 栞を読む。新 flat 形（ratio）・旧 nested 形のどちらも flat に正規化して返す。
function _loadBookmarks(): BookmarkEntry[] {
    return _loadBookmarksFromKey(KEY_BOOKMARKS);
}

// 指定キーの栞配列を読む。新 flat 形・旧 nested 形のどちらも flat に正規化して返す。
function _loadBookmarksFromKey(key: string): BookmarkEntry[] {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const list = JSON.parse(raw) as unknown[];
        return list.map(_normalizeBookmark).filter((b): b is BookmarkEntry => b !== null);
    } catch {
        return [];
    }
}

// 1件の栞を flat 形へ正規化する。flat・nested いずれも受け付ける。不正なら null。
// slot が 1..3 でなければ 0（未割当）とし、移行（_assignSlots）で採番する。
// ratio は割合（0〜1）。旧 px scrollLeft しか持たない旧データは割合へ変換できないため 0（scene 先頭へ粗復元）に落とす。
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
    const ratio = Number(o.ratio);
    const savedAt = Number(o.savedAt) || Date.now();
    const slotRaw = Number(o.slot);
    const slot = (slotRaw === 1 || slotRaw === 2 || slotRaw === 3) ? slotRaw : 0;
    return {
        slot,
        ep,
        sec,
        scene: Number.isFinite(scene) ? scene : 0,
        ratio: Number.isFinite(ratio) ? _clamp01(ratio) : 0,
        savedAt,
    };
}

// slot 未割当（0）の栞へ savedAt 昇順で空きスロット（1..3）を採番する。
// 既に有効な slot を持つエントリは尊重し、その番号を避ける。戻り値は採番が起きたか。
function _assignSlots(bookmarks: BookmarkEntry[]): boolean {
    const taken = new Set(bookmarks.filter(b => b.slot >= 1 && b.slot <= 3).map(b => b.slot));
    const unassigned = bookmarks.filter(b => b.slot === 0).sort((a, b) => a.savedAt - b.savedAt);
    let changed = false;
    for (const b of unassigned) {
        for (let s = 1; s <= MAX_SLOTS; s++) {
            if (!taken.has(s)) {
                b.slot = s;
                taken.add(s);
                changed = true;
                break;
            }
        }
    }
    return changed;
}

// 旧 sceneRead / 旧 栞・オートセーブを新スキーマ（単一スロット・割合）へ一度だけ変換する。
// init() が schemaVersion 未一致時のみ呼ぶ。旧 sceneRead キーは保持する。
function _migrate(): void {
    // 旧 sceneRead → reached / read は「pre-multipage（schemaVersion 未設定）」のときだけ実行する。
    // sceneRead 変換と schemaVersion キーは同じ移行（旧 v1→'2'）で同時に導入されたため、schemaVersion が既にある
    // ユーザー（'2'/'3'/'4'）は変換済み。変換後も sceneRead を保持する仕様のため、版数を上げて _migrate を再実行すると、
    // ユーザーが「既読/読破をクリア」で消した reached/read を sceneRead から書き戻してしまう（クリア状態の復活）。
    // schemaVersion === null（未移行）のときだけ走らせて二重変換を防ぐ。
    if (localStorage.getItem(KEY_SCHEMA_VERSION) === null) {
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
    }

    // 栞・オートセーブを単一スロット・割合（ratio）へ。旧位置（forward 進行 px / 生 scrollLeft）は保存時の可動域が不明で
    // 割合へ変換できないため、栞は ep/sec/scene のみ引き継ぎ ratio=0、オートセーブは ep/sec のみ引き継ぎ ratio=0 とする。
    // 源は v3 単一キー（"bookmarks"/"autosave"）。無ければ v4 方向別の vertical スロットを源にする。
    _migrateBookmarks();
    _migrateAutoSave();

    // 方向別キー（v4・未デプロイ）は孤児になるため掃除する（v3 単一キーは冪等・復旧のため残す）。
    for (const mode of ['vertical', 'horizontal']) {
        localStorage.removeItem(`${KEY_BOOKMARKS}.${mode}`);
        localStorage.removeItem(`${KEY_AUTOSAVE}.${mode}`);
    }
}

// 栞を単一スロット・割合へ移行する。既に単一 "bookmarks" があればそれを正規化（ratio=0 化）して採番、
// 無ければ v4 "bookmarks.vertical" を源にする。位置（px）は割合化できないため _normalizeBookmark が ratio=0 に落とす。
function _migrateBookmarks(): void {
    let source = _loadBookmarksFromKey(KEY_BOOKMARKS);
    if (source.length === 0) source = _loadBookmarksFromKey(`${KEY_BOOKMARKS}.vertical`);
    if (source.length === 0) return;
    _assignSlots(source);
    localStorage.setItem(KEY_BOOKMARKS, JSON.stringify(source));
}

// オートセーブを単一スロット・割合へ移行する。単一 "autosave" を優先し、無ければ v4 "autosave.vertical" を源にする。
// _readAutoSaveFromKey が ep/sec を引き継ぎ ratio=0（旧 px は割合化できないため）に落とす。
function _migrateAutoSave(): void {
    let auto = _readAutoSaveFromKey(KEY_AUTOSAVE);
    if (!auto) auto = _readAutoSaveFromKey(`${KEY_AUTOSAVE}.vertical`);
    if (!auto) return;
    const entry: AutoSaveEntry = { ep: auto.ep, sec: auto.sec, ratio: 0, savedAt: auto.savedAt };
    localStorage.setItem(KEY_AUTOSAVE, JSON.stringify(entry));
}
