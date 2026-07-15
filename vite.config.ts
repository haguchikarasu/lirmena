import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'fs'
import { validateStoryFiles } from './src/story-integrity'
import type { StoryData } from './src/types'

// マルチページ構成（1ページ＝1sec）のビルド設定。
// - 本文/タイトルページ／巻末あとがきは templates/{reader,title}.html を雛形に、pages() プラグインが
//   public/story.json から contents/[ep]-[sec].html / contents/[ep]-00.html / contents/vol[XX]-afterword.html を
//   build/serve 両方で自動生成する（手書きシェルは廃止）。生成物 contents/ は .gitignore（触らない＝雛形と
//   プラグインだけを追跡する）。
// - 生成前に story.json の整合を story-integrity.ts の純関数で検査し、違反があれば throw して build を止める。
// - 生成 HTML は Vite の MPA 入力として登録され、各ページの <script src="/src/{main,title}.ts"> を
//   解決し、そこが import する CSS 込みでバンドルする。<script>/<link> は Vite が base 付き・ハッシュ名へ自動書換。
// - 目次ページ index.html も MPA 入力（src/index.ts と目次 CSS を import）。
// - 出力はハッシュ名（Vite 既定＝固定名指定を置かない）。固定名参照をやめたのでデプロイ直後のキャッシュ
//   新旧不整合（HTML は新・JS は旧）が構造的に起きない。

const pad = (n: number): string => String(n).padStart(2, '0')

// 本文ページ用の body 属性文字列
function bodyAttrsSec(ep: number, sec: number): string {
  return `data-ep="${ep}" data-sec="${sec}"`
}

// あとがきページ用の body 属性文字列
function bodyAttrsAfterword(vol: number): string {
  return `data-vol="${vol}" data-kind="afterword"`
}

// contents/*.html から見た vol の favicon 相対パス。stage に応じた動的差し替えは目次のみ（本文/タイトル/
// あとがきページは自分の属する vol の favicon で静的に埋める。stage 5 の完結相当は本編読了後の目次到達で
// 初めて発火するので、本文ページ側で favicon を差し替える必要はない）。
// 命名規則：vol[XX]/favicon[N].png（N は vol.volume と一致。最終 vol のみ stage 5＝完結用 favicon5.png も
// 併置し、それは index.ts の動的差し替えでのみ参照される＝本文/タイトル/あとがき静的埋め込みは vol.volume 番のみ）。
function faviconHrefFor(vol: number): string {
  return `../vol${pad(vol)}/favicon${vol}.png`
}

// reader.html の {{bodyAttrs}} / {{faviconHref}} プレースホルダを埋める
function renderReaderTpl(tpl: string, attrs: string, faviconHref: string): string {
  return tpl
    .replace(/\{\{bodyAttrs\}\}/g, attrs)
    .replace(/\{\{faviconHref\}\}/g, faviconHref)
}

// title.html の {{ep}} / {{sec}} / {{faviconHref}} プレースホルダを埋める（既存互換）
function renderTitleTpl(tpl: string, ep: number, sec: number, faviconHref: string): string {
  return tpl
    .replace(/\{\{ep\}\}/g, String(ep))
    .replace(/\{\{sec\}\}/g, String(sec))
    .replace(/\{\{faviconHref\}\}/g, faviconHref)
}

// story.json ＋ テンプレ2種から contents/[ep]-[sec].html / [ep]-00.html / vol[XX]-afterword.html を全生成し、
// 生成パス配列を返す。生成範囲：各 vol 各 ep について title(sec=0) 1本 ＋ sections 配列分の reader、
// vol.afterword.published=true のときはさらに vol[XX]-afterword.html。published 無関係で HTML は全生成
// （旧手書きシェルと一致）。
function generatePages(root: string): string[] {
  const story = JSON.parse(
    readFileSync(resolve(root, 'public/story.json'), 'utf-8'),
  ) as StoryData

  // ── 整合チェック（違反時は build fail）─────────────────────────
  const errors = validateStoryFiles(story, {
    afterwordTxtExists: (vol) =>
      existsSync(resolve(root, `public/vol${pad(vol)}/vol${pad(vol)}-afterword.txt`)),
    coverExists: (vol, file) => existsSync(resolve(root, `public/vol${pad(vol)}/${file}`)),
  })
  if (errors.length > 0) {
    throw new Error(`story.json 整合違反:\n  - ${errors.join('\n  - ')}`)
  }

  const readerTpl = readFileSync(resolve(root, 'templates/reader.html'), 'utf-8')
  const titleTpl = readFileSync(resolve(root, 'templates/title.html'), 'utf-8')

  const outDir = resolve(root, 'contents')
  mkdirSync(outDir, { recursive: true })
  // 既存の生成 html を掃除（削除 sec の残留防止）。生成専用 dir なので html のみ対象。
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.html')) rmSync(resolve(outDir, f))
  }

  const paths: string[] = []
  for (const vol of story) {
    const favicon = faviconHrefFor(vol.volume)
    for (const ep of vol.episodes) {
      // タイトルページ (sec=0)
      const titlePath = resolve(outDir, `${pad(ep.id)}-00.html`)
      writeFileSync(titlePath, renderTitleTpl(titleTpl, ep.id, 0, favicon))
      paths.push(titlePath)
      // 本文ページ
      for (const sec of ep.sections) {
        const p = resolve(outDir, `${pad(ep.id)}-${pad(sec.id)}.html`)
        writeFileSync(p, renderReaderTpl(readerTpl, bodyAttrsSec(ep.id, sec.id), favicon))
        paths.push(p)
      }
    }
    // あとがきページ（published=true のときだけ生成）
    if (vol.afterword?.published === true) {
      const afterwordPath = resolve(outDir, `vol${pad(vol.volume)}-afterword.html`)
      writeFileSync(afterwordPath, renderReaderTpl(readerTpl, bodyAttrsAfterword(vol.volume), favicon))
      paths.push(afterwordPath)
    }
  }
  return paths
}

// 本文/タイトル/あとがきページを story.json から自動生成し、MPA 入力に登録するプラグイン。
function pages(root: string): Plugin {
  return {
    name: 'lirmena-pages',
    // build/serve 両方で最初に走る。ページを実ファイル生成し MPA 入力として登録する
    // （serve では生成した実ファイルを dev サーバがそのまま配信＝middleware 不要）。
    config() {
      const pagePaths = generatePages(root)
      return { build: { rollupOptions: { input: [resolve(root, 'index.html'), ...pagePaths] } } }
    },
    // dev：story.json / テンプレの変更を監視し、再生成して full-reload する。
    configureServer(server) {
      const watched = [
        resolve(root, 'public/story.json'),
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
