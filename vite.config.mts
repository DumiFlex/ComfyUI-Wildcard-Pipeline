import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { resolve } from "path";

// Two build targets controlled by --mode flag:
//   npm run build:extension  → js/main.js   (ComfyUI web extension)
//   npm run build:manager    → web_dist/    (standalone SPA at /wp)

export default defineConfig(({ mode }) => {
  const isExtension = mode === "extension" || mode === "development";

  if (isExtension) {
    return {
      plugins: [
        vue(),
        cssInjectedByJsPlugin(), // Inject CSS into JS for ComfyUI compatibility
      ],
      resolve: {
        alias: {
          "@": resolve(__dirname, "./src"),
          "#comfyui/app": "/scripts/app.js",
        },
      },
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      build: {
        lib: {
          entry: resolve(__dirname, "./src/main.ts"),
          formats: ["es"] as const,
          fileName: "main",
        },
        rollupOptions: {
          external: ["/scripts/app.js"],
          output: {
            dir: "js",
            entryFileNames: "main.js",
            chunkFileNames: "assets/[name]-[hash].js",
            assetFileNames: "assets/[name]-[hash][extname]",
          },
        },
        sourcemap: true,
        minify: false,
      },
    };
  }

  // Manager SPA build — no CSS injection needed (served with HTML)
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    base: "/wp/",
    build: {
      outDir: "web_dist",
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, "./src/manager.html"),
      },
    },
  };
});
