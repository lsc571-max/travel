import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'tests/e2e/out'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // 엔진은 외부 가변 저장소(useSyncExternalStore)이므로 React Compiler 전용 규칙은 적용하지 않음
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/e2e/**/*.cjs', 'public/sw.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.serviceworker }, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-empty': 'off', '@typescript-eslint/no-unused-vars': 'off' },
  },
);
