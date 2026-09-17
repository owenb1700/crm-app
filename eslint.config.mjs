import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

// The point of this config is one rule: no-undef. A typo or a component
// wired up without the data it needs (users={users} with no `users` in
// scope) compiles fine and only blows up in the browser when someone opens
// the page. `npm run lint` catches it before a deploy does.
export default [
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    ignores: [".next/**", "node_modules/**", "out/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: { "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "error",
      "react-hooks/rules-of-hooks": "error",
      // Noise we don't want failing a lint run: these are style, not bugs.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": "off",
      "no-useless-escape": "off",
      // Deliberate: the PDF and spreadsheet writers strip control
      // characters and match combined glyphs on purpose.
      "no-control-regex": "off",
      "no-irregular-whitespace": "off",
      "no-misleading-character-class": "off"
    }
  }
];
