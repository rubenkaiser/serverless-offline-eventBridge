module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin', "json-format"],
  extends: [
    "eslint:recommended",
    "eslint-config-airbnb-base",
    "plugin:prettier/recommended",
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "import/extensions": 0,
    "import/no-unresolved": 0,
    "import/prefer-default-export": 0,
    'prettier/prettier': [
      'error',
      {
        'endOfLine': 'auto',
      }
    ]
  },
};
