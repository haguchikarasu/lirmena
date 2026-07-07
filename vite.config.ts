import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs'

// マルチページ構成（1ページ＝1sec）のビルド設定。
// - 本文/タイトルページは templates/{reader,title}.html を雛形に、pages() プラグインが
//   episodes.json から contents/[ep]-[sec].html を build/serve 両方で自動生成する（手書きシェルは廃止）。
//   生成物 contents/ は .gitignore（触らない＝雛形とプラグインだけを追跡する）。
// - 生成 HTML は Vite の MPA 入力として登録され、各ページの <script src="/src/{main,title}.ts"> を
//   解決し、そこが import する CSS 込みでバンドルする。<script>/<link> は Vite が base 付き・ハッシュ名へ自動書換。
// - 目次ページ index.html も MPA 入力（src/index.ts と目次 CSS を import）。
// - 出力はハッシュ名（Vite 既定＝固定名指定を置かない）。固定名参照をやめたのでデプロイ直後のキャッシュ
//   新旧不整合（HTML は新・JS は旧）が構造的に起きない。

interface SectionDef { id: number; published: boolean }
interface EpisodeDef { id: number; sections: SectionDef[] }

const pad = (n: number): string => String(n).padStart(2, '0')

// テンプレの {{ep}} / {{sec}} を埋める（tsconfig の lib に依存しないよう replaceAll ではなく正規表現 replace）。
function renderTemplate(tpl: string, ep: number, sec: number): string {
  return tpl.replace(/\{\{ep\}\}/g, String(ep)).replace(/\{\{sec\}\}/g, String(sec))
}

// episodes.json ＋ テンプレ2種から contents/[ep]-[sec].html を全生成し、生成パス配列を返す。
// 生成範囲：各 ep に title(sec=0) 1本 ＋ sections 配列分の reader（published 無関係＝旧手書きシェルと一致）。
function generatePages(root: string): string[] {
  const episodes = JSON.parse(
    readFileSync(resolve(root, 'public/episodes.json'), 'utf-8'),
  ) as EpisodeDef[]
  const readerTpl = readFileSync(resolve(root, 'templates/reader.html'), 'utf-8')
  const titleTpl = readFileSync(resolve(root, 'templates/title.html'), 'utf-8')

  const outDir = resolve(root, 'contents')
  mkdirSync(outDir, { recursive: true })
  // 既存の生成 html を掃除（削除 sec の残留防止）。生成専用 dir なので html のみ対象。
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.html')) rmSync(resolve(outDir, f))
  }

  const paths: string[] = []
  for (const ep of episodes) {
    const titlePath = resolve(outDir, `${pad(ep.id)}-00.html`)
    writeFileSync(titlePath, renderTemplate(titleTpl, ep.id, 0))
    paths.push(titlePath)
    for (const sec of ep.sections) {
      const p = resolve(outDir, `${pad(ep.id)}-${pad(sec.id)}.html`)
      writeFileSync(p, renderTemplate(readerTpl, ep.id, sec.id))
      paths.push(p)
    }
  }
  return paths
}

// 本文/タイトルページを episodes.json から自動生成し、MPA 入力に登録するプラグイン。
// 旧 devShellBundles()（固定名バンドルへの dev リダイレクト）を置き換える。
function pages(root: string): Plugin {
  return {
    name: 'lirmena-pages',
    // build/serve 両方で最初に走る。ページを実ファイル生成し MPA 入力として登録する
    // （serve では生成した実ファイルを dev サーバがそのまま配信＝middleware 不要）。
    config() {
      const pagePaths = generatePages(root)
      return { build: { rollupOptions: { input: [resolve(root, 'index.html'), ...pagePaths] } } }
    },
    // dev：episodes.json / テンプレの変更を監視し、再生成して full-reload する。
    configureServer(server) {
      const watched = [
        resolve(root, 'public/episodes.json'),
        resolve(root, 'templates/reader.html'),
        resolve(root, 'templates/title.html'),
      ].map((p) => p.replace(/\\/g, '/'))
      for (const f of watched) server.watcher.add(f)
      server.watcher.on('change', (file) => {
        if (watched.includes(file.replace(/\\/g, '/'))) {
          generatePages(root)
          server.ws.send({ type: 'full-reload' })
        }
      })
    },
    // 本体 CSS の <link rel="stylesheet"> を <script type="module"> より前に移動する（FOUC 回避）。
    // Vite 既定では script の後ろに link が置かれ、CSS の render blocking が効くまでの一瞬に body の
    // 生 DOM（配置未指定のボタン等）が見えることがある。link を先頭側へ寄せて旧シェル構成と同じ順序に戻す。
    // 'post' で Vite が bundled tags を挿入した後に走らせる（build/serve 両方に効く）。
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const links: string[] = []
        // <link ...> を1つずつ見て、rel="stylesheet" かつ href を持つものだけ移動する。
        // href を持たない空の <link rel="stylesheet"> や rel="icon"/"modulepreload" は対象外。
        const stripped = html.replace(/[ \t]*<link\b[^>]*>\s*/g, (m) => {
          if (/\brel="stylesheet"/.test(m) && /\bhref="[^"]+"/.test(m)) {
            links.push(m.trim())
            return ''
          }
          return m
        })
        if (links.length === 0) return html
        // 最初の <script type="module"> の前に挿入（見つからない場合は </head> 直前）。
        const injectBefore = /<script\s+type="module"/
        if (injectBefore.test(stripped)) {
          return stripped.replace(injectBefore, `${links.join('\n  ')}\n  <script type="module"`)
        }
        return stripped.replace(/<\/head>/, `${links.join('\n  ')}\n</head>`)
      },
    },
  }
}

export default defineConfig({
  base: '/lirmena/',
  // Vite の htmlInlineProxyPlugin は id と config.root を case-sensitive な String.replace で
  // 突き合わせてキャッシュキーを組む（vitejs/vite#16324）。Windows で cwd と __dirname のドライブ文字
  // casing が食い違う（`c:` vs `C:`）と templates の <style> ブロックの proxy キーがミスマッチし、
  // build が「No matching HTML proxy module found」で落ちる。root を __dirname に明示して、
  // pages() が rollupOptions.input に流し込むパスと config.root の casing を構造的に一致させる。
  root: __dirname,
  plugins: [pages(__dirname)],
  // dev サーバを LAN 公開する（スマホ等の実機確認用）。
  // host: true で全インターフェースにバインドし、起動時に Network URL を表示する。
  // port を固定し strictPort で空きポートへの自動ずらしを禁止する。
  // lirmena/ は 5174、lirmena-draft/ は 5173 と分けてあり、両者を同時に立ち上げても競合しない。
  // allowedHosts: '.local' は mDNS 経由（`http://<PC名>.local:5174/`）、
  // '.devtunnels.ms' は VS Code のポート転送（Dev Tunnels）経由のアクセスを許可する。
  server: { host: true, port: 5174, strictPort: true, allowedHosts: ['.local', '.devtunnels.ms'] },
  // preview サーバ（`vite preview`）も dev と同様に LAN 公開する。
  // preview の既定ポートは 4173。lirmena/ は 4174、lirmena-draft/ は 4173 と分けて併走可能にする。
  preview: { host: true, port: 4174, strictPort: true, allowedHosts: ['.local', '.devtunnels.ms'] },
  // build.rollupOptions.input は pages() プラグインが config() で注入する（index.html ＋ 生成 contents/*.html）。
  // output はハッシュ名（Vite 既定）に戻すため固定名指定を置かない。
})
