import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ASK_PARAM } from "../router/frame-mode";
import { useAiChat } from "./useAiChat";

/**
 * A question handed over from the canvas help frame (`?ask=`, see
 * `askInManagerUrl`): open the assistant chat with it in the box, ready to
 * send or edit, then drop it from the address so a reload doesn't ask again.
 * Called once by `AppLayout`, the shell that has the chat.
 */
export function useAskHandoff(): void {
  const route = useRoute();
  const router = useRouter();
  const chat = useAiChat();
  watch(() => route.query[ASK_PARAM], (asked) => {
    if (typeof asked !== "string" || !asked.trim()) return;
    chat.input.value = asked;
    chat.open.value = true;
    const query = { ...route.query };
    delete query[ASK_PARAM];
    void router.replace({ path: route.path, query, hash: route.hash });
  }, { immediate: true });
}
