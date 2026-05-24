import { defineAsyncComponent, h, ref, type Component } from "vue";
import {
  createDomWidgetHost,
  parseWidgetJsonWithRecovery,
  serializeWidgetJson,
  type MountTargetNode,
} from "./_shared";
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
}

/**
 * Lazy mount glue for the WP_PromptCleaner widget.
 *
 * Registers a custom widget type `WP_CLEANER` whose value is the
 * JSON-serialized `CleanerNodeConfig`. The Vue app inside reads/writes
 * through the standard host.setValue / onValueRestored contract.
 *
 * Word + char counts are computed from the live cleaner output that
 * the backend reports back via the `executed` event. CLIP token count
 * is deferred to a future iteration that wires a real CLIP slot.
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
      function onUpdate(next: CleanerNodeConfig): void {
        config.value = next;
        host.setValue(serializeWidgetJson(next));
      }
      function onUpdateBlocklist(next: { kind: "list" | "regex"; entries: string[] }): void {
        onUpdate({ ...config.value, blocklist: next });
      }
      function onOpenSave(): void {
        // Hooked up to PushToLibraryModal in Phase 6 Task 19.
        console.warn("[wp_cleaner] save flow not yet wired");
      }
      return () => h("div", { class: "wp-cleaner-host" }, [
        h(CleanerWidget, {
          modelValue: config.value,
          lastRunReport: lastRunReport.value,
          wordCount: wordCount.value,
          charCount: charCount.value,
          clipTokenCount: clipTokenCount.value,
          clipTokenLimit: 77,
          "onUpdate:modelValue": onUpdate,
          "onOpen-blocklist": () => { blocklistOpen.value = true; },
          "onOpen-save": onOpenSave,
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
    minHeight: 240,
    minWidth: 280,
    autoHeight: true,
    onValueRestored: (raw: string) => {
      const restored = parseWidgetJsonWithRecovery<CleanerNodeConfig>(raw, emptyCleanerConfig());
      config.value = restored.value;
    },
  });
  return host;
}
