import { onBeforeUnmount, ref, type Ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";

/**
 * Guard a route against navigation away when an editor has unsaved
 * changes. Combines two hooks:
 *
 *   - `onBeforeRouteLeave` — intercepts in-app navigation (RouterLink
 *     click, programmatic push, Back button). Resolves a Promise to
 *     `true` (proceed) or `false` (block) based on the user's choice.
 *   - `beforeunload` — surfaces the browser's native discard prompt
 *     when the user closes the tab or refreshes. Browsers ignore
 *     custom messages here for historical-spam reasons; we just need
 *     any non-undefined returnValue to trigger the prompt.
 *
 * The composable does NOT mount its own dialog. Consumers render
 * `<ConfirmDialog>` (or any modal) bound to the returned
 * `showConfirm` ref and call `onConfirmLeave` / `onCancelLeave` from
 * its emits.
 *
 * `isDirty` is a getter — kept reactive by the consumer's source-of-
 * truth refs. After a successful save, the consumer should update its
 * baseline so the getter returns false.
 */
export interface UnsavedGuard {
  showConfirm: Ref<boolean>;
  onConfirmLeave(): void;
  onCancelLeave(): void;
}

export function useUnsavedGuard(isDirty: () => boolean): UnsavedGuard {
  const showConfirm = ref(false);
  let pendingResolve: ((proceed: boolean) => void) | null = null;

  onBeforeRouteLeave(() => {
    if (!isDirty()) return true;
    return new Promise<boolean>((resolve) => {
      pendingResolve = resolve;
      showConfirm.value = true;
    });
  });

  function handleUnload(e: BeforeUnloadEvent): void {
    if (isDirty()) {
      e.preventDefault();
      // Safari + legacy browsers still need `returnValue` set for the
      // native prompt to fire; preventDefault() alone is enough only on
      // modern Chromium. The property is @deprecated in the DOM spec but
      // has no cross-browser replacement yet — keep it intentionally.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      e.returnValue = "";
    }
  }
  window.addEventListener("beforeunload", handleUnload);
  onBeforeUnmount(() => window.removeEventListener("beforeunload", handleUnload));

  function onConfirmLeave(): void {
    showConfirm.value = false;
    pendingResolve?.(true);
    pendingResolve = null;
  }
  function onCancelLeave(): void {
    showConfirm.value = false;
    pendingResolve?.(false);
    pendingResolve = null;
  }

  return { showConfirm, onConfirmLeave, onCancelLeave };
}
