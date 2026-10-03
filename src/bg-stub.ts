/*
 * bg-stub.ts
 * 責務: 制作用のスタブ背景。本文に @@BG:stub=ラベル@@ と書いた場所に「ラベルごとの色ベタ＋左上に大きなラベル」を
 *       背景として出す（挿絵のアタリ付け用）。dev サーバのミドルウェアとして、画像 URL .../stub=ラベル への
 *       リクエストにその場で SVG を返す。
 * export: bgStub(): BgStubPlugin   — Vite プラグイン（apply: 'serve'）
 * 依存: なし（src/ の他モジュールも vite の型も import しない）。
 *
 * 位置づけ（本機能の仕様と判断理由の正典はこのコメント。design/ は持たない）:
 *   - **本体は本機能を知らない**。呼び出し元は lirmena(-draft)/vite.config.ts と エディタ/vite.config.ts の
 *     plugins だけで、src/ のどのモジュールも本ファイルを import しない（.dependency-cruiser.cjs の
 *     bg-stub-isolation が禁止）。本番ビルド・vite preview（4173/4174）・GitHub Pages には一切入らない
 *   - 本体とのつながりは URL の約束だけ：parser.ts は @@BG:stub=1@@ を「stub=1 という名前の画像」
 *     （bgFile: "stub=1"）として読み、bg.ts は .../img/stub=1（あとがきは vol[XX]/stub=1）を <img> に
 *     読みに行く。本ファイルはその末尾 /stub=ラベル を横取りする。約束が崩れてもスタブが黒背景に戻るだけで
 *     本体には何も起きないので、機械テストは置かない（機械テストは本番機能だけが対象）
 *   - 画像として返すのは、背景レイヤー .bg-layer が <img>（文字も子要素も持てない置換要素）だから。
 *     bg.ts からは普通の背景画像に見えるので、クロスフェード・暗幕（dim）・背景鑑賞モードがそのまま効く
 *
 * 書き方: @@BG:stub=ラベル@@（ラベルは任意の文字列。例 stub=1 / stub=森の入口）。ファイル名は拡張子込みという
 *   要件 05-1 の例外。ラベルに使えない文字：`:` `@`（タグの区切り＝parser の都合）、`/` `?` `#`（URL の区切りになる）。
 *   日本語・空白はブラウザが URL エンコードして送ってくるので、ここで戻す。
 *   後ろのシーンパラメータは本体の解釈どおり：dim は効く／xpos・ypos は効かない（下記の通り切り抜かれないため）。
 *   ラベルはただの名札で、セクションをまたいだ管理はしない。長いラベルは画面からはみ出る（折り返さない）。エディタの【スタブ】（未執筆本文の目印・
 *   エディタ/ui/shared/stub.ts）や story.json の仮置き ep とは別物。
 *
 * 出る環境: draft プレビュー 5173 ／ 本番 dev 5174 ／ エディタのプレビュー欄 5180。
 *   出ない環境（黒背景＋コンソールに 404）: vite preview 4173/4174 ／ GitHub Pages。公開時の備えは置かない
 *   （差し替え前提のアタリなので、公開前の確認で気づける）。
 *
 * SVG の作り:
 *   - ルートは width/height="100%" で viewBox を付けない＝固有の寸法も縦横比も持たない画像になり、
 *     object-fit: cover でも切り抜かれず .bg-layer の箱にそのまま合う。左上のラベルが画面外に出ず、
 *     回転・リサイズはブラウザが描き直す
 *   - 色はラベルの文字列ハッシュ × 黄金角 を色相にした hsl。ハッシュは h = h*31 + 文字コード なので、
 *     末尾 1 文字だけ違うラベル（1 と 2、場面A と 場面B）は色相が黄金角ぶん大きく離れる
 *   - ラベルは左上（右上は dev バッジ #badge-dev が居る）。大きさは本文の文字サイズ（12.3〜20.1px）の約 5〜8 倍
 *
 * vite の型を import しない理由: vite が lirmena-draft/node_modules と エディタ/node_modules の 2 部あり、
 *   エディタの型検査では「draft 側の Plugin 型」を「エディタ側の設定型」に渡すことになる。vite の型定義には
 *   private メンバーを持つクラスがあり、TypeScript は別の部の同名クラスを別物として扱うので型が合わない。
 *   使う部分だけの最小限の型を下に書けば、どちらの vite にも構造的に合う。同じ理由で DOM も node:* も使わない
 *   （lirmena の tsc＝DOM あり、エディタの tsc＝DOM なし の両方を通す）。
 *   エディタ側は相対パス（'../lirmena-draft/src/bg-stub'）で import する（URL 形式は config のバンドルが解決できない）。
 */

// ── CONFIG ─────────────────────────────────────────────
const LABEL_PX = 96;              // ラベルの文字サイズ(px)
const LABEL_MARGIN_PX = 32;       // 画面の左端・上端からの余白(px)
const LABEL_FONT = "'Hiragino Sans','Yu Gothic','Meiryo',sans-serif";
const HUE_STEP = 137.508;         // ハッシュ 1 つぶんの色相の回転（黄金角）
const SATURATION = 45;            // 色ベタの彩度(%)
const LIGHTNESS = 42;             // 色ベタの明度(%)

// Vite（Connect）のうち本ファイルが使う部分だけの最小限の型。
type StubReq = { url?: string; method?: string };
type StubRes = {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
};
type StubServer = {
  middlewares: { use(fn: (req: StubReq, res: StubRes, next: () => void) => void): unknown };
};
export type BgStubPlugin = {
  name: string;
  apply: 'serve';
  configureServer(server: StubServer): void;
};

// 末尾が /stub=<ラベル> の URL パスにマッチする（クエリは呼び出し側で落とす。ラベルは URL エンコードのまま）
const STUB_RE = /\/stub=([^/]+)$/;

// SVG のテキストに入れるため XML の特殊文字を逃がす。
// escapeXml(s: string): string
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// 色ベタ＋左上のラベルの SVG を組み立てる。
// stubSvg(label: string): string
function stubSvg(label: string): string {
  let h = 0;
  for (const ch of label) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 100003;
  const hue = ((h * HUE_STEP) % 360).toFixed(1);
  const baseline = LABEL_MARGIN_PX + LABEL_PX * 0.8; // 文字の上端がおよそ余白の位置に来るベースライン
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">`
    + `<rect width="100%" height="100%" fill="hsl(${hue},${SATURATION}%,${LIGHTNESS}%)"/>`
    + `<text x="${LABEL_MARGIN_PX}" y="${baseline}" font-family="${LABEL_FONT}" font-size="${LABEL_PX}"`
    + ` font-weight="bold" fill="#fff" fill-opacity="0.9">${escapeXml(label)}</text>`
    + `</svg>`;
}

// .../stub=ラベル への GET / HEAD に SVG を返すミドルウェアを登録する Vite プラグイン。
// それ以外のリクエストは next() で素通しする。configureServer の中で同期登録するので、
// plugins 配列で前にあるプラグインのミドルウェアの後・Vite 本体の配信の前に走る。
// bgStub(): BgStubPlugin
export function bgStub(): BgStubPlugin {
  return {
    name: 'lirmena-bg-stub',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const m = STUB_RE.exec((req.url ?? '').split('?')[0]);
        if (m === null) return next();
        let label: string;
        try { label = decodeURIComponent(m[1]); } catch { return next(); } // 壊れたエンコードはスタブ扱いしない
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(stubSvg(label));
      });
    },
  };
}
