import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import {
  createDomWidgetHost,
  parseWidgetJsonWithRecovery,
  serializeWidgetJson,
  type MountTargetNode,
} from "./_shared";
import {
  emptyCleanerConfig,
  type CleanerNodeConfig,
  type PresetOption,
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
 * Word + char counts + per-rule report land on the widget via the
 * `executed` event — wp_nodes/prompt_cleaner.py emits a `ui` payload
 * after every run. Same pattern WP_Context uses for its seed payload.
 *
 * Preset list is fetched lazily on first mount via the
 * cleanerPresetStore. The widget shows a dropdown picker that emits
 * `load-preset` with the id; we copy the preset's payload into the
 * widget config so the user can immediately edit on top of it.
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
  const presets = ref<PresetOption[]>([]);

  // Lazy fetch preset list on mount. Store stays warm across nodes
  // since it's a Pinia singleton — but each node-instance gets its
  // own watch so a remote preset CRUD elsewhere reflects here too.
  async function ensurePresets(): Promise<void> {
    try {
      const { useCleanerPresetStore } = await import("../manager/stores/cleanerPresetStore");
      const { createPinia, setActivePinia, getActivePinia } = await import("pinia");
      if (!getActivePinia()) setActivePinia(createPinia());
      const store = useCleanerPresetStore();
      if (store.items.length === 0) await store.fetchAll();
      presets.value = store.items.map((p) => ({
        id: p.id,
        name: p.name,
        is_builtin: p.is_builtin,
      }));
    } catch {
      presets.value = [];
    }
  }
  void ensurePresets();

  const wrapper: Component = {
    setup() {
      function onUpdate(next: CleanerNodeConfig): void {
        config.value = next;
        host.setValue(serializeWidgetJson(next));
      }
      function onUpdateBlocklist(next: { kind: "list" | "regex"; entries: string[] }): void {
        onUpdate({ ...config.value, blocklist: next });
      }
      async function onLoadPreset(presetId: string): Promise<void> {
        try {
          const { useCleanerPresetStore } = await import("../manager/stores/cleanerPresetStore");
          const store = useCleanerPresetStore();
          const row = store.findById(presetId);
          if (!row) return;
          const payload = JSON.parse(JSON.stringify(row.payload)) as CleanerNodeConfig;
          onUpdate({
            ...payload,
            preset_ref: {
              id: row.id,
              name: row.name,
              payload_hash: row.payload_hash,
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          window.alert(`Load preset failed: ${msg}`);
        }
      }
      async function onOpenSave(): Promise<void> {
        const name = window.prompt("Save preset as…", "");
        if (!name) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        try {
          const { useCleanerPresetStore } = await import("../manager/stores/cleanerPresetStore");
          const { createPinia, setActivePinia, getActivePinia } = await import("pinia");
          if (!getActivePinia()) setActivePinia(createPinia());
          const store = useCleanerPresetStore();
          const payload: CleanerNodeConfig = { ...config.value };
          delete payload.preset_ref;
          const row = await store.create({ name: trimmed, payload });
          presets.value = store.items.map((p) => ({
            id: p.id, name: p.name, is_builtin: p.is_builtin,
          }));
          config.value = {
            ...config.value,
            preset_ref: {
              id: row.id,
              name: row.name,
              payload_hash: row.payload_hash,
            },
          };
          host.setValue(serializeWidgetJson(config.value));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          window.alert(`Save failed: ${msg}`);
        }
      }
      return () => h("div", { class: "wp-cleaner-host" }, [
        h(CleanerWidget, {
          modelValue: config.value,
          lastRunReport: lastRunReport.value,
          wordCount: wordCount.value,
          charCount: charCount.value,
          clipTokenCount: clipTokenCount.value,
          clipTokenLimit: 77,
          presets: presets.value,
          "onUpdate:modelValue": onUpdate,
          "onOpen-blocklist": () => { blocklistOpen.value = true; },
          "onOpen-save": onOpenSave,
          "onLoad-preset": onLoadPreset,
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
    minHeight: 360,
    minWidth: 320,
    autoHeight: true,
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
    host.requestRelayout();
  }
  const apiObj = (app as unknown as { api?: {
    addEventListener: (n: string, fn: (e: Event) => void) => void;
    removeEventListener: (n: string, fn: (e: Event) => void) => void;
  } }).api;
  apiObj?.addEventListener("executed", onExecuted);

  return host;
}
