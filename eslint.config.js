import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'playwright-report/', 'test-results/', 'data/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    // Browser code, and e2e specs (page.evaluate callbacks run in the browser).
    files: ['public/js/**/*.js', 'test/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
