import { createApp, h, reactive, ref as vueRef, type App as VueApp, type Component, type Ref } from "vue";
import { createPinia } from "pinia";
import type { ComfyNode, ComfyWidget, DOMWidgetOptions } from "#comfyui/app";
import PipelineWidget from "@/components/pipeline/PipelineWidget.vue";
import AssemblerPreview from "@/components/assembler/AssemblerPreview.vue";
import InjectWidget from "@/components/inject/InjectWidget.vue";
import { collectUpstreamVariables, collectUpstreamContext, collectUpstreamModules, collectDownstreamVariables, findDownstreamAssemblers, findDownstreamPipelineNodes, findUpstreamPipelineNodes } from "./graph";
import { analyzePipelineConflicts, analyzeInjectConflicts, resolveConstrainSources } from "./conflicts";
import type { Conflict } from "./conflicts";
import type { PipelineModule } from "@/types";
import { previewApi } from "@/api/client";

// Shared Pinia instance for all standalone widget apps — one fetch serves all nodes
const widgetPinia = createPinia();

type Serializer = {
  toWire: (data: unknown) => string;
  fromWire: (wire: string) => unknown;
};

const JSON_SERIALIZER: Serializer = {
  toWire: (data) => JSON.stringify(data),
  fromWire: (wire) => JSON.parse(wire),
};

const PIPELINE_MIN_HEIGHT = 200;
const ASSEMBLER_PREVIEW_MIN_HEIGHT = 80;

/**
 * Generic factory for creating a Vue-powered DOM widget via getCustomWidgets.
 * Returns { widget } as required by the getCustomWidgets contract.
 */
function createVueWidgetFactory(
  node: ComfyNode,
  inputName: string,
  component: Component,
  defaultValue: unknown,
  serializer: Serializer,
  minHeight: number,
): { widget: ComfyWidget } {
  const container = document.createElement("div");
  container.classList.add("wp-widget-container");
  container.style.width = "100%";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.overflow = "hidden";

  const dataRef: Ref<unknown> = vueRef(defaultValue);

  let vueApp: VueApp | null = null;
  let mounted = false;

  const mountVue = () => {
    if (vueApp) return;
    vueApp = createApp(component, {
      modelValue: dataRef.value,
      "onUpdate:modelValue": (val: unknown) => {
        dataRef.value = val;
        try {
          for (const asm of findDownstreamAssemblers(node)) {
            (asm as ComfyNode & { _wpRefreshPreview?: () => void })._wpRefreshPreview?.();
          }
        } catch {
        }
        node.graph?.setDirtyCanvas(true, true);
      },
    });
    vueApp.use(widgetPinia);
    vueApp.mount(container);
    mounted = true;
  };

  const unmountVue = () => {
    if (vueApp) {
      vueApp.unmount();
      vueApp = null;
    }
  };

  const widget = node.addDOMWidget(inputName, "custom", container, {
    serialize: true,
    hideOnZoom: true,
    getValue: () => serializer.toWire(dataRef.value),
    setValue: (v: string) => {
      try {
        dataRef.value = serializer.fromWire(v);
      } catch {
        dataRef.value = defaultValue;
      }
      unmountVue();
      requestAnimationFrame(mountVue);
    },
    getMinHeight: () => minHeight,
  } as DOMWidgetOptions);

  widget.serializeValue = async () => serializer.toWire(dataRef.value);

  widget.computeSize = (width: number): [number, number] => {
    if (!mounted || container.scrollHeight <= 0) return [width, minHeight];
    return [width, Math.max(minHeight, container.scrollHeight + 10)];
  };

  widget.computeLayoutSize = () => ({ minHeight });

  widget.onRemove = unmountVue;

  requestAnimationFrame(mountVue);

  return { widget };
}

/**
 * getCustomWidgets factory for WP_PIPELINE_CONFIG.
 * Custom reactive factory that computes and passes conflict data to PipelineWidget.
 */
export function pipelineConfigWidgetFactory(
  node: ComfyNode,
  inputName: string,
): { widget: ComfyWidget } {
  const container = document.createElement("div");
  container.classList.add("wp-widget-container");
  container.style.width = "100%";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.overflow = "hidden";

  const computeConflicts = async () => {
    const ctx = collectUpstreamContext(node);
    const downstream = collectDownstreamVariables(node);
    const resolved = await resolveConstrainSources(rootProps.modelValue);
    rootProps.conflicts = analyzePipelineConflicts(resolved, ctx.variables, downstream);
    node.graph?.setDirtyCanvas(true, true);
  };

  const lastSeed = vueRef<number | null>(null);

  const rootProps = reactive<{
    modelValue: PipelineModule[];
    conflicts: Conflict[];
    "onUpdate:modelValue": (val: PipelineModule[]) => void;
  }>({
    modelValue: [],
    conflicts: [],
    "onUpdate:modelValue": (val: PipelineModule[]) => {
      rootProps.modelValue = val;
      computeConflicts();
      try {
        for (const asm of findDownstreamAssemblers(node)) {
          (asm as ComfyNode & { _wpRefreshPreview?: () => void })._wpRefreshPreview?.();
        }
        for (const downstream of findDownstreamPipelineNodes(node)) {
          const dn = downstream as ComfyNode & {
            _wpRefreshPipelineConflicts?: () => void;
            _wpRefreshInject?: () => void;
          };
          dn._wpRefreshPipelineConflicts?.();
          dn._wpRefreshInject?.();
        }
        for (const upstream of findUpstreamPipelineNodes(node)) {
          const un = upstream as ComfyNode & { _wpRefreshPipelineConflicts?: () => void };
          un._wpRefreshPipelineConflicts?.();
        }
      } catch {
      }
      node.graph?.setDirtyCanvas(true, true);
    },
  });

  let vueApp: VueApp | null = null;
  let mounted = false;

  const mountVue = () => {
    if (vueApp) return;
    vueApp = createApp({
      render: () =>
        h(PipelineWidget, {
          modelValue: rootProps.modelValue,
          conflicts: rootProps.conflicts,
          lastSeed: lastSeed.value,
          "onUpdate:modelValue": rootProps["onUpdate:modelValue"],
        }),
    });
    vueApp.use(widgetPinia);
    vueApp.mount(container);
    mounted = true;
  };

  const unmountVue = () => {
    if (vueApp) {
      vueApp.unmount();
      vueApp = null;
    }
  };

  const widget = node.addDOMWidget(inputName, "custom", container, {
    serialize: true,
    hideOnZoom: true,
    getValue: () => JSON.stringify(rootProps.modelValue),
    setValue: (v: string) => {
      try {
        rootProps.modelValue = JSON.parse(v) as PipelineModule[];
      } catch {
        rootProps.modelValue = [];
      }
      unmountVue();
      requestAnimationFrame(mountVue);
    },
    getMinHeight: () => PIPELINE_MIN_HEIGHT,
  } as DOMWidgetOptions);

  widget.serializeValue = async () => JSON.stringify(rootProps.modelValue);

  // Wire beforeQueued hook to capture seed before control_after_generate randomizes it
  requestAnimationFrame(() => {
    const seedWidget = node.widgets?.find(w => w.name === 'seed');
    if (seedWidget) {
      const origBeforeQueued = seedWidget.beforeQueued;
      seedWidget.beforeQueued = () => {
        lastSeed.value = Number(seedWidget.value);
        origBeforeQueued?.call(seedWidget);
      };
    }
  });

  widget.computeSize = (width: number): [number, number] => {
    if (!mounted || container.scrollHeight <= 0) return [width, PIPELINE_MIN_HEIGHT];
    return [width, Math.max(PIPELINE_MIN_HEIGHT, container.scrollHeight + 10)];
  };

  widget.computeLayoutSize = () => ({ minHeight: PIPELINE_MIN_HEIGHT });

  widget.onRemove = unmountVue;

  const refreshConflicts = () => {
    requestAnimationFrame(() => {
      computeConflicts();
    });
  };

  const self = node as ComfyNode & { _wpRefreshPipelineConflicts?: () => void };
  self._wpRefreshPipelineConflicts = refreshConflicts;

  requestAnimationFrame(() => {
    mountVue();
    refreshConflicts();
  });

  return { widget };
}

const INJECT_SLOT_NAMES = ["input_1", "input_2", "input_3"];

export function injectConfigWidgetFactory(
  node: ComfyNode,
  inputName: string,
): { widget: ComfyWidget } {
  const container = document.createElement("div");
  container.classList.add("wp-widget-container");
  container.style.width = "100%";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.overflow = "hidden";

  const INJECT_MIN_HEIGHT = 60;

  const rootProps = reactive<{
    modelValue: Record<string, string>;
    connectedSlots: string[];
    conflicts: Conflict[];
    "onUpdate:modelValue": (val: Record<string, string>) => void;
  }>({
    modelValue: {},
    connectedSlots: [],
    conflicts: [],
    "onUpdate:modelValue": (val: Record<string, string>) => {
      rootProps.modelValue = val;
      const upstreamVars = collectUpstreamVariables(node);
      rootProps.conflicts = analyzeInjectConflicts(val, rootProps.connectedSlots, upstreamVars);
      try {
        for (const asm of findDownstreamAssemblers(node)) {
          (asm as ComfyNode & { _wpRefreshPreview?: () => void })._wpRefreshPreview?.();
        }
        for (const downstream of findDownstreamPipelineNodes(node)) {
          const dn = downstream as ComfyNode & {
            _wpRefreshPipelineConflicts?: () => void;
            _wpRefreshInject?: () => void;
          };
          dn._wpRefreshPipelineConflicts?.();
          dn._wpRefreshInject?.();
        }
        for (const upstream of findUpstreamPipelineNodes(node)) {
          const un = upstream as ComfyNode & { _wpRefreshPipelineConflicts?: () => void };
          un._wpRefreshPipelineConflicts?.();
        }
      } catch {
      }
      node.graph?.setDirtyCanvas(true, true);
    },
  });

  let vueApp: VueApp | null = null;
  let mounted = false;

  const mountVue = () => {
    if (vueApp) return;
    vueApp = createApp({
      render: () =>
        h(InjectWidget, {
          modelValue: rootProps.modelValue,
          connectedSlots: rootProps.connectedSlots,
          conflicts: rootProps.conflicts,
          "onUpdate:modelValue": rootProps["onUpdate:modelValue"],
        }),
    });
    vueApp.use(widgetPinia);
    vueApp.mount(container);
    mounted = true;
  };

  const unmountVue = () => {
    if (vueApp) {
      vueApp.unmount();
      vueApp = null;
    }
  };

  const widget = node.addDOMWidget(inputName, "custom", container, {
    serialize: true,
    hideOnZoom: true,
    getValue: () => JSON.stringify(rootProps.modelValue),
    setValue: (v: string) => {
      try {
        rootProps.modelValue = JSON.parse(v) as Record<string, string>;
      } catch {
        rootProps.modelValue = {};
      }
      unmountVue();
      requestAnimationFrame(mountVue);
    },
    getMinHeight: () => INJECT_MIN_HEIGHT,
  } as DOMWidgetOptions);

  widget.serializeValue = async () => JSON.stringify(rootProps.modelValue);

  widget.computeSize = (width: number): [number, number] => {
    if (!mounted || container.scrollHeight <= 0) return [width, INJECT_MIN_HEIGHT];
    return [width, Math.max(INJECT_MIN_HEIGHT, container.scrollHeight + 10)];
  };

  widget.computeLayoutSize = () => ({ minHeight: INJECT_MIN_HEIGHT });

  widget.onRemove = unmountVue;

  const refresh = () => {
    requestAnimationFrame(() => {
      rootProps.connectedSlots = getConnectedSlots(node);
      const upstreamVars = collectUpstreamVariables(node);
      rootProps.conflicts = analyzeInjectConflicts(
        rootProps.modelValue,
        rootProps.connectedSlots,
        upstreamVars,
      );
      node.graph?.setDirtyCanvas(true, true);
    });
  };

  const self = node as ComfyNode & { _wpRefreshInject?: () => void };
  self._wpRefreshInject = refresh;

  requestAnimationFrame(() => {
    mountVue();
    refresh();
  });

  return { widget };
}

function getConnectedSlots(node: ComfyNode): string[] {
  const slots: string[] = [];
  if (!node.inputs) return slots;
  for (const inp of node.inputs) {
    if (INJECT_SLOT_NAMES.includes(inp.name) && inp.link != null) {
      slots.push(inp.name);
    }
  }
  return slots;
}

/**
 * Assembler preview — additive widget (not replacing an input).
 * Still uses onNodeCreated pattern since it's a display-only addition.
 */
export function mountAssemblerPreview(
  node: ComfyNode,
  templateWidget: ComfyWidget | null,
): () => void {
  const container = document.createElement("div");
  container.classList.add("wp-widget-container");
  container.style.width = "100%";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.overflow = "hidden";

  const rootProps = reactive<{
    upstreamVariables: string[];
    template: string;
    resolvedValues: Record<string, string>;
    onAppendVariable: (varName: string) => void;
  }>({
    upstreamVariables: [],
    template: String(templateWidget?.value ?? ""),
    resolvedValues: {},
    onAppendVariable: (varName: string) => {
      if (!templateWidget) return;
      const current = String(templateWidget.value ?? "");
      const separator = current.length > 0 && !current.endsWith(" ") ? " " : "";
      templateWidget.value = current + separator + "$" + varName;
      rootProps.template = String(templateWidget.value);
    },
  });

  let vueApp: VueApp | null = null;
  let previewMounted = false;

  const mountVue = () => {
    if (vueApp) return;
    vueApp = createApp({
      render: () =>
        h(AssemblerPreview, {
          upstreamVariables: rootProps.upstreamVariables,
          template: rootProps.template,
          resolvedValues: rootProps.resolvedValues,
          onAppendVariable: rootProps.onAppendVariable,
        }),
    });
    vueApp.use(widgetPinia);
    vueApp.mount(container);
    previewMounted = true;
  };

  const unmountVue = () => {
    if (vueApp) {
      vueApp.unmount();
      vueApp = null;
    }
  };

  const domWidget = node.addDOMWidget("assembler_preview", "custom", container, {
    serialize: false,
    hideOnZoom: true,
    getValue: () => "",
    setValue: () => {},
    getMinHeight: () => ASSEMBLER_PREVIEW_MIN_HEIGHT,
  } as DOMWidgetOptions);

  domWidget.computeSize = (width: number): [number, number] => {
    if (!previewMounted || container.scrollHeight <= 0) return [width, ASSEMBLER_PREVIEW_MIN_HEIGHT];
    return [width, Math.max(ASSEMBLER_PREVIEW_MIN_HEIGHT, container.scrollHeight + 10)];
  };

  domWidget.computeLayoutSize = () => ({ minHeight: ASSEMBLER_PREVIEW_MIN_HEIGHT });

  domWidget.onRemove = unmountVue;

  const PREVIEW_SEED = 42;

  const refresh = () => {
    requestAnimationFrame(() => {
      rootProps.upstreamVariables = collectUpstreamVariables(node);
      rootProps.template = String(templateWidget?.value ?? "");

      const modules = collectUpstreamModules(node);
      if (modules.length > 0) {
        previewApi.run({ modules, seed: PREVIEW_SEED })
          .then((result) => {
            rootProps.resolvedValues = result.variables;
            node.graph?.setDirtyCanvas(true, true);
          })
          .catch(() => {
            rootProps.resolvedValues = {};
          });
      } else {
        rootProps.resolvedValues = {};
      }

      node.graph?.setDirtyCanvas(true, true);
    });
  };

  requestAnimationFrame(mountVue);

  return refresh;
}
