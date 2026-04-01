import { createApp, type App as VueApp } from "vue";
import type { ComfyNode, ComfyWidget } from "#comfyui/app";
import PipelineWidget from "@/components/pipeline/PipelineWidget.vue";
import AssemblerWidget from "@/components/assembler/AssemblerWidget.vue";

interface DOMWidgetResult {
  widget: ComfyWidget;
}

interface WidgetState<T> {
  data: T;
  vueApp: VueApp | null;
}

function mountVueWidget(
  node: ComfyNode,
  inputName: string,
  component: ReturnType<typeof import("vue")["defineComponent"]>,
  defaultValue: unknown
): DOMWidgetResult {
  const container = document.createElement("div");
  container.classList.add("wp-widget-container");

  const state: WidgetState<unknown> = {
    data: defaultValue,
    vueApp: null,
  };

  const mount = () => {
    if (state.vueApp) return;
    const vueApp = createApp(component, {
      modelValue: state.data,
      "onUpdate:modelValue": (val: unknown) => {
        state.data = val;
      },
    });
    vueApp.mount(container);
    state.vueApp = vueApp;
  };

  const widget = node.addDOMWidget(inputName, "custom", container, {
    serialize: true,
    getValue: () => JSON.stringify(state.data),
    setValue: (v: string) => {
      try {
        state.data = JSON.parse(v);
      } catch {
        state.data = defaultValue;
      }
    },
  });

  widget.serializeValue = async () => JSON.stringify(state.data);

  widget.computeSize = (width: number): [number, number] => {
    return [width, Math.max(200, container.scrollHeight + 10)];
  };

  widget.onRemove = () => {
    if (state.vueApp) {
      state.vueApp.unmount();
      state.vueApp = null;
    }
  };

  requestAnimationFrame(mount);

  return { widget };
}

export function createPipelineWidget(
  node: ComfyNode,
  inputName: string
): DOMWidgetResult {
  return mountVueWidget(node, inputName, PipelineWidget, []);
}

export function createAssemblerWidget(
  node: ComfyNode,
  inputName: string
): DOMWidgetResult {
  return mountVueWidget(node, inputName, AssemblerWidget, "");
}
