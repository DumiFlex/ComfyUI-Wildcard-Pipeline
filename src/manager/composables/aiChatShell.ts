/**
 * The few pieces of the AI chat's state the app shell reads on every page:
 * whether the drawer is open, the composer text (a `?ask=` handoff fills
 * it), whether an answer is on its way and the live answer's phase (the
 * topbar's working line).
 *
 * Kept apart from `useAiChat.ts`, which owns them and everything else
 * (sending, cards, page tools, ~55 KB with `useAiActions` / `aiManageOps`),
 * so the boot chunk carries only these refs: the rest loads with the chat
 * drawer, the selection chip or a page that talks to the chat.
 */
import { ref, shallowRef } from "vue";
import type { AiChatStep } from "../api/types";

/** The answer being written: its text so far, what the model is doing,
 *  and the steps it has taken. Cleared when the answer arrives. */
export interface LiveAnswer {
  text: string;
  status: string;
  thinking: boolean;
  steps: AiChatStep[];
  /** The step's reasoning so far, while it streams. */
  thought?: string;
  /** When the step was asked, while the model has sent nothing back
   *  (busy with another request, loading, or reading the prompt). */
  waitingSince?: number;
}
export const EMPTY_LIVE: LiveAnswer = { text: "", status: "", thinking: false, steps: [] };

export const chatOpen = ref(false);
export const chatInput = ref("");
export const chatLoading = ref(false);
export const chatLive = shallowRef<LiveAnswer>(EMPTY_LIVE);

/** The shell's view of the chat (same refs `useAiChat()` returns). */
export function useAiChatShell() {
  return { open: chatOpen, input: chatInput, loading: chatLoading, live: chatLive };
}
