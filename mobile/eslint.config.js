// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const prettier = require('eslint-plugin-prettier/recommended')

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: ['node_modules/*', '.expo/*', 'ios/*', 'android/*', 'expo-env.d.ts'],
  },
  {
    rules: {
      // Nothing that could hold a token, a push body or message text may reach the log (Phase 8, hard rule 4).
      'no-console': 'error',
    },
  },
])
