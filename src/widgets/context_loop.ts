/**
 * Lazy-loaded glue between ComfyUI's widget pipeline and the
 * ContextLoopWidget Vue SFC. Registered via
 * `getCustomWidgets["WP_CONTEXT_LOOP_CONFIG"]` in `src/main.ts`.
 *
 * Mirrors the WP_PromptCleaner pattern: widget value is a JSON string
 * holding the full `ContextLoopConfig`. `host.setValue` writes the
 * canonical serialised form on every SFC update so ComfyUI's widget
 * state matches what `execute()` sees.
 */
import { defineAsyncComponent, h, ref, type Component } from "vue";
import { createDomWidgetHost, type DomWidgetHost, type MountTargetNode } from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";
import {
  emptyContextLoopConfig,
  parseContextLoopConfig,
  serializeContextLoopConfig,
  type ContextLoopConfig,
} from "../components/context-loop/types";
import type { LiteNodeLike } from "../extension/graph";

const ContextLoopWidget = defineAsyncComponent(
  () => import("../components/context-loop/ContextLoopWidget.vue"),
);

interface ContextLoopHostNode extends MountTargetNode, LiteNodeLike {
  mode?: number;
}

export function create(node: ContextLoopHostNode, inputName: string) {
  const initialRaw = "";
  const config = ref<ContextLoopConfig>(
    parseContextLoopConfig(initialRaw) ?? emptyContextLoopConfig(),
  );

  // Track ComfyUI's litegraph mode (0 / 2 / 4) so the SFC dims visually
  // on mute / bypass. Mirrors WP_VarTo* + WP_Cleaner widget patterns.
  const nodeMode = reactiveFromGraph(node, () => node.mode ?? 0, Object.is);

  // Read the stock seed + count widgets reactively so the seed modal
  // preview updates whenever the user edits those widgets.
  const baseSeed = reactiveFromGraph(
    node,
    () => Number((node.widgets ?? []).find((w) => w.name === "seed")?.value ?? 0),
    Object.is,
  );
  const count = reactiveFromGraph(
    node,
    () => Number((node.widgets ?? []).find((w) => w.name === "count")?.value ?? 1),
    Object.is,
  );

  let host: DomWidgetHost | null = null;

  const wrapper: Component = {
    setup() {
      function onUpdate(next: ContextLoopConfig): void {
        config.value = next;
        // Keep ComfyUI's widget state in sync so getValue (which feeds
        // execute kwargs) returns the canonical JSON.
        host?.setValue(serializeContextLoopConfig(next));
      }
      return () =>
        h(ContextLoopWidget, {
          modelValue: config.value,
          nodeMode: nodeMode.value,
          baseSeed: baseSeed.value,
          count: count.value,
          "onUpdate:modelValue": onUpdate,
        });
    },
  };

  host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeContextLoopConfig(config.value),
    onValueRestored: (raw: string) => {
      // ComfyUI restored the widget value from workflow JSON. Re-parse
      // through the recovery layer so a corrupt save still loads.
      config.value = parseContextLoopConfig(raw);
    },
    minHeight: 140,
    minWidth: 240,
  });
  return host;
}
