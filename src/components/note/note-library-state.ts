/**
 * Live state for a note's `wp:library` buttons: while the note's text has
 * one, the note follows the library (the shared drift-store poll) and
 * re-reads the canvas every couple of seconds, so the button's tooltip and
 * its on/off state stay true as rows are added or saved.
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { app } from "#comfyui/app";
import { subscribe, unsubscribe } from "../context/drift-store";
import { canvasContexts, libraryKnown, liveVerdicts } from "./note-library-graph";
import { buildPlan, buttonHint } from "./note-library-plan";
import type { ContextChoice, LibraryButtonState, NoteActions } from "./note-actions";

const TICK_MS = 2000;

export function useNoteLibrary(text: () => string, editing: () => boolean): { actions: NoteActions; contexts: Ref<ContextChoice[]> } {
  const tick = ref(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let subscribed = false;
  // The editor's Context picker needs the list too, so editing follows the canvas.
  const wanted = computed(() => /\]\(wp:library/i.test(text()) || editing());

  function start(): void {
    if (subscribed) return;
    subscribed = true;
    subscribe();
    timer = setInterval(() => { tick.value++; }, TICK_MS);
  }
  function stop(): void {
    if (!subscribed) return;
    subscribed = false;
    unsubscribe();
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  watch(wanted, (on) => (on ? start() : stop()), { immediate: true });
  onBeforeUnmount(stop);

  const contexts = computed<ContextChoice[]>(() => {
    void tick.value;
    if (!wanted.value) return [];
    return canvasContexts(app.graph).map((c) => ({ value: c.key, label: c.label }));
  });

  const states = computed(() => {
    void tick.value;
    const out = new Map<string, LibraryButtonState>();
    if (!wanted.value) return (): LibraryButtonState => ({ ready: false, hint: "" });
    const known = libraryKnown();
    const all = canvasContexts(app.graph);
    const get = (node: string): LibraryButtonState => {
      const cached = out.get(node);
      if (cached) return cached;
      let state: LibraryButtonState;
      const scoped = node ? all.filter((c) => c.key === node) : all;
      if (!known) state = { ready: false, hint: "Checking your library…" };
      else if (node && scoped.length === 0) state = { ready: false, hint: "That WP Context isn't on this canvas" };
      else if (scoped.length === 0) state = { ready: false, hint: "This workflow has no WP Context" };
      else {
        // Ids only matter when installing; distinct ones keep unlinked bundles apart.
        let n = 0;
        const plan = buildPlan(scoped, liveVerdicts, () => `count-${n++}`);
        state = { ready: plan.items.length > 0, hint: buttonHint(plan, node ? "context" : "workflow") };
      }
      out.set(node, state);
      return state;
    };
    return get;
  });

  const actions: NoteActions = {
    library: (node) => states.value(node),
    runLibrary: (node) => {
      void import("./note-library-action").then((m) => m.runLibraryInstall(node));
    },
  };
  return { actions, contexts };
}
