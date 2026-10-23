import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/unpackage/**', '**/static/**'] },
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
      globals: {
        ...globals.browser,
        uni: 'readonly',
        plus: 'readonly',
        getCurrentPages: 'readonly',
        getApp: 'readonly',
      },
    },
    plugins: { sonarjs },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 4],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'sonarjs/cognitive-complexity': ['warn', 15],
      'sonarjs/no-identical-functions': 'warn',
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]
