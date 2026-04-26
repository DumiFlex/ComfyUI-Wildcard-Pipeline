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
