// 汎用コード品質の機械化（規約 §3 のうち TS lint で拾える分）。
// 運用：公開ブロックしない（CI では continue-on-error）。赤アノテーションで気づけるが公開は止めない。
// 対象：src/*.ts（テストと生成物は除外）。tsconfig の exclude と合わせるため *.test.ts は lint 対象外。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'contents/',
      'templates/',
      'public/',
      'src/**/*.test.ts',
      'src/vite-env.d.ts',
      'vite.config.ts',
      'vitest.config.ts',
      'eslint.config.js',
      '.dependency-cruiser.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
