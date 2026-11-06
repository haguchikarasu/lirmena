// 依存グラフの許可リスト・循環禁止・orphan 検出。
// **本ファイルの allowed が依存グラフの真実源**。design/architecture.md は手書きの依存表を持たない
// （手書きは実装とずれるため廃止）。新しい依存を足すときはここを直す。
// 設計意図と、依存辺に現れない結線（コールバック注入・複製・story-integrity の呼び出し元）は
// design/architecture.md「依存グラフに現れない結線」が持つ。
// 検証：npm run depcruise。fail で GitHub Actions がビルドを停止する（.github/workflows/deploy.yml）。
//
// ── 4 つの層（design/architecture.md「コードの層」）──────────────────────────
//   core   … データと規則。document・要素に触らない（localStorage は可）。core の外を import しない
//   ui     … どのページにも置ける部品。core と ui だけを import する（reader を読まない）
//   reader … 本文ページの読書の仕組み（#main-container とスクロールが前提）。下の 2 層の残り全部
//   入口   … ページごとのエントリ。目次（index）と資料ページ（world-page・glossary-page）は reader を読まない
// 層はまずファイルの一覧（下の正規表現）で表す。フォルダ分けは新しく作るものだけ（src/core/・src/ui/）で、
// 既存の部品は場所を変えていない。parser・renderer・bg-stub・story-integrity は src/ の外からパスで読まれるので動かさない。
// 下の forbidden が層の向きを止め、allowed が個々の辺を許す（allowed に無い辺も allowedSeverity: 'error' で止まる）。

const LEAF = '(transition|progress|parser|loader|state|immersive|ruby|axis|device|bookmark|volumes|analytics|map|glossary)';
// core 層：types と volumes（stage の算出＝純関数）と src/core/ の全部。
const CORE = '(^|/)src/((types|volumes)\\.ts|core/[^/]+\\.ts)$';
// ui 層：src/ui/ の全部と、どのページにも置ける既存の部品。
const UI = '(^|/)src/((ruby|characters|map|glossary|transition)\\.ts|ui/[^/]+\\.ts)$';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循環依存禁止（リーフ集約設計を守る）',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: '他モジュールから参照されない孤立ファイルを禁止。エントリ（main/title/index/world-page/glossary-page）と型集約（types）と、呼び出し元が vite.config.ts だけの bg-stub は対象外',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)src/(main|title|index|world-page|glossary-page)\\.ts$',
          '(^|/)src/types\\.ts$',
          '(^|/)src/vite-env\\.d\\.ts$',
          '(^|/)src/bg-stub\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'bg-stub-isolation',
      severity: 'error',
      comment: '本体は制作用のスタブ背景（bg-stub）に依存しない。src/ のどのモジュールも bg-stub を import してはならない（結線は vite.config.ts の plugins だけ。理由は src/bg-stub.ts 冒頭）',
      from: { pathNot: '(^|/)src/bg-stub\\.ts$' },
      to: { path: '(^|/)src/bg-stub\\.ts$' },
    },
    {
      name: 'core-isolation',
      severity: 'error',
      comment: 'core 層は core の外（ui・reader・入口）を import しない。core は document・要素に触らない層で、その確認は core の単体テストを DOM の無い環境（node）で回すことで行う（src/core/*.test.ts の @vitest-environment node）',
      from: { path: CORE },
      to: { path: '(^|/)src/', pathNot: CORE },
    },
    {
      name: 'ui-no-reader',
      severity: 'error',
      comment: 'ui 層は core と ui だけを import する（reader・入口を読まない）。部品が本文の読書の仕組みに依存すると、目次や資料ページに置けなくなる',
      from: { path: UI },
      to: { path: '(^|/)src/', pathNot: [CORE, UI] },
    },
    {
      name: 'toc-no-reader',
      severity: 'error',
      comment: '目次（index.ts）と資料ページ（world-page.ts・glossary-page.ts）は core と ui だけを import する（reader を読まない）。守りたいのは「読書の仕組みの変更が目次を壊さない」こと（以前の index-src-isolation＝src/ 全体からの独立を、壊れる場所＝reader 層との境界へ引き直した。design/modules/index.md）',
      from: { path: '(^|/)src/(index|world-page|glossary-page)\\.ts$' },
      to: { path: '(^|/)src/', pathNot: [CORE, UI] },
    },
    {
      name: 'leaf-no-src-import',
      severity: 'error',
      comment: 'リーフ 15 モジュール（上の LEAF 定数が一覧）は src/ 内の他モジュールを import しない（types と core 層のみ許可）。リーフ集約設計を機械的に守るためのルール',
      from: { path: `(^|/)src/${LEAF}\\.ts$` },
      to: {
        path: '(^|/)src/',
        pathNot: [
          '(^|/)src/types\\.ts$',
          '(^|/)src/core/[^/]+\\.ts$',
        ],
      },
    },
  ],
  allowed: [
    { from: {}, to: { path: '(^|/)src/types\\.ts$' } },
    // 目次は core（storage・record-hold・settings-model・query・preview・changelog・theme・schedule）と ui（settings-panel・share・
    // confirm・ruby）を読む。資料（人物・地図・用語）は目次からはページへ移るだけなので、資料シートも描画の部品も読まない。
    { from: { path: '(^|/)src/index\\.ts$' },    to: { path: '(^|/)src/((volumes|ruby)\\.ts|core/(storage|record-hold|settings-model|query|preview|changelog|theme|schedule)\\.ts|ui/(settings-panel|share|confirm)\\.ts)$' } },
    // core の中の辺は無い（各モジュールが types だけを読む）。ui の部品は core の値の規則を読む。
    // シートを使う ui（設定・共有・資料）は器の ui/sheet を読む。設定は消す・戻す前の確認（ui/confirm）も読む。
    { from: { path: '(^|/)src/ui/settings-panel\\.ts$' }, to: { path: '(^|/)src/(core/settings-model|ui/sheet|ui/confirm)\\.ts$' } },
    { from: { path: '(^|/)src/ui/share\\.ts$' }, to: { path: '(^|/)src/ui/sheet\\.ts$' } },
    // 資料シートは器（ui/sheet）と中身の部品（人物・地図・用語）を読む。volumes は StoryStage の型だけ。
    // core/query は「ページで開く」の href に ?dev を引き継ぐため。
    { from: { path: '(^|/)src/ui/world-sheet\\.ts$' }, to: { path: '(^|/)src/((characters|map|glossary|volumes)\\.ts|ui/sheet\\.ts|core/query\\.ts)$' } },
    // 本文側の窓口：bookmark は core/storage を丸ごと再 export する（history.state だけを自分で持つ）。
    { from: { path: '(^|/)src/bookmark\\.ts$' }, to: { path: '(^|/)src/core/storage\\.ts$' } },
    { from: { path: '(^|/)src/state\\.ts$' },    to: { path: '(^|/)src/core/query\\.ts$' } },
    // settings（本文への反映）は値の規則（core）とパネルの結線（ui）を読む。
    { from: { path: '(^|/)src/settings\\.ts$' }, to: { path: '(^|/)src/(core/settings-model|ui/settings-panel)\\.ts$' } },
    // characters → volumes は StoryStage の型だけ（tsPreCompilationDeps で型 import も辺に数える）。
    // characters → core/chara は人物の画像の置き場所と顔の画像名の規約（ビルド時の実在検査と共有）。
    { from: { path: '(^|/)src/characters\\.ts$' }, to: { path: '(^|/)src/((ruby|volumes)\\.ts|core/chara\\.ts)$' } },
    { from: { path: '(^|/)src/title\\.ts$' },    to: { path: '(^|/)src/((state|loader|bookmark|transition|ruby)\\.ts|core/(changelog|record-hold)\\.ts)$' } },
    { from: { path: '(^|/)src/main\\.ts$' },     to: { path: '(^|/)src/(axis|device|state|renderer|bg|reader|nav|transition|menu|settings|tutorial|firstrun|opening|pan|immersive|bookmark|loader|parser|feedback|volumes|suppression|analytics|core/record-hold|ui/hold-badge)\\.ts$' } },
    // 最前線の判定は stage と同じ順序を使う（「続きから読む」の地点と最大読破の次）。
    { from: { path: '(^|/)src/suppression\\.ts$' }, to: { path: '(^|/)src/volumes\\.ts$' } },
    // 札の説明はシートで開く。
    { from: { path: '(^|/)src/ui/hold-badge\\.ts$' }, to: { path: '(^|/)src/ui/sheet\\.ts$' } },
    { from: { path: '(^|/)src/nav\\.ts$' },      to: { path: '(^|/)src/(axis|state|bookmark|transition)\\.ts$' } },
    // menu は資料シート（ui/world-sheet）・共有（ui/share）・栞シートの器（ui/sheet）を読む。人物・地図・用語の部品は world-sheet 経由。
    { from: { path: '(^|/)src/menu\\.ts$' },     to: { path: '(^|/)src/((axis|state|bookmark|settings|transition|tutorial|volumes)\\.ts|ui/(share|sheet|world-sheet)\\.ts)$' } },
    // 資料ページのエントリ。用語集ページは glossary と上の帯（ui/world-nav）だけを読む。人物・地図のページは部品と、
    // 人物の Stage を出すための volumes（computeStoryStage）・core/storage（既読）を読む。本文側の依存を持ち込まない
    // （allowed に無い辺は allowedSeverity: 'error' で止まる＝この 2 行が隔離の実体。層の向きは toc-no-reader も見る）
    { from: { path: '(^|/)src/glossary-page\\.ts$' }, to: { path: '(^|/)src/(glossary|ui/world-nav)\\.ts$' } },
    { from: { path: '(^|/)src/world-page\\.ts$' }, to: { path: '(^|/)src/((characters|map|volumes)\\.ts|core/storage\\.ts|ui/world-nav\\.ts)$' } },
    // 上の帯は遷移先にクエリ（?dev）を引き継ぐ。
    { from: { path: '(^|/)src/ui/world-nav\\.ts$' }, to: { path: '(^|/)src/core/query\\.ts$' } },
    { from: { path: '(^|/)src/reader\\.ts$' },   to: { path: '(^|/)src/(state|progress|opening|bookmark)\\.ts$' } },
    { from: { path: '(^|/)src/opening\\.ts$' },  to: { path: '(^|/)src/(axis|state|nav)\\.ts$' } },
    { from: { path: '(^|/)src/renderer\\.ts$' }, to: { path: '(^|/)src/parser\\.ts$' } },
    { from: { path: '(^|/)src/tutorial\\.ts$' }, to: { path: '(^|/)src/(axis|settings)\\.ts$' } },
    // firstrun → settings はプリセット定義・適用・既定判定の所有者を読むための 1 本（tutorial → settings と同型）。
    // firstrun は tutorial を import しない：閉じた後に何を出すかは main.ts が onDone 注入で決める。
    { from: { path: '(^|/)src/firstrun\\.ts$' }, to: { path: '(^|/)src/settings\\.ts$' } },
    { from: { path: '(^|/)src/bg\\.ts$' },       to: { path: '(^|/)src/axis\\.ts$' } },
    { from: { path: '(^|/)src/pan\\.ts$' },      to: { path: '(^|/)src/axis\\.ts$' } },
    { from: { path: '(^|/)src/feedback\\.ts$' }, to: { path: '(^|/)src/state\\.ts$' } },
    // story-integrity → volumes は stage 上限 MAX_STORY_STAGE の二重管理を避けるための 1 本（検査 (m)）。
    // story-integrity は vite.config.ts からしか呼ばれずランタイムバンドルに入らない＝実行時の依存は増えない。
    { from: { path: '(^|/)src/story-integrity\\.ts$' }, to: { path: '(^|/)src/volumes\\.ts$' } },
    // story-integrity → core/theme は巻の素材の規約（置き場所とファイル名）を二重管理しないための 1 本（検査 (q)）。
    // story-integrity → core/preview は「予告が実効的に有効か」を目次と同じ関数で判定するための 1 本（(e)(k)(k')(l)）。
    // story-integrity → core/chara は人物の画像の規約を二重管理しないための 1 本（(o) の画像の実在検査）。
    { from: { path: '(^|/)src/story-integrity\\.ts$' }, to: { path: '(^|/)src/core/(theme|preview|chara)\\.ts$' } },
  ],
  allowedSeverity: 'error',
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^src/',
    exclude: { path: '(vite-env\\.d\\.ts$|\\.test\\.ts$|\\.css$)' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
