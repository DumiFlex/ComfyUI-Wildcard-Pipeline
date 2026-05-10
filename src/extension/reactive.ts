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
  mode?: number;
}

/** Marker so we install the mode-property intercept exactly once per
 *  node, even when multiple `reactiveFromGraph` calls share the same
 *  node (assembler + context widget + injector all do). The set of
 *  pending refresh callbacks lives on the node itself; the intercept
 *  fans out to all of them. */
const MODE_INTERCEPT = Symbol("wp-mode-intercept");
interface ModeInterceptedNode {
  [MODE_INTERCEPT]?: { value: number; subs: Set<() => void> };
}

/** Install (or reuse) a property-descriptor intercept on `node.mode`
 *  so writes from ComfyUI's mute/bypass shortcuts fire `cb` SYNCHRONOUSLY
 *  instead of waiting for the next 400ms poll. Pattern lifted from
 *  ComfyUI-Lora-Manager (web/comfyui/lora_loader.js:123). */
function watchNodeMode(node: ConnectableNode, cb: () => void): () => void {
  const target = node as ConnectableNode & ModeInterceptedNode;
  let slot = target[MODE_INTERCEPT];
  if (!slot) {
    slot = { value: typeof target.mode === "number" ? target.mode : 0, subs: new Set() };
    target[MODE_INTERCEPT] = slot;
    Object.defineProperty(target, "mode", {
      configurable: true,
      get() { return slot!.value; },
      set(next: number) {
        const prev = slot!.value;
        slot!.value = next;
        if (prev !== next) for (const s of slot!.subs) s();
      },
    });
  }
  slot.subs.add(cb);
  return () => { slot!.subs.delete(cb); };
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

  // Mode-change intercept — instant detection of mute/bypass toggles
  // (ComfyUI assigns `node.mode = 2|4` directly, no event fires).
  // Without this, every consumer waits the 400ms poll cycle to dim
  // its UI / re-walk the chain after the user keys M/Ctrl-M.
  const unwatchMode = watchNodeMode(node, refresh);

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
    unwatchMode();
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
