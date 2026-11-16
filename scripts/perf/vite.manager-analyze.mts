/**
 * The manager build with a per-chunk module dump (rendered size of every module in every
 * chunk), to see what lands in the boot chunk. Not shipped, not run by CI.
 *
 *   pnpm exec vite build --mode manager -c scripts/perf/vite.manager-analyze.mts
 *   node scripts/perf/manager-modules.mjs [entry|<chunk name part>] [top]
 *
 * Builds into `.tmp/perf/manager-analyze/` (set PLAIN=1 for an unminified build, for readable
 * CPU profiles) and writes `.tmp/perf/manager-analyze/modules.json`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import base from "../../vite.config.mts";

interface ChunkInfo {
  type: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  modules?: Record<string, { renderedLength: number }>;
}

const OUT = resolve(__dirname, "../../.tmp/perf/manager-analyze");

export default (env: { mode: string; command: string }) => {
  const cfg = (base as unknown as (e: typeof env) => Record<string, unknown>)(env);
  const plugins = (cfg.plugins as { name?: string }[]).filter((p) => p?.name !== "rename-manager-html");
  plugins.push({
    name: "dump-modules",
    generateBundle(_o: unknown, bundle: Record<string, ChunkInfo>) {
      const out: Record<string, unknown> = {};
      for (const [name, c] of Object.entries(bundle)) {
        if (c.type !== "chunk") continue;
        out[name] = {
          isEntry: c.isEntry, isDynamicEntry: c.isDynamicEntry, imports: c.imports, dynamicImports: c.dynamicImports,
          modules: Object.entries(c.modules ?? {})
            .map(([id, m]) => [id.replace(/\\/g, "/").replace(/^.*?\/(src|node_modules)\//, "$1/"), m.renderedLength])
            .sort((a, b) => (b[1] as number) - (a[1] as number)),
        };
      }
      mkdirSync(OUT, { recursive: true });
      writeFileSync(resolve(OUT, "modules.json"), JSON.stringify(out, null, 1));
    },
  } as { name: string });
  const plain = process.env.PLAIN === "1";
  return {
    ...cfg,
    plugins,
    build: { ...(cfg.build as object), outDir: resolve(OUT, plain ? "web-plain" : "web"), emptyOutDir: true, ...(plain ? { minify: false } : {}) },
  };
};
