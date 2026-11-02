import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'fs'
import { validateStoryFiles } from './src/story-integrity'
import { bgStub } from './src/bg-stub'
import type { StoryData } from './src/types'

// マルチページ構成（1ページ＝1sec）のビルド設定。
// - 本文/タイトルページ／巻末あとがきは templates/{reader,title}.html を雛形に、pages() プラグインが
//   public/story.json から contents/[ep]-[sec].html / contents/[ep]-00.html / contents/vol[XX]-afterword.html を
//   build/serve 両方で自動生成する（手書きシェルは廃止）。生成物 contents/ は .gitignore（触らない＝雛形と
//   プラグインだけを追跡する）。
// - 生成前に story.json の整合（と characters.json との整合＝(o)）を story-integrity.ts の純関数で検査し、違反があれば throw して build を止める。
// - 生成 HTML は Vite の MPA 入力として登録され、各ページの <script src="/src/{main,title}.ts"> を
//   解決し、そこが import する CSS 込みでバンドルする。<script>/<link> は Vite が base 付き・ハッシュ名へ自動書換。
// - 目次ページ index.html も MPA 入力（src/index.ts と目次 CSS を import）。
// - ページをまたいで共通の静的な HTML（設定・共有のポップアップ）は templates/parts/*.html に 1 つずつ置き、
//   各ページの `<!-- include: parts/xxx.html -->` の 1 行を expandIncludes が中身に置き換える。
//   本文/タイトル/あとがきページは generatePages が**書き出す時点で**展開する（contents/*.html の実ファイルに
//   中身が入る＝lirmena の plugins を通さないエディタのプレビューでもそのまま効く）。目次・用語集は
//   transformIndexHtml（order: 'pre'）が dev・build の両方で展開する。
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

// `<!-- include: parts/xxx.html -->` を templates/ からの相対パスのファイルの中身に置き換える（1 段だけ・入れ子なし）。
// 名前は parts/ 直下の英小文字・数字・ハイフンだけ（templates の外を読ませない）。見つからなければ throw して
// build を止める（差し込み漏れのまま設定ポップアップが空のページを出さない）。
// expandIncludes(html: string, root: string): string
export function expandIncludes(html: string, root: string): string {
  return html.replace(/<!--\s*include:\s*(\S+?)\s*-->/g, (_m, rel: string) => {
    if (!/^parts\/[a-z0-9-]+\.html$/.test(rel)) {
      throw new Error(`include の指定が不正: ${rel}（parts/<名前>.html だけを受け付ける）`)
    }
    const file = resolve(root, 'templates', rel)
    if (!existsSync(file)) throw new Error(`include の断片が無い: templates/${rel}`)
    return readFileSync(file, 'utf-8').trim()
  })
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

// public/characters.json を読んで JSON のまま返す。無い・壊れているときは undefined
// （形の検査は story-integrity の (o) に任せる＝「配列でない」として build を止める）。
function readCharacters(root: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(root, 'public/characters.json'), 'utf-8'))
  } catch {
    return undefined
  }
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
    // 巻の素材（(q)）。path は public からの相対（規約は src/core/theme.ts が持つ）
    themeFileExists: (path) => existsSync(resolve(root, 'public', path)),
    // 人物の画像（(o)）。path は public からの相対（規約は src/core/chara.ts が持つ）
    charaFileExists: (path) => existsSync(resolve(root, 'public', path)),
    characters: readCharacters(root),
  })
  if (errors.length > 0) {
    throw new Error(`story.json / characters.json 整合違反:\n  - ${errors.join('\n  - ')}`)
  }

  const readerTpl = expandIncludes(readFileSync(resolve(root, 'templates/reader.html'), 'utf-8'), root)
  const titleTpl = expandIncludes(readFileSync(resolve(root, 'templates/title.html'), 'utf-8'), root)

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
      // 静的なページ（目次・資料ページ 3 枚）はここに直書きする。この input は丸ごと上書きなので、足し忘れたページはビルドされない
      // （dev は root の HTML をそのまま配信するので気づけない＝preview / 本番だけ 404 になる）
      const staticPages = ['index.html', 'characters.html', 'map.html', 'glossary.html'].map(p => resolve(root, p))
      return { build: { rollupOptions: { input: [...staticPages, ...pagePaths] } } }
    },
    // dev：story.json / characters.json / テンプレ・差し込みの断片の変更を監視し、再生成して full-reload する。
    // characters.json は生成には使わないが、story-integrity (o) の入力なので直したら検査を走らせ直す。
    // 断片（templates/parts/*.html）は起動時にあるものだけを見る（足したら dev を立て直す）。
    configureServer(server) {
      const partsDir = resolve(root, 'templates/parts')
      const parts = existsSync(partsDir)
        ? readdirSync(partsDir).filter((f) => f.endsWith('.html')).map((f) => resolve(partsDir, f))
        : []
      const watched = [
        resolve(root, 'public/story.json'),
        resolve(root, 'public/characters.json'),
        resolve(root, 'templates/reader.html'),
        resolve(root, 'templates/title.html'),
        ...parts,
      ].map((p) => p.replace(/\\/g, '/'))
      for (const f of watched) server.watcher.add(f)
      server.watcher.on('change', (file) => {
        if (watched.includes(file.replace(/\\/g, '/'))) {
          generatePages(root)
          server.ws.send({ type: 'full-reload' })
        }
      })
    },
    // 目次・資料ページ（root 直下の静的ページ）の差し込みを展開する。'pre' で Vite が HTML を解析する前に行う
    // （断片の中の要素も通常の HTML として扱わせる）。生成ページは generatePages で展開済みなので素通りする。
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return expandIncludes(html, root)
      },
    },
  }
}

// 本体 CSS の <link> を前へ寄せるプラグイン（pages() と分けたのは transformIndexHtml を順序違いで 2 つ持つため）。
function cssFirst(): Plugin {
  return {
    name: 'lirmena-css-first',
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

// dev サーバでだけ、CSS が入るまで body を隠すプラグイン（FOUC 回避・dev 専用）。
// build の HTML は cssFirst() が CSS の <link> を script より前に置く＝render blocking で FOUC は起きない。
// dev の Vite は CSS を JS（モジュール）から <style> で差し込むので、HTML に <link> が無く、モジュールが動くまでの
// 一瞬に素の DOM が見える（スマホで devtunnel 越しに見ると特に長い）。そこで dev だけ head に「body を透明にする」
// <style> を足し、エントリのモジュールの後ろに置いた小さなモジュールで外す（モジュールは書いた順に動き、エントリが
// import した CSS はその本体より前に差し込まれる＝外すときには CSS が入っている）。スクリプトが落ちたときに
// 画面が真っ白のままにならないよう、CSS のアニメーションで 2.5 秒後には必ず見せる。本番の HTML には何も足さない。
function devFoucGuard(): Plugin {
  return {
    name: 'lirmena-dev-fouc-guard',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const style = '<style id="dev-fouc-guard">body{opacity:0;animation:dev-fouc-show 0s 2.5s forwards}@keyframes dev-fouc-show{to{opacity:1}}</style>'
        const release = '<script type="module">document.getElementById("dev-fouc-guard")?.remove()</script>'
        return html.replace('</head>', `${style}\n</head>`).replace('</body>', `${release}\n</body>`)
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
  // bgStub は制作用のスタブ背景（@@BG:stub=ラベル@@）を dev サーバでだけ返す。本体（src/）はこれを知らない
  // ＝結線はここだけ。仕様は src/bg-stub.ts 冒頭。
  plugins: [pages(__dirname), cssFirst(), bgStub(), devFoucGuard()],
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
