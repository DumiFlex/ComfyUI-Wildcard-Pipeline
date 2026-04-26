import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { resolve } from "node:path";

// Two build targets controlled by --mode flag:
//   pnpm build:extension → js/main.js  (ComfyUI web extension, critical-path bundle)
//   pnpm build:manager   → web_dist/   (standalone SPA, post-MVP)

export default defineConfig(({ mode }) => {
  const isExtension = mode === "extension" || mode === "development";

  const common = {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
        vue: "vue/dist/vue.runtime.esm-bundler.js",
      },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  };

  if (isExtension) {
    return {
      ...common,
      // cssInjectedByJsPlugin with relativeCSSInjection inlines each chunk's
      // CSS into that chunk's JS so dynamic imports auto-inject styles at
      // runtime. Vite library mode emits CSS files but never <link>s them, and
      // ComfyUI loads main.js as a bare ES module — no auto-loading. See
      // CLAUDE.md "Frontend overview" for the why. Entry chunk stays CSS-free
      // because all our styles live in lazy widget chunks.
      plugins: [vue(), cssInjectedByJsPlugin({ relativeCSSInjection: true })],
      build: {
        // ES2022 needed for top-level `await` in main.ts (preloads widget chunks
        // before registerExtension so getCustomWidgets factories can run sync).
        target: "es2022",
        lib: {
          entry: resolve(__dirname, "src/main.ts"),
          formats: ["es"] as const,
          fileName: "main",
        },
        rollupOptions: {
          external: ["#comfyui/app"],
          output: {
            dir: "js",
            entryFileNames: "main.js",
            chunkFileNames: "assets/[name]-[hash].js",
            assetFileNames: "assets/[name]-[hash][extname]",
            // Rewrite the alias to ComfyUI's runtime URL so the browser can
            // resolve it. ComfyUI serves /scripts/app.js as the live app.
            paths: { "#comfyui/app": "/scripts/app.js" },
          },
        },
        minify: "esbuild",
        sourcemap: "hidden",
        cssCodeSplit: true,
        reportCompressedSize: true,
        emptyOutDir: true,
      },
      test: {
        environment: "jsdom",
        globals: true,
        include: ["src/**/*.test.ts"],
        setupFiles: ["./src/test-setup.ts"],
      },
    };
  }

  // Manager SPA — post-MVP, built as empty stub
  return {
    ...common,
    base: "/wildcard-pipeline/",
    build: {
      outDir: "web_dist",
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, "src/manager.html"),
      },
    },
  };
});
