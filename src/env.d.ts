/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  // `Record<string, never>` instead of `{}` — same intent (no defined props
  // to constrain the SFC default-export typing) but doesn't trip
  // typescript-eslint's no-empty-object-type rule.
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

// Side-effect CSS imports (cssInjectedByJsPlugin handles runtime injection).
declare module "*.css";

// Runtime-served ComfyUI core modules — not on disk in node_modules,
// the live process serves them at these absolute paths. Declared here
// so dynamic `import()` calls type-check; the actual shape is asserted
// by the caller (see extension/topbar.ts).
declare module "/scripts/ui/components/button.js";
declare module "/scripts/ui/components/buttonGroup.js";

// Build-time constants. `vite.config.mts` injects these via
// `define: { __APP_VERSION__: ... }` so AppTopbar.vue + the release
// check composable can read the current package.json version without
// importing the JSON file (which would pull the whole manifest into
// the bundle).
declare const __APP_VERSION__: string;
