/**
 * What the chosen model takes for Thinking, one module-level copy shared by
 * Settings › AI and the chat header. Fetched again when the server or model
 * changes, and after the setting changes (a fresh try clears what was
 * remembered for the model).
 */
import { ref, watch } from "vue";
import { api } from "../api/client";
import type { AiThinkingInfo } from "../api/types";
import { useAiConfig } from "./useAiConfig";

const info = ref<AiThinkingInfo | null>(null);
let watching = false;
let seq = 0;

async function refresh(): Promise<void> {
  const mine = ++seq;
  try {
    const got = await api.ai.thinking();
    if (mine === seq) info.value = got;
  } catch {
    // Off, no model yet, or the server is down: the usual five choices.
    if (mine === seq) info.value = null;
  }
}

export function useAiThinking() {
  const { config } = useAiConfig();
  if (!watching) {
    watching = true;
    watch(
      () => {
        const c = config.value;
        return c?.enabled && c.model ? `${c.provider}|${c.base_url}|${c.model}|${c.thinking}` : "";
      },
      (key) => { if (key) void refresh(); else info.value = null; },
      { immediate: true },
    );
  }
  return { info, refresh };
}

/** Test seam. */
export function _resetAiThinkingForTests(): void {
  info.value = null;
  watching = false;
  seq = 0;
}
