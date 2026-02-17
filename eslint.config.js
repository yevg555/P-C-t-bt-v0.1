// @ts-check

const tseslint = require("typescript-eslint");
const eslint = require("@eslint/js");

module.exports = tseslint.config(
  // Global ignores
  {
    ignores: ["dist/", "node_modules/", "data/"],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript-ESLint recommended rules
  ...tseslint.configs.recommended,

  // Project-specific overrides for TypeScript files
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // Warn on unused vars, but allow underscore-prefixed args
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Warn (not error) on explicit any — the codebase uses some any
      "@typescript-eslint/no-explicit-any": "warn",

      // Enforce const for variables that are never reassigned
      "prefer-const": "error",

      // Allow console — this is a CLI bot
      "no-console": "off",
    },
  }
);
