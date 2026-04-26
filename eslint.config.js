import vue from "eslint-plugin-vue";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import vueParser from "vue-eslint-parser";
import a11y from "eslint-plugin-vuejs-accessibility";

// Rules picked from typescript-eslint's "strict" preset that are SAFE
// without `parserOptions.project` (so we don't pay the cost of a full
// type-checker pass on every lint). The type-checked variants are skipped;
// they need a TS project, and our typecheck script already covers them.
const STRICTER_TS_RULES = {
  "@typescript-eslint/ban-ts-comment": "error",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-non-null-assertion": "warn",
  "@typescript-eslint/no-empty-object-type": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "@typescript-eslint/no-wrapper-object-types": "error",
  "@typescript-eslint/no-extraneous-class": "error",
  "@typescript-eslint/no-namespace": "error",
};

const GENERAL_STRICT_RULES = {
  eqeqeq: ["error", "always", { null: "ignore" }],
  "prefer-const": "error",
  "no-var": "error",
  "no-console": ["warn", { allow: ["warn", "error", "info"] }],
};

export default [
  {
    ignores: ["js/**", "web_dist/**", "node_modules/**", "dist/**", "coverage/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      ...STRICTER_TS_RULES,
      ...GENERAL_STRICT_RULES,
    },
  },
  {
    files: ["src/**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: { vue, "vuejs-accessibility": a11y, "@typescript-eslint": tsPlugin },
    rules: {
      ...vue.configs["vue3-recommended"].rules,
      ...a11y.configs.recommended.rules,
      ...STRICTER_TS_RULES,
      ...GENERAL_STRICT_RULES,
      // Single-word component names are fine for our generic shared components
      // (Logo, Toast); enforcing the multi-word rule would force renames with
      // no ergonomic benefit.
      "vue/multi-word-component-names": "off",
      // Our context menu / hero / drag handles are intentionally ARIA-light —
      // raise to "warn" so issues surface in CI but don't block development
      // until we audit each one individually.
      "vuejs-accessibility/click-events-have-key-events": "warn",
      "vuejs-accessibility/no-static-element-interactions": "warn",
      "vuejs-accessibility/anchor-has-content": "warn",
      // Wrap-style labels (`<label><input/></label>`) are accessible but the
      // rule prefers explicit `for=`. Downgrade to warn pending an audit.
      "vuejs-accessibility/label-has-for": "warn",
      "vuejs-accessibility/interactive-supports-focus": "warn",
      "vuejs-accessibility/mouse-events-have-key-events": "warn",
    },
  },
];
