import { createApp, h, reactive, ref as vueRef, type App as VueApp, type Component, type Ref } from "vue";
import { createPinia } from "pinia";
import type { ComfyNode, ComfyWidget, DOMWidgetOptions } from "#comfyui/app";
import PipelineWidget from "@/components/pipeline/PipelineWidget.vue";
import AssemblerPreview from "@/components/assembler/AssemblerPreview.vue";
import InjectWidget from "@/components/inject/InjectWidget.vue";
import { collectUpstreamVariables, findDownstreamAssemblers } from "./graph";

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
 * Called by ComfyUI when a node declares an input of type "WP_PIPELINE_CONFIG".
 */
export function pipelineConfigWidgetFactory(
  node: ComfyNode,
  inputName: string,
): { widget: ComfyWidget } {
  return createVueWidgetFactory(
    node,
    inputName,
    PipelineWidget,
    [],
    JSON_SERIALIZER,
    PIPELINE_MIN_HEIGHT,
  );
}

/**
 * getCustomWidgets factory for WP_INJECT_CONFIG.
 * Called by ComfyUI when a node declares an input of type "WP_INJECT_CONFIG".
 */
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
    "onUpdate:modelValue": (val: Record<string, string>) => void;
  }>({
    modelValue: {},
    connectedSlots: [],
    "onUpdate:modelValue": (val: Record<string, string>) => {
      rootProps.modelValue = val;
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

  // Expose refresh function on the node for onConnectionsChange
  const refresh = () => {
    requestAnimationFrame(() => {
      rootProps.connectedSlots = getConnectedAutogrowSlots(node);
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

function getConnectedAutogrowSlots(node: ComfyNode): string[] {
  const slots: string[] = [];
  if (!node.inputs) return slots;
  for (const inp of node.inputs) {
    if (inp.name.startsWith("input_") && inp.link != null) {
      slots.push(inp.name);
    }
  }
  slots.sort();
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
    onAppendVariable: (varName: string) => void;
  }>({
    upstreamVariables: [],
    template: String(templateWidget?.value ?? ""),
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
    // Render function wrapper — Vue tracks reactive property access inside render,
    // so mutating rootProps triggers component re-render.
    vueApp = createApp({
      render: () =>
        h(AssemblerPreview, {
          upstreamVariables: rootProps.upstreamVariables,
          template: rootProps.template,
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

  const refresh = () => {
    requestAnimationFrame(() => {
      rootProps.upstreamVariables = collectUpstreamVariables(node);
      rootProps.template = String(templateWidget?.value ?? "");
      node.graph?.setDirtyCanvas(true, true);
    });
  };

  requestAnimationFrame(mountVue);

  return refresh;
}
