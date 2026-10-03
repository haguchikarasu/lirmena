/*
 * bg-stub.ts
 * 責務: 制作用のスタブ背景。本文に @@BG:stub=ラベル@@ と書いた場所に「ラベルごとの色ベタ＋左上に大きなラベル」を
 *       背景として出す（挿絵のアタリ付け用）。dev サーバのミドルウェアとして、画像 URL .../stub=ラベル への
 *       リクエストにその場で SVG を返す。
 * export: bgStub(): BgStubPlugin   — Vite プラグイン（apply: 'serve'）
 * 依存: node:fs / node:path のみ（src/ の他モジュールも vite の型も import しない）。本文 .txt を読む（public/ 配下・読み取りのみ）。
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
 *   - 色はセクション内の登場順で決める：画像リクエストの Referer（どの本文ページから来たか）でセクションを特定し、
 *     その本文 .txt（public/ 配下＝保存済みの版）を読んで stub ラベルを初出順に並べ、(順番 × 黄金角) を色相にした hsl。
 *     隣り合う順番は色相が黄金角ぶん大きく離れる＝「隣のシーンと同じ色」が起きない。同じラベルは同じ色。
 *     エディタで未保存の編集は、保存するまで色の順番に反映されない
 *   - Referer が無い・本文が読めない・ラベルが見つからない（URL を直接開いた等）ときは、ラベル文字列のハッシュ
 *     （h = h*31 + 文字コード）× 黄金角 にフォールバックする（違うラベルでも近い色になることがある）
 *   - ラベルは左上（右上は dev バッジ #badge-dev が居る）。大きさは本文の文字サイズ（12.3〜20.1px）の約 5〜8 倍
 *
 * vite の型を import しない理由: vite が lirmena-draft/node_modules と エディタ/node_modules の 2 部あり、
 *   エディタの型検査では「draft 側の Plugin 型」を「エディタ側の設定型」に渡すことになる。vite の型定義には
 *   private メンバーを持つクラスがあり、TypeScript は別の部の同名クラスを別物として扱うので型が合わない。
 *   使う部分だけの最小限の型を下に書けば、どちらの vite にも構造的に合う。DOM は使わない（エディタの tsc は DOM なし）。
 *   本文を読むための node:fs / node:path だけは使う（どちらの tsc からも @types/node が見える。本体のバンドルには入らない）。
 *   エディタ側は相対パス（'../lirmena-draft/src/bg-stub'）で import する（URL 形式は config のバンドルが解決できない）。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── CONFIG ─────────────────────────────────────────────
const LABEL_PX = 96;              // ラベルの文字サイズ(px)
const LABEL_MARGIN_PX = 32;       // 画面の左端・上端からの余白(px)
const LABEL_FONT = "'Hiragino Sans','Yu Gothic','Meiryo',sans-serif";
const HUE_STEP = 137.508;         // 順番（またはハッシュ）1 つぶんの色相の回転（黄金角）
const SATURATION = 45;            // 色ベタの彩度(%)
const LIGHTNESS = 42;             // 色ベタの明度(%)

// Vite（Connect）のうち本ファイルが使う部分だけの最小限の型。
type StubReq = { url?: string; method?: string; headers: { referer?: string } };
type StubRes = {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
};
type StubServer = {
  config: { publicDir: string };
  middlewares: { use(fn: (req: StubReq, res: StubRes, next: () => void) => void): unknown };
};
export type BgStubPlugin = {
  name: string;
  apply: 'serve';
  configureServer(server: StubServer): void;
};

// 末尾が /stub=<ラベル> の URL パスにマッチする（クエリは呼び出し側で落とす。ラベルは URL エンコードのまま）
const STUB_RE = /\/stub=([^/]+)$/;
// 本文中の stub ラベル（第 1 トークン＝ : か @ の手前まで）
const TAG_RE = /@@BG:stub=([^:@]+)/g;

// SVG のテキストに入れるため XML の特殊文字を逃がす。
// escapeXml(s: string): string
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// 画像の URL パスと Referer から、そのスタブが書かれた本文 .txt のパスを組む。特定できなければ null。
//   本文: 画像 /volVV/epEE/img/stub=… ＋ Referer /contents/EE-SS.html → public/volVV/epEE/txt/EE-SS.txt
//   あとがき: 画像 /volVV/stub=… ＋ Referer /contents/volVV-afterword.html → public/volVV/volVV-afterword.txt
// txtPathFor(publicDir: string, imgPath: string, referer: string | undefined): string | null
function txtPathFor(publicDir: string, imgPath: string, referer: string | undefined): string | null {
  if (!referer) return null;
  let ref: string;
  try { ref = new URL(referer).pathname; } catch { return null; }
  const ep = /\/vol(\d+)\/ep(\d+)\/img\/stub=[^/]+$/.exec(imgPath);
  const sec = /\/contents\/(\d+)-(\d+)\.html$/.exec(ref);
  if (ep && sec) return join(publicDir, `vol${ep[1]}`, `ep${ep[2]}`, 'txt', `${sec[1]}-${sec[2]}.txt`);
  const af = /\/vol(\d+)\/stub=[^/]+$/.exec(imgPath);
  if (af && /\/contents\/vol\d+-afterword\.html$/.test(ref)) return join(publicDir, `vol${af[1]}`, `vol${af[1]}-afterword.txt`);
  return null;
}

// 色相を決める。本文が読めればラベルの初出順、読めなければラベル文字列のハッシュ（どちらも × 黄金角）。
// stubHue(label: string, txtPath: string | null): number
function stubHue(label: string, txtPath: string | null): number {
  if (txtPath !== null) {
    try {
      const order: string[] = [];
      for (const m of readFileSync(txtPath, 'utf-8').matchAll(TAG_RE)) {
        if (!order.includes(m[1])) order.push(m[1]);
      }
      const idx = order.indexOf(label);
      if (idx >= 0) return ((idx + 1) * HUE_STEP) % 360;
    } catch { /* 読めなければハッシュへ */ }
  }
  let h = 0;
  for (const ch of label) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 100003;
  return (h * HUE_STEP) % 360;
}

// 色ベタ＋左上のラベルの SVG を組み立てる。
// stubSvg(label: string, hue: number): string
function stubSvg(label: string, hue: number): string {
  const baseline = LABEL_MARGIN_PX + LABEL_PX * 0.8; // 文字の上端がおよそ余白の位置に来るベースライン
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">`
    + `<rect width="100%" height="100%" fill="hsl(${hue.toFixed(1)},${SATURATION}%,${LIGHTNESS}%)"/>`
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
        const path = (req.url ?? '').split('?')[0];
        const m = STUB_RE.exec(path);
        if (m === null) return next();
        let label: string;
        try { label = decodeURIComponent(m[1]); } catch { return next(); } // 壊れたエンコードはスタブ扱いしない
        const hue = stubHue(label, txtPathFor(server.config.publicDir, path, req.headers.referer));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(stubSvg(label, hue));
      });
    },
  };
}
