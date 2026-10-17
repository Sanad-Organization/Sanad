// Root lint: CI runs `eslint .` here, not per package (bootstrap §7.1).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const hardcodedDesignValues = [
  {
    selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
    message: 'Use a token from @sanad/design-tokens, not a hex colour.',
  },
  {
    selector: 'Literal[value=/\\b(rgb|rgba|hsl|hsla|oklch|oklab)\\(/]',
    message: 'Use a token from @sanad/design-tokens.',
  },
  { selector: 'Literal[value=/\\b\\d+px\\b/]', message: 'Use a spacing/size token from @sanad/design-tokens.' },
  {
    selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b\\d+px\\b/]',
    message: 'Use a token from @sanad/design-tokens.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.venv/**',
      'services/**',
      'owner-only/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.ts', '**/*.tsx'] })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    ignores: ['packages/design-tokens/**'],
    rules: { 'no-restricted-syntax': ['error', ...hardcodedDesignValues] },
  },
);
