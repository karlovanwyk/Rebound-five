// eslint.config.js: ESLint "flat config".
//
// Besides the usual recommended rules, this file enforces the project's most important
// architecture rule: code under src/sim must stay headless and deterministic. It may not
// touch the DOM, read the clock, call Math.random() or import from render/, ui/ or audio/.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default defineConfig([
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['tests/**/*.ts', 'eslint.config.js', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // The simulation must run identically in the browser and in Node (tests).
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/sim is headless: no DOM access.' },
        { name: 'document', message: 'src/sim is headless: no DOM access.' },
        { name: 'localStorage', message: 'src/sim is headless: no storage.' },
        { name: 'navigator', message: 'src/sim is headless: no browser APIs.' },
        { name: 'performance', message: 'src/sim must not read the clock. Use the tick counter.' },
        { name: 'requestAnimationFrame', message: 'The loop lives in core/Loop.ts.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use SeededRandom so matches replay exactly.',
        },
        { object: 'Date', property: 'now', message: 'src/sim must not read the clock.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/render/**', '**/ui/**', '**/audio/**'],
              message: 'src/sim must not depend on presentation code.',
            },
          ],
          paths: [
            {
              name: 'three',
              importNames: ['Scene', 'Mesh', 'Object3D', 'Group', 'WebGLRenderer', 'Camera'],
              message: 'Only Three.js math classes are allowed in src/sim.',
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
