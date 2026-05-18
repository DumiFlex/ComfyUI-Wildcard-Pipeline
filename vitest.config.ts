import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "./src") },
      { find: "vue", replacement: "vue/dist/vue.runtime.esm-bundler.js" },
      // Mock ComfyUI runtime APIs for widget tests.
      { find: "#comfyui/app", replacement: resolve(__dirname, "./src/test-setup.ts") },
      // Stub absolute public-asset paths that don't exist under jsdom tests.
      { find: /^\/wp\/images\/.*\.svg$/, replacement: resolve(__dirname, "./src/manager/__tests__/stubs/asset.svg") },
    ],
  },
  assetsInclude: ["**/*.svg"],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      // V8 coverage works against the Vite test pipeline without a separate
      // transform — the runtime emits coverage data the reporter reads.
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // Coverage scope: testable surface only. Files mounted against
      // ComfyUI runtime APIs (window.LGraphBadge, app.extensionManager,
      // app.graph, addDOMWidget, matchMedia listeners, Vue Teleport) can't
      // be unit-tested under jsdom because those APIs don't exist there —
      // they'd need integration tests against a live ComfyUI instance,
      // which is its own batch. Excluding them keeps thresholds anchored
      // to genuinely testable logic (scanners, traversal, helpers, SFCs).
      include: ["src/**/*.{ts,vue}"],
      exclude: [
        "src/**/*.test.ts",
        "src/test-setup.ts",
        "src/typings/**",
        // Entry glue + manager stub — top-level await, app singleton.
        "src/main.ts",
        "src/manager.ts",
        // Widget mount glue — calls createDomWidgetHost which needs
        // node.addDOMWidget at runtime.
        "src/widgets/context.ts",
        "src/widgets/debug.ts",
        "src/widgets/assembler.ts",
        // Extension hooks tied to ComfyUI globals + DOM events.
        "src/extension/about-badges.ts",
        "src/extension/fonts.ts",
        "src/extension/graph-events.ts",
        "src/extension/reactive.ts",
        "src/extension/settings.ts",
        "src/extension/subgraph-badge.ts",
        // Toast singleton uses Teleport + ResizeObserver + canvas rect.
        "src/components/shared/Toast.vue",
      ],
      // Anchored to the measured baseline of the testable surface.
      // Tighten alongside new tests; loosen only with explicit PR
      // justification. Functions stays low because every Vue SFC has
      // helper functions only invoked under specific user-interaction
      // paths the existing tests don't cover yet.
      thresholds: {
        lines: 60,
        functions: 40,
        branches: 65,
        statements: 60,
      },
    },
  },
});
