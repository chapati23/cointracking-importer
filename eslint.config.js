import eslint from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  unicorn.configs["flat/recommended"],
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/restrict-template-expressions": "off",

      // Unicorn - adjust overly strict rules
      "unicorn/prevent-abbreviations": "off", // Allow common abbrevs like "config", "dir", "tx"
      "unicorn/no-null": "off", // null is fine in this codebase
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "unicorn/no-process-exit": "off", // CLI app needs process.exit
      "unicorn/no-array-callback-reference": "off", // .map(parseRow) is fine
      "unicorn/prefer-top-level-await": "off", // main().catch() pattern is fine for CLI
      "unicorn/switch-case-braces": "off", // Not needed for simple cases
      "unicorn/no-negated-condition": "off", // Sometimes clearer to negate
      "unicorn/consistent-function-scoping": "warn", // Warn only, sometimes functions need closure
      "unicorn/no-array-sort": "off", // Mutating sort is fine when intentional

      // SonarJS
      "sonarjs/cognitive-complexity": ["warn", 15],
      "sonarjs/no-nested-template-literals": "off", // Template literals are fine
      "sonarjs/no-alphabetical-sort": "off", // We use proper compare functions
      "sonarjs/prefer-regexp-exec": "off", // .match() is more readable for simple cases
    },
  },
  // Test file overrides - more permissive
  {
    files: ["test/**/*.ts"],
    rules: {
      "sonarjs/os-command": "off", // Tests need to run CLI commands
      "sonarjs/assertions-in-tests": "off", // Some tests verify no throw
      "unicorn/no-immediate-mutation": "off", // new Map().set() is fine in tests
      "unicorn/numeric-separators-style": "off", // Test values don't need separators
      "unicorn/no-useless-undefined": "off", // Explicit undefined in tests is clearer
    },
  },
  {
    ignores: ["node_modules/**", "dist/**", "data/**", "eslint.config.js"],
  }
);
