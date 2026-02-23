const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

const sharedLimits = {
  'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
  complexity: ['error', { max: 12 }]
};

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/build/**',
      '**/out/**',
      '**/.git/**'
    ]
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script'
    },
    rules: {
      ...sharedLimits
    }
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...sharedLimits,
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeAnnotation > TSTypeLiteral',
          message: 'Use a named type or interface instead of an inline object type.'
        },
        {
          selector: 'TSTypeParameterInstantiation > TSTypeLiteral',
          message: 'Use a named type or interface instead of an inline object type.'
        }
      ]
    }
  }
];
