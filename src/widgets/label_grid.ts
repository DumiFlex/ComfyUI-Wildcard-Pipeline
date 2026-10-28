import { defineAsyncComponent, h, ref, type Component } from "vue";
import { createDomWidgetHost, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { listenApi } from "./_listen";
import { reactiveFromGraph } from "../extension/reactive";
import {
  defaultLabelGridConfig,
  parseLabelGridConfig,
  parseLabelGridRun,
  type LabelGridConfig,
  type LabelGridRun,
} from "../extension/label-grid";

const LabelGridWidget = defineAsyncComponent(
  () => import("../components/label-grid/LabelGridWidget.vue"),
);

interface LabelGridHostNode extends MountTargetNode {
  id?: string | number;
  mode?: number;
}

/** The last run per node, so a widget re-created (a graph reload) keeps it. */
const lastRuns = new WeakMap<object, LabelGridRun>();

/** Fonts this machine has, asked once per page (`GET /wp/api/label-grid/fonts`). */
let fontsPromise: Promise<string[]> | null = null;
export function loadFonts(): Promise<string[]> {
  fontsPromise ??= fetch("/wp/api/label-grid/fonts", { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : { fonts: [] }))
    .then((body: { fonts?: unknown }) => {
      const list = Array.isArray(body.fonts) ? body.fonts.filter((f): f is string => typeof f === "string") : [];
      return list.length ? list : ["default"];
    })
    .catch(() => {
      fontsPromise = null;
      return ["default"];
    });
  return fontsPromise;
}

/**
 * Mount glue for WP_LabelGrid's one widget (`WP_LABEL_GRID`). The value is
 * the JSON `LabelGridConfig` the node parses at run time
 * (`engine/label_grid.py::parse_config`).
 *
 * The node's `wp_label_grid` UI payload says what the last run looked like
 * (items, batch sizes, label parts); the widget uses it to name the run and
 * mark the grid preset that fits it.
 */
export function create(node: LabelGridHostNode, inputName: string) {
  const config = ref<LabelGridConfig>(defaultLabelGridConfig());
  const lastRun = ref<LabelGridRun | null>(lastRuns.get(node) ?? null);
  const fonts = ref<string[]>(["default"]);
  void loadFonts().then((f) => { fonts.value = f; });

  const wrapper: Component = {
    setup() {
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => node.mode ?? 0,
        Object.is,
      );
      function onUpdate(next: LabelGridConfig): void {
        config.value = next;
        host.setValue(serializeWidgetJson(next));
      }
      return () => h(LabelGridWidget, {
        modelValue: config.value,
        lastRun: lastRun.value,
        fonts: fonts.value,
        nodeMode: nodeMode.value,
        "onUpdate:modelValue": onUpdate,
      });
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 260,
    minWidth: 360,
    autoHeight: true,
    onValueRestored: (raw: string) => {
      config.value = parseLabelGridConfig(raw);
    },
  });

  type ExecutedEvent = CustomEvent<{ node: string | number; output?: unknown }>;
  function onExecuted(ev: Event) {
    const detail = (ev as ExecutedEvent).detail;
    if (!detail || String(detail.node) !== String(node.id)) return;
    const out = detail.output as Record<string, unknown> | undefined;
    const run = parseLabelGridRun(out?.wp_label_grid);
    if (!run) return;
    lastRuns.set(node, run);
    lastRun.value = run;
  }
  listenApi(host, "executed", onExecuted);

  return host;
}
