import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from "vue";
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
  /** Reactive flag exposing the same predicate the guard uses. Editors
   *  bind this to the EditorFrame `dirty` prop so the visible "Unsaved"
   *  chip is driven by the same source of truth as the route-leave
   *  prompt — no chance of the two disagreeing. */
  dirty: ComputedRef<boolean>;
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
      // Safari + legacy browsers still fire the discard prompt only when
      // `returnValue` is set; preventDefault() alone is enough on modern
      // Chromium but not universal. The property is @deprecated in the
      // DOM lib so we set it dynamically to keep the typed surface clean.
      Reflect.set(e, "returnValue", "");
    }
  }
  window.addEventListener("beforeunload", handleUnload);
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", handleUnload);
    pendingResolve?.(false);
    pendingResolve = null;
  });

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

  const dirty = computed(() => isDirty());

  return { showConfirm, dirty, onConfirmLeave, onCancelLeave };
}
