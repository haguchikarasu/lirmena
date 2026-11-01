/*
 * core/preview.ts
 * 責務: story.json の予告（vol.preview / ep.preview。要件 06-7）が「実効的に有効か」を判定する。
 *       preview が定義され、かつ text の trim が非空のときだけ true。空 text（{ text: "" }）は「preview 無し」と同義で、
 *       未着手の vol/ep に骨組みだけ置く事前配置テンプレとして使える。
 * export: hasEffectivePreview(preview: unknown): boolean
 * 依存: なし（document・要素に触らない純関数）。
 *       呼び出し元：story-integrity（(e)(k)(k')(l) の落とし忘れ検出＝build を止める判定）と
 *       index.ts（目次に予告を描くかの判定）。**両者が同じ関数を使うこと自体が仕様**：判定がズレると
 *       build は通るのに目次だけ壊れる（vol が丸ごと消える等）。以前は 2 か所の複製だった。
 */

// null・非オブジェクト・非 string の text にも false を返す（形の検査は story-integrity (j) が別に行うので、
// その前後どちらで呼ばれても安全にする）。
// hasEffectivePreview(preview: unknown): boolean
export function hasEffectivePreview(preview: unknown): boolean {
    if (preview === undefined || preview === null) return false;
    if (typeof preview !== 'object') return false;
    const text = (preview as { text?: unknown }).text;
    if (typeof text !== 'string') return false;
    return text.trim() !== '';
}
