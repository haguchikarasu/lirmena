// 依存グラフの許可リスト・循環禁止・orphan 検出。
// **本ファイルの allowed が依存グラフの真実源**。design/architecture.md は手書きの依存表を持たない
// （手書きは実装とずれるため廃止）。新しい依存を足すときはここを直す。
// 設計意図と、依存辺に現れない結線（コールバック注入・複製・story-integrity の呼び出し元）は
// design/architecture.md「依存グラフに現れない結線」が持つ。
// 検証：npm run depcruise。fail で GitHub Actions がビルドを停止する（.github/workflows/deploy.yml）。

const LEAF = '(transition|progress|parser|settings|loader|state|immersive|ruby|axis|device|bookmark|volumes|suppression|analytics)';

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
      comment: '他モジュールから参照されない孤立ファイルを禁止。エントリ（main/title/index）と型集約（types）は対象外',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)src/(main|title|index)\\.ts$',
          '(^|/)src/types\\.ts$',
          '(^|/)src/vite-env\\.d\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'index-src-isolation',
      severity: 'error',
      comment: 'index.ts は src/ 非依存（例外 bookmark・volumes のみ。stage 判定と栞スキーマ移行を二重管理しないための例外＝理由は design/modules/index.md「なぜ src/ から独立しているか」）',
      from: { path: '(^|/)src/index\\.ts$' },
      to: {
        path: '(^|/)src/',
        pathNot: [
          '(^|/)src/bookmark\\.ts$',
          '(^|/)src/volumes\\.ts$',
          '(^|/)src/types\\.ts$',
        ],
      },
    },
    {
      name: 'leaf-no-src-import',
      severity: 'error',
      comment: 'リーフ 14 モジュール（上の LEAF 定数が一覧）は src/ 内の他モジュールを import しない（types のみ許可）。リーフ集約設計を機械的に守るためのルール',
      from: { path: `(^|/)src/${LEAF}\\.ts$` },
      to: {
        path: '(^|/)src/',
        pathNot: [
          '(^|/)src/types\\.ts$',
        ],
      },
    },
  ],
  allowed: [
    { from: {}, to: { path: '(^|/)src/types\\.ts$' } },
    { from: { path: '(^|/)src/index\\.ts$' },    to: { path: '(^|/)src/(bookmark|volumes)\\.ts$' } },
    { from: { path: '(^|/)src/title\\.ts$' },    to: { path: '(^|/)src/(state|loader|bookmark|transition|ruby)\\.ts$' } },
    { from: { path: '(^|/)src/main\\.ts$' },     to: { path: '(^|/)src/(axis|device|state|renderer|bg|reader|nav|transition|menu|settings|tutorial|firstrun|opening|pan|immersive|bookmark|loader|parser|feedback|volumes|suppression|analytics)\\.ts$' } },
    { from: { path: '(^|/)src/nav\\.ts$' },      to: { path: '(^|/)src/(axis|state|bookmark|transition)\\.ts$' } },
    { from: { path: '(^|/)src/menu\\.ts$' },     to: { path: '(^|/)src/(axis|state|bookmark|settings|transition|tutorial|ruby)\\.ts$' } },
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
