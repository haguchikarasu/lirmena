import { defineConfig } from 'vitest/config'

// ユニットテスト用設定（本番ビルドの vite.config.ts とは分離）。
// 対象は localStorage / DOM に依存するロジック層のため environment は jsdom。
// テストは esbuild でトランスパイルされるのみで型チェックはしない（型は tsc / IFコメントが担保）。
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
