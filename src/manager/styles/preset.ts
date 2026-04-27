import { definePreset } from "@primevue/themes";
import Aura from "@primevue/themes/aura";

/** Aura derivative driven by the SPA `--wp-*` token vocabulary so PrimeVue
 * components (Button, DataTable, Tag, Toast) render with project colors
 * out of the box.
 *
 * The `primary` palette mirrors the prototype's violet accent scale (see
 * src/manager/styles/tokens.css). 950 is extrapolated as accent-900 mixed
 * ~30% with #000 (no 950 stop is defined in the prototype).
 *
 * Surface colors point at `--wp-bg*` so flipping the theme tokens at runtime
 * also flips the PrimeVue surface scope.
 */
export const WildcardPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50:  "#f5f3ff",
      100: "#ede9fe",
      200: "#ddd6fe",
      300: "#c4b5fd",
      400: "#a78bfa",
      500: "#8b5cf6",
      600: "#7c3aed",
      700: "#6d28d9",
      800: "#5b21b6",
      900: "#4c1d95",
      950: "#3b1480",
    },
    colorScheme: {
      dark: {
        surface: {
          0:   "var(--wp-text)",
          50:  "var(--wp-bg-4)",
          100: "var(--wp-bg-4)",
          200: "var(--wp-text-dim)",
          300: "var(--wp-text-muted)",
          400: "var(--wp-text-muted)",
          500: "var(--wp-text-muted)",
          600: "var(--wp-border-strong)",
          700: "var(--wp-bg-4)",
          800: "var(--wp-bg-3)",
          900: "var(--wp-bg-2)",
          950: "var(--wp-bg-1)",
        },
      },
    },
  },
});
