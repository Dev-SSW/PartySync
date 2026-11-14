import js from '@eslint/js'
import ts from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default ts.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  { files: ['eslint.config.js'], languageOptions: { globals: globals.node } },
)
