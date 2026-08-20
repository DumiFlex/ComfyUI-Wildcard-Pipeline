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

/* ── Shared activity clock ────────────────────────────────────────────────
 *
 * ONE document listener for the whole extension, not one per node. Every
 * polling widget reads the same timestamp to decide whether the user is
 * currently doing anything; N listeners for a single global fact would be the
 * same mistake the per-node intervals already make.
 *
 * Capture phase and passive: this only observes, and must not be hidden by a
 * `stopPropagation()` from ComfyUI's own canvas handling.
 */
let lastActivityAt = Date.now();
function markActivity(): void { lastActivityAt = Date.now(); }
if (typeof document !== "undefined") {
  for (const ev of ["pointerdown", "keydown", "wheel"]) {
    document.addEventListener(ev, markActivity, { capture: true, passive: true });
  }
}

/**
 * A polling fallback that stops working when nothing can be happening.
 *
 * Shared, because this project has two of these loops and they had drifted
 * into having nothing in common but the bug. `tick` reports whether it
 * observed a change, which is what drives the ladder back up.
 */
export function startAdaptivePoll(baseMs: number, tick: () => "changed" | "quiet"): () => void {
  let quiet = 0;
  let stepIdx = 0;
  let ticks = 0;
  let wasHidden = false;
  let seenActivityAt = lastActivityAt;

  const run = (): void => {
    if (typeof document !== "undefined" && document.hidden) {
      wasHidden = true;
      return;
    }
    if (wasHidden) {
      // Coming back to a tab that may have missed edits made elsewhere.
      wasHidden = false;
      quiet = 0;
      stepIdx = 0;
      tick();
      return;
    }
    if (lastActivityAt !== seenActivityAt) {
      seenActivityAt = lastActivityAt;
      quiet = 0;
      stepIdx = 0;
    }
    // Skip ticks to realise the current multiple, rather than tearing down and
    // recreating the interval at every step.
    ticks += 1;
    if (ticks % BACKOFF_STEPS[stepIdx] !== 0) return;

    if (tick() === "quiet") {
      quiet += 1;
      if (quiet >= STEP_AFTER_QUIET && stepIdx < BACKOFF_STEPS.length - 1) {
        stepIdx += 1;
        quiet = 0;
      }
    } else {
      quiet = 0;
      stepIdx = 0;
    }
  };

  const id = window.setInterval(run, baseMs);
  return () => window.clearInterval(id);
}

/** Back-off ladder for the polling fallback, in multiples of the base period.
 *  Idle canvases are the common case — a graph sits untouched while a queue
 *  runs — and the fallback exists for edits that fire no event, which cannot
 *  happen while nobody is editing. */
const BACKOFF_STEPS = [1, 3, 8];
/** Consecutive unchanged polls before stepping down the ladder. At the 400ms
 *  base that is ~4s of stillness per step, ~12s to the slowest rate. */
const STEP_AFTER_QUIET = 10;

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

  /* Polling fallback for upstream-chain edits that don't fire on this node.
   *
   * The naive version — `setInterval(refresh, 400)` — runs forever, per node,
   * regardless of whether anything could have changed. Measured on an 8-node
   * Context chain carrying 96 variables: 0.59ms per refresh. That is small
   * alone and it is not what it costs, because EVERY node walks its whole
   * upstream chain, so a series chain is quadratic in total work and this is
   * the shape people build. Nine nodes already produce a visible long task.
   *
   * Two gates, both of which cost nothing when the user is actually working:
   *
   * 1. A hidden tab skips entirely. Nobody can observe a stale widget on a
   *    tab they are not looking at, and browsers already throttle background
   *    intervals — so this is work that was being done specifically at the
   *    moment it was least useful. A single catch-up refresh runs on the way
   *    back to visible.
   * 2. A still canvas backs off. The fallback covers edits that fire no
   *    event, which cannot happen while nobody is editing, so after ~4s of no
   *    pointer, key or wheel activity AND no observed change, the period
   *    lengthens 3x, then 8x. Any real change or any user activity snaps it
   *    straight back to the base rate.
   *
   * The event paths — `onConnectionsChange`, the mode intercept, graph load —
   * are untouched and still fire instantly. Only the fallback slows, and only
   * while nothing is happening.
   */
  const stopPoll = startAdaptivePoll(pollMs, () => {
    const before = state.value;
    refresh();
    return equals(before, state.value) ? "quiet" : "changed";
  });

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
    stopPoll();
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
