import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";
import { lastRequestByNode } from "../extension/image-filter";
import {
  defaultImageFilterConfig,
  parseImageFilterConfig,
  type ImageFilterConfig,
  type ImageFilterRun,
  type ImageRef,
  type Pick,
} from "../components/image-filter/types";

const ImageFilterWidget = defineAsyncComponent(
  () => import("../components/image-filter/ImageFilterWidget.vue"),
);

interface ImageFilterHostNode extends MountTargetNode {
  id?: string | number;
  mode?: number;
}

/** Decode the node's `wp_image_filter` UI payload (one dict per run). */
export function parseRun(raw: unknown): ImageFilterRun | null {
  const run = Array.isArray(raw) ? raw[0] : raw;
  if (!run || typeof run !== "object") return null;
  const r = run as Record<string, unknown>;
  const picks = Array.isArray(r.picks)
    ? r.picks.filter((p): p is Pick =>
      Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number"))
    : [];
  return {
    picks,
    frames: typeof r.frames === "number" ? r.frames : 0,
    total: typeof r.total === "number" ? r.total : 0,
    mode: typeof r.mode === "string" ? r.mode : "",
    stopped: r.stopped === true,
  };
}

/** Thumbnails for a run's picks, from the request this page saw. */
export function pickedThumbs(run: ImageFilterRun | null, frames: ImageRef[][] | undefined): ImageRef[] {
  if (!run || !frames) return [];
  return run.picks.map(([f, i]) => frames[f]?.[i]).filter((x): x is ImageRef => !!x);
}

/**
 * Mount glue for WP_ImageFilter's widget (`WP_IMAGE_FILTER`). The value is the
 * JSON `ImageFilterConfig` the node parses at run time; the widget also shows
 * the last run's picks from the node's `wp_image_filter` UI payload.
 */
export function create(node: ImageFilterHostNode, inputName: string) {
  const config = ref<ImageFilterConfig>(defaultImageFilterConfig());
  const lastRun = ref<ImageFilterRun | null>(null);

  const wrapper: Component = {
    setup() {
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => node.mode ?? 0,
        Object.is,
      );
      function onUpdate(next: ImageFilterConfig): void {
        config.value = next;
        host.setValue(serializeWidgetJson(next));
      }
      return () => {
        // Only a paused run sent images this page could see; a reused or
        // passed-through run keeps its summary but has no thumbnails.
        const req = lastRequestByNode.value.get(String(node.id));
        const thumbs = lastRun.value?.mode === "pause" ? pickedThumbs(lastRun.value, req?.frames) : [];
        return h(ImageFilterWidget, {
          modelValue: config.value,
          lastRun: lastRun.value,
          thumbs,
          nodeMode: nodeMode.value,
          "onUpdate:modelValue": onUpdate,
        });
      };
    },
  };

  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 170,
    minWidth: 330,
    autoHeight: true,
    onValueRestored: (raw: string) => {
      config.value = parseImageFilterConfig(raw);
    },
  });

  type ExecutedEvent = CustomEvent<{ node: string | number; output?: unknown }>;
  function onExecuted(ev: Event) {
    const detail = (ev as ExecutedEvent).detail;
    if (!detail || String(detail.node) !== String(node.id)) return;
    const out = detail.output as Record<string, unknown> | undefined;
    const run = parseRun(out?.wp_image_filter);
    if (run) lastRun.value = run;
  }
  const apiObj = (app as unknown as { api?: {
    addEventListener: (n: string, fn: (e: Event) => void) => void;
  } }).api;
  apiObj?.addEventListener("executed", onExecuted);

  return host;
}
