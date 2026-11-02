/*
 * core/query.ts
 * 責務: 遷移先の URL に現在ページのクエリ文字列（例 "?dev"）を引き継ぐ。?dev を付けて開いた作者の閲覧が
 *       ページを移っても計測から外れたままになるようにするため（analytics.ts の dev 判定）。
 * export: withQuery(path: string, search?: string): string
 * 依存: なし（document・要素に触らない）。search を省くと location.search を読む＝ブラウザで呼ぶ前提。
 *       DOM の無い環境（core の単体テスト）では search を明示して渡す。
 *       呼び出し元：state.ts（本文の遷移先 URL）、index.ts（目次の各リンク）、ui/world-nav（資料ページの帯）、
 *       ui/world-sheet（資料シートの「ページで開く」）。
 */

// path に search をそのまま連結する（search は "?" 付きの形。空文字ならそのまま path）。
// withQuery(path: string, search?: string): string
export function withQuery(path: string, search: string = location.search): string {
    return path + search;
}
