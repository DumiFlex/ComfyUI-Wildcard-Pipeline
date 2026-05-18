import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { resolve } from "node:path";
import { copyFileSync, existsSync, rmSync } from "node:fs";

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
    // PostCSS config moved to `config/postcss.config.js` — Vite no
    // longer auto-discovers it from the project root, so point at it
    // explicitly. Tailwind's own config path is referenced from
    // inside that file.
    css: {
      postcss: resolve(__dirname, "config/postcss.config.js"),
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

  // Manager SPA — Vue 3 + PrimeVue + Tailwind, served by aiohttp at /wp/
  // The inline plugin renames the emitted HTML → web/index.html so aiohttp's
  // SPA fallback (which serves web/index.html) picks it up correctly.
  // Vite ≥5.4 emits the HTML directly to web/manager.html (basename only);
  // older versions used web/src/manager.html (full relative path). Handle both.
  // If Vite already emitted to web/index.html (future-proof), skip the copy.
  // PrimeIcons ships @font-face declarations for eot/ttf/woff/svg/woff2.
  // Every modern browser ComfyUI supports loads only the woff2; the rest
  // are dead weight (~600 KB combined, including a 342 KB SVG sprite).
  // Strip them at transform time so Vite never emits the asset files.
  const stripLegacyIconFonts = {
    name: "strip-primeicons-legacy-fonts",
    enforce: "pre" as const,
    transform(code: string, id: string): string | undefined {
      // Strip the legacy @font-face src list down to just woff2. Vite's CSS
      // asset resolver runs after the `transform` hook, so the eot/ttf/woff/
      // svg url() references never make it into the dependency graph and
      // Vite never emits those font assets. ~600 KB saved per build.
      if (!id.includes("primeicons") || !id.endsWith(".css")) return undefined;
      return code.replace(
        /src:\s*url\([^)]*\.eot[^)]*\);\s*src:[\s\S]*?;/,
        "src: url('./fonts/primeicons.woff2') format('woff2');",
      );
    },
  };

  const renameManagerHtml = {
    name: "rename-manager-html",
    closeBundle() {
      const dest = resolve(__dirname, "web/index.html");
      const candidates = [
        resolve(__dirname, "web/manager.html"),
        resolve(__dirname, "web/src/manager.html"),
      ];
      for (const src of candidates) {
        if (existsSync(src)) {
          copyFileSync(src, dest);
          rmSync(resolve(__dirname, src.endsWith("src/manager.html") ? "web/src" : src), {
            recursive: true,
            force: true,
          });
          return;
        }
      }
      // Vite already wrote web/index.html directly — nothing to do.
    },
  };

  return {
    ...common,
    base: "/wp/",
    plugins: [...(common.plugins as []), stripLegacyIconFonts, renameManagerHtml],
    build: {
      outDir: "web",
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, "src/manager.html"),
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.ts", "src/manager/**/*.test.ts"],
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
