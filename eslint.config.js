import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '_site/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
];
