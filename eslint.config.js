import vue from "eslint-plugin-vue";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import vueParser from "vue-eslint-parser";
import a11y from "eslint-plugin-vuejs-accessibility";
import { readFileSync } from "node:fs";

// The ratchet: these rules are errors everywhere except the files listed in
// eslint-baseline.json, which still break them (scripts/lint-baseline.mjs
// writes it; only ever shrink it).
const BASELINE = JSON.parse(readFileSync(new URL("./eslint-baseline.json", import.meta.url), "utf8"));
const ratchet = process.env.WP_LINT_BASELINE === "off" ? [] : BASELINE.RATCHET.map((rule) => ({
  files: rule.startsWith("vuejs-accessibility/") ? ["src/**/*.vue"] : ["src/**/*.ts", "src/**/*.vue"],
  ignores: BASELINE.files[rule] ?? [],
  rules: { [rule]: rule.endsWith("label-has-for")
    ? ["error", { required: { some: ["nesting", "id"] } }]
    : "error" },
}));

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
    // Makes `<!-- eslint-disable-next-line … -->` in templates work.
    processor: vue.processors[".vue"],
    rules: {
      ...vue.configs["vue3-recommended"].rules,
      "vue/comment-directive": "error",
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
      "vuejs-accessibility/anchor-has-content": "error",
      // A label may wrap its control (`<label><input/></label>`) or point at
      // it with `for=`; both are accessible.
      "vuejs-accessibility/label-has-for": ["warn", { required: { some: ["nesting", "id"] } }],
      "vuejs-accessibility/interactive-supports-focus": "warn",
      "vuejs-accessibility/mouse-events-have-key-events": "warn",
    },
  },
  ...ratchet,
];
