import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'

// マルチページ構成（1ページ＝1sec）のビルド設定。
// - 入力は3エントリ: 目次ページ HTML（index.html）／タイトルページ JS（title.ts）／本文ページ共有 JS（main.ts）。
//   タイトル・本文シェル（public/contents/[ep]-[sec].html）は静的ファイルとして手書き（AI生成）し、
//   Vite が public/ を dist/ へ無変換コピーする。Vite のページエントリには登録しない（変換・バンドルしない）。
// - 出力はハッシュなし固定名。シェルが絶対パスで固定名 JS/CSS を参照できるようにする（base: '/lirmena/'）。

// dev サーバ限定の橋渡しプラグイン。
// シェルは本番形（固定名バンドルを絶対パス参照）の単一ファイルで、これがそのまま本番になる。
// ただし dev には固定名バンドルが無いため、シェルが参照する /assets/* をソースへリダイレクトして
// `npm run dev` でも本文・タイトルページを表示できるようにする（シェルを dev/prod で二重に持たない）。
// build には一切関与しない（apply: 'serve'）。
function devShellBundles(): Plugin {
  // 固定名バンドルパス（末尾一致） → dev のソース URL。base 付き絶対 URL で返す。
  const redirects: Record<string, string> = {
    '/assets/main.js': '/lirmena/src/main.ts',
    '/assets/title.js': '/lirmena/src/title.ts',
    '/assets/main.css': '/lirmena/style.css',
  }
  return {
    name: 'dev-shell-bundles',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        const key = Object.keys(redirects).find((k) => path.endsWith(k))
        if (key) {
          res.statusCode = 302
          res.setHeader('Location', redirects[key])
          res.end()
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/lirmena/',
  plugins: [devShellBundles()],
  // dev サーバを LAN 公開する（スマホ等の実機確認用）。
  // host: true で全インターフェースにバインドし、起動時に Network URL を表示する。
  // port を固定し strictPort で空きポートへの自動ずらしを禁止する。
  // lirmena/ は 5174、lirmena-draft/ は 5173 と分けてあり、両者を同時に立ち上げても競合しない。
  // allowedHosts: '.local' は mDNS 経由（`http://<PC名>.local:5174/`）、
  // '.devtunnels.ms' は VS Code のポート転送（Dev Tunnels）経由のアクセスを許可する。
  server: { host: true, port: 5174, strictPort: true, allowedHosts: ['.local', '.devtunnels.ms'] },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        title: resolve(__dirname, 'src/title.ts'),
        main: resolve(__dirname, 'src/main.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
