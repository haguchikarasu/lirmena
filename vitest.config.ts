import { defineConfig } from 'vitest/config'

// ユニットテスト用設定（本番ビルドの vite.config.ts とは分離）。
// 対象は localStorage / DOM に依存するロジック層のため environment は jsdom。
// テストは esbuild でトランスパイルされるのみで型チェックはしない（型は tsc / IFコメントが担保）。
// カバレッジは UI/エントリ層（main/reader/nav/menu/title/index/opening/tutorial/transition/renderer/loader/bg）を除外し
// ロジック層のみを可視化する。閾値ゲートは baseline 測定後に判断（初回は可視化のみ・非ブロッキング）。
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/vite-env.d.ts',
        'src/types.ts',
        'src/main.ts',
        'src/reader.ts',
        'src/nav.ts',
        'src/menu.ts',
        'src/title.ts',
        'src/index.ts',
        'src/opening.ts',
        'src/tutorial.ts',
        'src/transition.ts',
        'src/renderer.ts',
        'src/loader.ts',
        'src/bg.ts',
      ],
    },
  },
})
