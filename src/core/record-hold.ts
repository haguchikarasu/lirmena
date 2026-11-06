/*
 * core/record-hold.ts
 * 責務: 記録の保留（要件 06-5）。外部サイト・直接アクセスで開いたタブを「保留中」として覚える。
 *       保留中で最前線でない本文ページでは、到達・読了・オートセーブをすべて記録しない（判定は main.ts と suppression.ts）。
 * export: isHeld(): boolean / setHeld(): void / clearHeld(): void
 *         isExternalReferrer(referrer: string, origin: string): boolean
 *         startsHold(referrer: string, origin: string, navigationType: string): boolean
 * 依存: なし（sessionStorage だけ。document・要素に触らない＝core 層。referrer などは呼び出し側が渡す）。
 *       呼び出し元：main.ts（本文・あとがき）、title.ts（付ける）、index.ts（解除する）。
 *
 * タブごとにするので sessionStorage（core/storage の localStorage の契約とは別のモジュールに置く）。
 * 使えない環境（読み書きが例外を投げる）では何も覚えない：開いたページについては startsHold で判定できるが、
 * 移った先へは引き継げない（全ブロックでは localStorage も残らないので、記録が汚れる心配はない）。
 */

const KEY = 'lirmena.recordHold';

// このタブが保留中か。読めなければ false。
// isHeld(): boolean
export function isHeld(): boolean {
    try { return sessionStorage.getItem(KEY) !== null; } catch { return false; }
}

// このタブを保留中にする。
// setHeld(): void
export function setHeld(): void {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* 覚えられなくても、開いたページでは判定できる */ }
}

// 保留を解除する（目次を開いたとき、最前線の本文ページに着いたとき）。
// clearHeld(): void
export function clearHeld(): void {
    try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
}

// 遷移元が外部か。空（直接アクセス・ブックマーク・リファラなしのリンク）と解釈できない値も外部扱い。
// isExternalReferrer(referrer: string, origin: string): boolean
export function isExternalReferrer(referrer: string, origin: string): boolean {
    if (!referrer) return true;
    try {
        return new URL(referrer).origin !== origin;
    } catch {
        return true;
    }
}

// このページの読み込みで新たに保留を付けるか。付けるのは通常の遷移で外部から来たときだけ。
// リロード・戻る/進むでは付けない（referrer は元の外部のままなので、目次を開いて解除した後に戻ると再び保留になってしまう）。
// startsHold(referrer: string, origin: string, navigationType: string): boolean
export function startsHold(referrer: string, origin: string, navigationType: string): boolean {
    return navigationType === 'navigate' && isExternalReferrer(referrer, origin);
}
