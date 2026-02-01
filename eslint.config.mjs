// eslint.config.js
import js from "@eslint/js";
import pluginImport from "eslint-plugin-import";
import eslintConfigPrettier from "eslint-config-prettier";

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: [
      "**/dist/**", // Angular build output
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.angular/**",
      "src/public/assets/**", // Bundled client assets
      "client/dbfuse-ai-client/dist/**",
    ],
  },
  { files: ["**/*.{js,mjs,cjs}"] },
  js.configs.recommended,
  {
    plugins: { import: pluginImport },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "import/order": [
        "warn",
        {
          "newlines-between": "always",
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        },
      ],
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        exports: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
  },
  {
    files: ["eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  // Turn off rules that conflict with Prettier
  eslintConfigPrettier,
];
