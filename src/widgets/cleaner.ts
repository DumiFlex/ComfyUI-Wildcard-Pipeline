import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  createDomWidgetHost,
  parseWidgetJsonWithRecovery,
  serializeWidgetJson,
  type MountTargetNode,
} from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";
import {
  emptyCleanerConfig,
  type CleanerNodeConfig,
  type RunReport,
} from "../components/cleaner/types";

const CleanerWidget = defineAsyncComponent(
  () => import("../components/cleaner/CleanerWidget.vue"),
);
const BlocklistModal = defineAsyncComponent(
  () => import("../components/cleaner/BlocklistModal.vue"),
);

interface CleanerHostNode extends MountTargetNode {
  id?: string | number;
  mode?: number;
}

/**
 * Lazy mount glue for the WP_PromptCleaner widget.
 *
 * Registers a custom widget type `WP_CLEANER` whose value is the
 * JSON-serialized `CleanerNodeConfig`. The Vue app inside reads/writes
 * through the standard host.setValue / onValueRestored contract.
 *
 * Word + char counts + per-rule report land via the `executed` event —
 * wp_nodes/prompt_cleaner.py emits a `ui` payload after every run.
 * Same pattern WP_Context uses for its seed payload.
 *
 * No preset persistence: 3 built-in intensities (gentle / balanced /
 * aggressive) live in code; per-node manual toggles + blocklist
 * entries are persisted via the widget JSON.
 */
export function create(node: CleanerHostNode, inputName: string) {
  const initialRaw = "";
  const parsed = parseWidgetJsonWithRecovery<CleanerNodeConfig>(initialRaw, emptyCleanerConfig());
  const config = ref<CleanerNodeConfig>(parsed.value);
  const lastRunReport = ref<RunReport | null>(null);
  const wordCount = ref(0);
  const charCount = ref(0);
  const clipTokenCount = ref<number | null>(null);
  const blocklistOpen = ref(false);

  const wrapper: Component = {
    setup() {
      // Litegraph mode tracker — drives the muted/bypassed dim overlay.
      // 0=ALWAYS, 2=NEVER (mute), 4=BYPASS. Same pattern WP_Context /
      // WP_Debug / WP_Injector use; reads via reactiveFromGraph so
      // the widget repaints on mode changes without manual wiring.
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => node.mode ?? 0,
        Object.is,
      );
      function onUpdate(next: CleanerNodeConfig): void {
        config.value = next;
        host.setValue(serializeWidgetJson(next));
      }
      function onUpdateBlocklist(next: { kind: "list" | "regex"; entries: string[] }): void {
        onUpdate({ ...config.value, blocklist: next });
      }
      return () => h("div", { class: "wp-cleaner-host" }, [
        h(CleanerWidget, {
          modelValue: config.value,
          lastRunReport: lastRunReport.value,
          wordCount: wordCount.value,
          charCount: charCount.value,
          clipTokenCount: clipTokenCount.value,
          clipTokenLimit: 77,
          nodeMode: nodeMode.value,
          "onUpdate:modelValue": onUpdate,
          "onOpen-blocklist": () => { blocklistOpen.value = true; },
        }),
        h(BlocklistModal, {
          visible: blocklistOpen.value,
          modelValue: config.value.blocklist,
          "onUpdate:modelValue": onUpdateBlocklist,
          onClose: () => { blocklistOpen.value = false; },
        }),
      ]);
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    // Initial floor sized to fit the typical content footprint (header +
    // intensity segment + rule rows + blocklist button). ResizeObserver
    // grows the host above this when content asks for more, but
    // autoHeight stays OFF so the user's manual drag-taller persists
    // across workflow runs (default delta-check policy).
    minHeight: 350,
    minWidth: 320,
    onValueRestored: (raw: string) => {
      const restored = parseWidgetJsonWithRecovery<CleanerNodeConfig>(raw, emptyCleanerConfig());
      config.value = restored.value;
    },
  });

  type ExecutedEvent = CustomEvent<{
    node: string | number;
    output?: unknown;
  }>;
  function pickFirst(obj: Record<string, unknown>, key: string): unknown {
    const direct = obj[key];
    if (direct !== undefined) return Array.isArray(direct) ? direct[0] : direct;
    const ui = obj.ui as Record<string, unknown> | undefined;
    if (ui) {
      const fromUi = ui[key];
      if (fromUi !== undefined) return Array.isArray(fromUi) ? fromUi[0] : fromUi;
    }
    return undefined;
  }
  function onExecuted(ev: Event) {
    const detail = (ev as ExecutedEvent).detail;
    if (!detail || String(detail.node) !== String(node.id)) return;
    if (!detail.output || typeof detail.output !== "object") return;
    const out = detail.output as Record<string, unknown>;
    const report = pickFirst(out, "wp_cleaner_report");
    if (report && typeof report === "object") {
      lastRunReport.value = report as RunReport;
    }
    const w = pickFirst(out, "wp_cleaner_word_count");
    if (typeof w === "number") wordCount.value = w;
    const c = pickFirst(out, "wp_cleaner_char_count");
    if (typeof c === "number") charCount.value = c;
    // Don't requestRelayout — that would override the user's manual
    // height drag. The ResizeObserver still bumps minHeight if content
    // ever needs more room.
  }
  const apiObj = (app as unknown as { api?: {
    addEventListener: (n: string, fn: (e: Event) => void) => void;
    removeEventListener: (n: string, fn: (e: Event) => void) => void;
  } }).api;
  apiObj?.addEventListener("executed", onExecuted);

  return host;
}
