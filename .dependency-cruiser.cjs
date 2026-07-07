// 依存グラフの許可リスト・循環禁止・orphan 検出。
// 許可リストは module-matrix.md と同期する（matrix を更新したら本ファイルも同じ単位で更新）。
// 検証：npm run depcruise。fail で GitHub Actions がビルドを停止する（.github/workflows/deploy.yml）。

const LEAF = '(transition|progress|parser|settings|loader|state|immersive|ruby|axis|device|bookmark|volumes)';

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
      comment: 'index.ts は src/ 非依存（例外 bookmark のみ・module-matrix.md L50）',
      from: { path: '(^|/)src/index\\.ts$' },
      to: {
        path: '(^|/)src/',
        pathNot: [
          '(^|/)src/bookmark\\.ts$',
          '(^|/)src/types\\.ts$',
        ],
      },
    },
    {
      name: 'leaf-no-src-import',
      severity: 'error',
      comment: 'リーフ 12 モジュールは src/ 内の他モジュールを import しない（types のみ許可・module-matrix.md L44）',
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
    { from: { path: '(^|/)src/index\\.ts$' },    to: { path: '(^|/)src/bookmark\\.ts$' } },
    { from: { path: '(^|/)src/title\\.ts$' },    to: { path: '(^|/)src/(state|loader|bookmark|transition|ruby)\\.ts$' } },
    { from: { path: '(^|/)src/main\\.ts$' },     to: { path: '(^|/)src/(axis|device|state|renderer|bg|reader|nav|transition|menu|settings|tutorial|opening|pan|immersive|bookmark|loader|parser|feedback|volumes)\\.ts$' } },
    { from: { path: '(^|/)src/nav\\.ts$' },      to: { path: '(^|/)src/(axis|state|bookmark|transition)\\.ts$' } },
    { from: { path: '(^|/)src/menu\\.ts$' },     to: { path: '(^|/)src/(axis|state|bookmark|settings|transition|tutorial|ruby)\\.ts$' } },
    { from: { path: '(^|/)src/reader\\.ts$' },   to: { path: '(^|/)src/(state|progress|opening|bookmark)\\.ts$' } },
    { from: { path: '(^|/)src/opening\\.ts$' },  to: { path: '(^|/)src/(axis|state|nav)\\.ts$' } },
    { from: { path: '(^|/)src/renderer\\.ts$' }, to: { path: '(^|/)src/parser\\.ts$' } },
    { from: { path: '(^|/)src/tutorial\\.ts$' }, to: { path: '(^|/)src/(axis|settings)\\.ts$' } },
    { from: { path: '(^|/)src/bg\\.ts$' },       to: { path: '(^|/)src/axis\\.ts$' } },
    { from: { path: '(^|/)src/pan\\.ts$' },      to: { path: '(^|/)src/axis\\.ts$' } },
    { from: { path: '(^|/)src/feedback\\.ts$' }, to: { path: '(^|/)src/state\\.ts$' } },
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
