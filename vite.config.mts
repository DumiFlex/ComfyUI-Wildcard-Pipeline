import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
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
      build: {
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
          },
        },
        minify: "esbuild",
        sourcemap: "hidden",
        cssCodeSplit: true,
        reportCompressedSize: true,
        emptyOutDir: true,
      },
      test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
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
