/*
 * ruby.ts
 * 責務: ルビ記法（|漢字《かんじ》）を含む文字列を <ruby> 要素＋テキストノードに展開する共有ヘルパー。
 *       本文外（ep タイトル・キャラ名/説明など）の短い文字列のインライン表示に使う。
 * export: applyRuby(text: string, el: HTMLElement): void
 * 依存: なし（DOM 生成のみ）
 *
 * - innerHTML を使わず createTextNode / createElement で組み立てる（XSS 安全）。
 * - 対象はルビのみ。縦中横（^…^）・傍点（《《…》》）は展開しない（本文専用の parser.ts/renderer.ts が担当）。
 * - 本文の DOM 構造（renderer.ts）と一致：<ruby>base<rt>rt</rt></ruby>。
 * - 目次ページ（index.ts）は src/ を import しない設計のため、本関数のロジックを inline 複製する。
 */

// |base《rt》 記法をパースして ruby 要素とテキストノードを el に追加する。
// マッチしない部分は素のテキストノードとして追加する（接頭辞・接尾辞はそのまま）。
// applyRuby(text: string, el: HTMLElement): void
export function applyRuby(text: string, el: HTMLElement): void {
    const re = /\|([^《\n]+)《([^》\n]+)》/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(m[1]));
        const rt = document.createElement('rt');
        rt.textContent = m[2];
        ruby.appendChild(rt);
        el.appendChild(ruby);
        last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}
