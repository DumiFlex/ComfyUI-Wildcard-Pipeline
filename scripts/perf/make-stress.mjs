// Stress workflow generator for the canvas perf probe (not shipped).
//
//   node scripts/perf/make-stress.mjs [N=40] [out=.tmp/perf/stress40.json]
//
// N WP_Context nodes chained through `upstream`, with a WP_PromptAssembler
// hanging off every 4th one. Each Context carries the biggest Context body of
// example 1 (~27 KB `wp_modules`), so the walkers see real module payloads.
// Exported as `makeStress` so `canvas-measure.mjs` can build it in memory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function makeStress(n = 40) {
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, "example_workflows/1 - One image.json"), "utf8"));
  const ctxT = ex.nodes.filter((x) => x.type === "WP_Context")
    .sort((a, b) => String(b.widgets_values[2]).length - String(a.widgets_values[2]).length)[0];
  const asmT = ex.nodes.find((x) => x.type === "WP_PromptAssembler");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const nodes = [];
  const links = [];
  let lid = 0;
  let nid = 0;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const c = clone(ctxT);
    c.id = ++nid;
    delete c.widgets_values_named;
    c.title = `WP Context ${i}`;
    c.pos = [(i % 8) * 700, Math.floor(i / 8) * 1400];
    c.inputs[0].link = null;
    c.inputs[1].link = null;
    c.outputs[0].links = [];
    c.order = i;
    if (prev) {
      const id = ++lid;
      links.push([id, prev.id, 0, c.id, 0, "PIPELINE_CONTEXT"]);
      prev.outputs[0].links.push(id);
      c.inputs[0].link = id;
    }
    nodes.push(c);
    if (i % 4 === 3) {
      const a = clone(asmT);
      a.id = ++nid;
      delete a.widgets_values_named;
      a.pos = [c.pos[0], c.pos[1] + 700];
      a.outputs.forEach((o) => { o.links = []; });
      const id = ++lid;
      links.push([id, c.id, 0, a.id, 0, "PIPELINE_CONTEXT"]);
      c.outputs[0].links.push(id);
      a.inputs[0].link = id;
      a.inputs[1].link = null;
      a.inputs[2].link = null;
      nodes.push(a);
    }
    prev = c;
  }
  return {
    ...ex,
    id: "00000000-perf-0000-0000-000000000000",
    nodes, links, groups: [], last_node_id: nid, last_link_id: lid,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = Number(process.argv[2] ?? 40);
  const out = process.argv[3] ?? path.join(ROOT, `.tmp/perf/stress${n}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const wf = makeStress(n);
  fs.writeFileSync(out, JSON.stringify(wf));
  console.log(`wrote ${out}: ${wf.nodes.length} nodes, ${wf.links.length} links, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
