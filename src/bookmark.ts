/*
 * bookmark.ts
 * 責務: 本文側のブラウザ永続化の窓口。栞・オートセーブ・既読（到達／読了）の localStorage 読み書きと旧データ移行は
 *       core/storage.ts が持ち、ここはそれを丸ごと再 export する。**ここ自身が持つのは履歴エントリ（history.state）への
 *       per-entry スクロール位置の保存／復元だけ**（ブラウザ戻る/進むの位置復元用）。history.state は本文ページにしか
 *       意味が無いので reader 層に置き、目次と共有する core/storage には入れない。
 * export: core/storage.ts の全 export（init・record*・get*・clear*・pendingJump 系・あとがき系・型 BookmarkEntry など）
 *         saveScrollToHistory(ratio: number): void
 *         readScrollFromHistory(): number | null
 *         nextHistoryState(prev: unknown, ratio: number): Record<string, unknown> & { lirmenaRatio: number }
 *         readHistoryRatio(state: unknown): number | null
 * 依存: core/storage（localStorage の契約と移行）。history はグローバル API。
 *       呼び出し元：main / nav / menu / reader / title（本文側）。目次（index.ts）はここを読まず core/storage を直接読む。
 *
 * ── 履歴エントリのスクロール位置（history.state。localStorage ではない）─────────────────
 *   "lirmenaRatio"（history.state 内のキー）  現在の履歴エントリに刻むスクロール範囲比（0〜1）。
 *     autosave の単一スロットと違い履歴エントリごとに位置を保持できるため、戻る/進むで HTML 再読込
 *     （bfcache 破棄）されても per-entry に復元できる。割合なので書字方向を跨いでも一貫する。
 *     記録: reader.ts がスクロール通知をスロットルして saveScrollToHistory() を呼ぶ（autosave と同じスロットルに相乗り）
 *     消費: main.ts の初期スクロール復元が readScrollFromHistory() を読む（前進ナビでない時・autosave より優先）
 *     抑止フラグ（core/storage の setAutoRecordSuppressed）の対象外。
 */

export * from './core/storage';

// history.state 内のスクロール位置キー（localStorage ではない）。割合化（schemaVersion 5）に伴い旧 "lirmenaScrollLeft"（生 px）から
// 改名し、旧 px エントリを読まず無視する（横書き対応デプロイ直後の戻る/進むで legacy px が誤った端へ復元されるのを防ぐ）。
const HISTORY_RATIO_KEY = 'lirmenaRatio';

// 0〜1 にクランプする。割合（ratio）の保存で範囲外の値を正す。
function _clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
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

