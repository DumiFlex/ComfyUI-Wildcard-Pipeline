/* Runs inside the ComfyUI page (injected by shoot.mjs). Small helpers the
 * scenes use to build a graph from the example workflows. Plain JS: it is a
 * page script, not part of the build. */
(() => {
  const app = () => window.app;
  const graph = () => window.app.graph;

  function byId(id) {
    // Loaded workflows keep their ids as strings; new nodes get numbers.
    const n = graph().getNodeById(id) ?? graph().getNodeById(String(id)) ?? graph().getNodeById(Number(id));
    if (!n) throw new Error(`no node ${id}`);
    return n;
  }

  function inputIndex(node, name) {
    const i = (node.inputs ?? []).findIndex((s) => s.name === name);
    if (i < 0) throw new Error(`${node.type} has no input ${name}`);
    return i;
  }

  function outputIndex(node, name) {
    const i = (node.outputs ?? []).findIndex((s) => s.name === name);
    if (i < 0) throw new Error(`${node.type} has no output ${name}`);
    return i;
  }

  window.__shot = {
    async load(json) {
      await app().loadGraphData(structuredClone(json), true, false);
      // A seed that changes after each run would make the canvas previews
      // disagree with what the run printed.
      for (const n of graph().nodes) {
        for (const w of n.widgets ?? []) {
          if (w.name === "control_after_generate") w.value = "fixed";
          // The canvas previews roll with seed 42; the run then prints the same picks.
          if (n.type === "WP_Context" && w.name === "seed") w.value = 42;
          for (const l of w.linkedWidgets ?? []) if (l.name === "control_after_generate") l.value = "fixed";
        }
      }
      // Example rows carry a soft EXAMPLE mark; the docs show a library user's view.
      for (const n of graph().nodes) {
        for (const w of n.widgets ?? []) {
          if (typeof w.value === "string" && w.value.includes('"example": true')) {
            w.value = w.value.replaceAll('"example": true', '"example": false');
            w.callback?.(w.value);
          }
        }
      }
    },
    /** Keep only these node ids (and the links between them). */
    only(ids) {
      const keep = new Set(ids.map(String));
      for (const n of [...graph().nodes]) if (!keep.has(String(n.id))) graph().remove(n);
      // Canvas groups frame the whole example; a picture of a few nodes has none.
      for (const g of [...(graph().groups ?? graph()._groups ?? [])]) graph().remove(g);
    },
    node: byId,
    add(type, opts = {}) {
      const n = window.LiteGraph.createNode(type);
      if (!n) throw new Error(`no node type ${type}`);
      if (opts.title) n.title = opts.title;
      graph().add(n);
      for (const [k, v] of Object.entries(opts.widgets ?? {})) this.set(n, k, v);
      for (const w of n.widgets ?? []) if (w.name === "control_after_generate") w.value = "fixed";
      return n;
    },
    set(node, name, value) {
      const n = typeof node === "number" ? byId(node) : node;
      const w = (n.widgets ?? []).find((x) => x.name === name);
      if (!w) throw new Error(`${n.type} has no widget ${name}`);
      w.value = value;
      w.callback?.(value);
    },
    link(a, out, b, inp) {
      const from = typeof a === "number" ? byId(a) : a;
      const to = typeof b === "number" ? byId(b) : b;
      from.connect(outputIndex(from, out), to, inputIndex(to, inp));
    },
    unlink(b, inp) {
      const to = typeof b === "number" ? byId(b) : b;
      to.disconnectInput(inputIndex(to, inp));
    },
    /** Place a node; `w` sets its width (height stays the node's own). */
    at(node, x, y, w) {
      const n = typeof node === "number" ? byId(node) : node;
      n.pos = [x, y];
      if (w) n.size = [w, n.size[1]];
      return n;
    },
    /** Set a node's width (its height follows its content). */
    w(node, width) {
      const n = typeof node === "number" || typeof node === "string" ? byId(node) : node;
      n.size = [width, n.size[1]];
      return n;
    },
    /**
     * Lay nodes out in columns, left to right, each stacked top down, from
     * their drawn sizes (so nothing overlaps whatever a node's content is).
     * `cols` holds nodes or ids; a column entry `{ gap: n }` adds space.
     */
    async columns(cols, { gapX = 60, gapY = 36 } = {}) {
      this.dirty();
      await this.wait(700);
      const c = app().canvas;
      const size = (n) => {
        const el = document.querySelector(`[data-node-id="${n.id}"]`);
        const r = el?.getBoundingClientRect();
        return r ? [r.width / c.ds.scale, r.height / c.ds.scale] : [n.size[0], n.size[1] + 30];
      };
      let x = 0;
      for (const col of cols) {
        let y = 0, wMax = 0;
        for (const item of col) {
          if (item && typeof item === "object" && "gap" in item && !("id" in item)) { y += item.gap; continue; }
          const n = typeof item === "number" || typeof item === "string" ? byId(item) : item;
          const [w, h] = size(n);
          n.pos = [x, y + window.LiteGraph.NODE_TITLE_HEIGHT];
          y += h + gapY;
          wMax = Math.max(wMax, w);
        }
        x += wMax + gapX;
      }
      this.dirty();
      await this.wait(500);
    },
    /** Fold a node to its title bar (a neighbour the picture isn't about). */
    fold(...nodes) {
      for (const node of nodes) {
        const n = typeof node === "number" ? byId(node) : node;
        if (!n.flags?.collapsed) n.collapse();
      }
    },
    mode(node, m) {
      const n = typeof node === "number" ? byId(node) : node;
      n.mode = m;
    },
    id(node) {
      return (typeof node === "number" ? byId(node) : node).id;
    },
    /** Put a node in the middle of the canvas at scale 1. */
    focus(id) {
      const n = byId(id);
      const c = app().canvas;
      const box = c.canvas.getBoundingClientRect();
      c.ds.scale = 1;
      c.ds.offset = [box.width / 2 - n.pos[0] - n.size[0] / 2, box.height / 2 - n.pos[1] - n.size[1] / 2];
      c.setDirty(true, true);
    },
    wait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },
    dirty() {
      app().canvas.setDirty(true, true);
    },
  };
})();
