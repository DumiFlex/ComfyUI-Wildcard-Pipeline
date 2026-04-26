import { ref, type Ref, onScopeDispose } from "vue";
import { onGraphLoaded } from "./graph-events";

export { notifyGraphLoaded } from "./graph-events";

/**
 * Re-evaluate `compute` whenever the host node's input/output connections
 * change. Returns a reactive ref that mirrors the latest computation result.
 *
 * LiteGraph dispatches `onConnectionsChange(type, slot, connected, link, slot)`
 * on each affected node when a wire is added/removed. We chain onto whatever
 * was already there so other extensions keep working. We also re-run on a
 * coarse polling interval to catch upstream-chain mutations that don't fire
 * the local node's callback (e.g. a wire added two nodes upstream).
 *
 * Workflow-load races: the snapshot computed at first mount sees upstream
 * widgets in their pre-restore state. We subscribe to a global "graph just
 * fully loaded" signal (fired from main.ts via afterConfigureGraph) so every
 * reactive widget re-syncs the moment ComfyUI finishes restoring values —
 * no flash of stale state.
 */
export interface ConnectableNode {
  onConnectionsChange?: (...args: unknown[]) => void;
}

export function reactiveFromGraph<T>(
  node: ConnectableNode,
  compute: () => T,
  equals: (a: T, b: T) => boolean = Object.is,
  pollMs = 400,
): Ref<T> {
  const state = ref(compute()) as Ref<T>;

  function refresh() {
    const next = compute();
    if (!equals(state.value, next)) state.value = next;
  }

  const orig = node.onConnectionsChange;
  node.onConnectionsChange = function (...args: unknown[]) {
    orig?.apply(this, args);
    refresh();
  };

  // Polling fallback for upstream-chain edits that don't fire on this node.
  const interval = window.setInterval(refresh, pollMs);

  // Re-sync on workflow load. Several ticks because ComfyUI restores widget
  // values asynchronously through cascading callbacks; a single refresh can
  // still catch us mid-cascade. requestAnimationFrame chain settles within
  // two frames in practice — cheap insurance against a late restore.
  const unsubscribe = onGraphLoaded(() => {
    refresh();
    requestAnimationFrame(() => {
      refresh();
      requestAnimationFrame(refresh);
    });
  });

  onScopeDispose(() => {
    window.clearInterval(interval);
    unsubscribe();
    node.onConnectionsChange = orig;
  });

  return state;
}

/** Cheap structural equality for string[] (order matters). */
export function stringArrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
