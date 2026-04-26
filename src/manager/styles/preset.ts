import { definePreset } from "@primevue/themes";
import Aura from "@primevue/themes/aura";

/** Aura derivative driven by the `--wp-*` palette so PrimeVue components
 * (Button, DataTable, Tag, Toast) render with project colors out of the box. */
export const WildcardPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "#eef0ff",
      100: "#e0e2ff",
      200: "#c7caff",
      300: "#a5a9fc",
      400: "#8589f5",
      500: "#6366f1",
      600: "#4f51d8",
      700: "#4143b3",
      800: "#383a8e",
      900: "#323471",
      950: "#1f1f47",
    },
    colorScheme: {
      dark: {
        surface: {
          0: "#ffffff",
          50: "#f4f4f4",
          100: "#dddddd",
          200: "#aaaaaa",
          300: "#888888",
          400: "#666666",
          500: "#4a4a4a",
          600: "#3a3a3a",
          700: "#2a2a2a",
          800: "#232323",
          900: "#1e1e1e",
          950: "#161616",
        },
      },
    },
  },
});
