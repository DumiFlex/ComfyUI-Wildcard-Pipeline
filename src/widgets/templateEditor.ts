/**
 * The assembler's `template` input, rendered by our own editor.
 *
 * This is NOT a new widget. It is the same `template` widget the node has
 * always had — same name, same position in `widgets_values`, same plain
 * string value — with a different renderer. `wp_nodes/assembler_node.py`
 * tags the input spec with `widgetType: "WP_TEMPLATE_EDITOR"`, which is the
 * key the frontend uses to pick a widget constructor; the socket type stays
 * `STRING`. So a workflow saved before this change loads its template back
 * without a migration, and a STRING link into the input keeps working.
 *
 * Two things earn the extra file rather than folding into `assembler.ts`:
 *
 *   1. The link input. ComfyUI adds an input socket for a custom widget only
 *      when the widget the factory returns has no `socketless` flag, which
 *      is why this is the one place that passes `socketed: true`. The helper
 *      widget must stay socketless — it is an editor, not a value.
 *   2. `getCustomWidgets` factories must return synchronously, so the module
 *      is preloaded by `main.ts` (through `boot.ts`) like every other widget
 *      glue file. The editor itself stays lazy, as every other widget's SFC
 *      does, so a canvas with no assembler never downloads it.
 *
 * Send-to-negative: the node's `negative_template` input carries the same
 * `widgetType`, so `create` runs for it too and picks its variant from
 * `inputName` (see {@link editorVariant}). The negative box is collapsible,
 * offers the reserved `$negatives` slot, and keeps its socket like the prompt
 * template does.
 */
import { computed, defineAsyncComponent, h, nextTick, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type MountTargetNode } from "./_shared";
import { attachThemeDetector } from "../extension/theme-detector";
import { templateInsertAtCaret } from "../extension/_stashes";
import {
  collectUpstreamProducers,
  collectUpstreamRenderableVariables,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
  type VarProducer,
} from "../extension/graph";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";
import { NEGATIVES_VAR } from "../extension/assembler-vars";

type EditorNode = LiteNodeLike & MountTargetNode;

const RichTextInput = defineAsyncComponent(() => import("../manager/components/RichTextInput.vue"));
const NegativeTemplateBox = defineAsyncComponent(() => import("../components/assembler/NegativeTemplateBox.vue"));

const PLACEHOLDER = "A $style portrait of $subject";

/** The Assembler input that holds the negative template. */
export const NEGATIVE_TEMPLATE_INPUT = "negative_template";
/** `node.properties` key persisting the negative box's open/closed state. */
export const NEGATIVE_COLLAPSED_PROP = "wp_negative_collapsed";

/** Heights of the negative box (px, on the LiteGraph 10px grid). They match
 *  the fixed heights in `NegativeTemplateBox.vue`. */
const NEG_BOX_COLLAPSED_H = 30;
const NEG_BOX_OPEN_H = 100;

export interface EditorVariant {
  negative: boolean;
  ariaLabel: string;
  placeholder: string;
  /** Names offered on top of the upstream ones (never flagged unknown). */
  reservedVars: string[];
}

/** Which editor an input gets. Anything but `negative_template` is the
 *  prompt template, so a renamed or future input degrades to the known one. */
export function editorVariant(inputName: string): EditorVariant {
  if (inputName === NEGATIVE_TEMPLATE_INPUT) {
    return {
      negative: true,
      ariaLabel: "Negative template",
      placeholder: "$negatives",
      reservedVars: [NEGATIVES_VAR],
    };
  }
  return { negative: false, ariaLabel: "Prompt template", placeholder: PLACEHOLDER, reservedVars: [] };
}

/** Whether the negative box starts collapsed: the saved choice when there is
 *  one, else collapsed exactly when the box is empty. */
export function initialNegativeCollapsed(
  properties: Record<string, unknown> | undefined,
  value: string,
): boolean {
  const saved = properties?.[NEGATIVE_COLLAPSED_PROP];
  if (typeof saved === "boolean") return saved;
  return !value.trim();
}

/** Hover card for `$negatives`: it is filled by this Assembler, not written
 *  by anything upstream. */
function reservedProducer(node: EditorNode): VarProducer {
  return {
    kind: "negatives",
    nodeId: String((node as { id?: unknown }).id ?? ""),
    nodeLabel: "this Assembler",
    moduleName: "negatives of the variables the prompt uses",
    shadowed: 0,
  };
}

export function create(node: EditorNode, inputName: string) {
  // Mirrors ComfyUI's stored value into something Vue tracks. `host.setValue`
  // alone is not enough: it writes the plain `state` string the widget
  // serializes from, and nothing would re-render.
  const model = ref("");

  const editorRef = ref<{ insertTextAtCaret?: (t: string) => void } | null>(null);
  const variant = editorVariant(inputName);
  const nodeProps = (): Record<string, unknown> => {
    const n = node as { properties?: Record<string, unknown> };
    if (!n.properties) n.properties = {};
    return n.properties;
  };
  // Set once the stored value is known (below), before the first render.
  const collapsed = ref(false);

  const wrapper: Component = {
    setup() {
      // `app.graph` is the SUBGRAPH when the user is inside one, so climb
      // from the node's own graph — same rationale as `widgets/context.ts`.
      const rootGraph = (): LiteGraphLike | null => {
        const start =
          (node as unknown as { graph?: LiteGraphLike }).graph
          ?? (app.graph as unknown as LiteGraphLike);
        return findRootGraph(start);
      };

      // `$` suggestions are the upstream names that will actually SUBSTITUTE
      // here. Deliberately not the full upstream set: WP_PromptAssembler runs
      // `strip_internals` before resolving, so a `$var` naming a variable the
      // user flagged internal renders as nothing. Offering `$iteration` and
      // the `*_bool` toggles — which is what the unfiltered list did, and they
      // outnumbered the real ones — is offering tokens guaranteed to be no-ops.
      // They still travel the socket for Combine / Derivation to read; it is
      // the PROMPT surface specifically that must not suggest them.
      const varNames = reactiveFromGraph<string[]>(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const g = rootGraph();
          return g ? collectUpstreamRenderableVariables(g, node) : [];
        },
        stringArrayEqual,
      );

      // A link into the `template` input overrides whatever is typed here at
      // runtime, so the editor must stop accepting edits — the stock
      // multiline widget goes read-only in the same situation.
      //
      // Derived from the link itself rather than from the widget's
      // `computedDisabled`: that flag is recomputed lazily during a draw, so
      // it still read `true` a full second after the link was removed.
      const linkDriven = reactiveFromGraph<boolean>(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const inputs = (node as unknown as { inputs?: { name: string; link?: number | null }[] }).inputs;
          const slot = inputs?.find((i) => i.name === inputName);
          return slot?.link != null;
        },
        Object.is,
      );

      // Attribution for the `$var` hover card ("written by <module> on
      // <node>"). Recomputed from the name list rather than polled on its
      // own: the two always change together, and a second gated snapshot
      // would only add graph walks.
      const varProducers = computed(() => {
        void varNames.value;
        const g = rootGraph();
        const map = g
          ? new Map(Object.entries(collectUpstreamProducers(g, node)))
          : new Map<string, VarProducer>();
        for (const name of variant.reservedVars) map.set(name, reservedProducer(node));
        return map;
      });
      // Reserved names lead the list and are never "unknown".
      const suggestions = computed(() =>
        variant.reservedVars.length
          ? [...variant.reservedVars, ...varNames.value.filter((v) => !variant.reservedVars.includes(v))]
          : varNames.value,
      );

      if (variant.negative) {
        return () =>
          h(NegativeTemplateBox, {
            modelValue: model.value,
            collapsed: collapsed.value,
            linked: linkDriven.value,
            varSuggestions: suggestions.value,
            varProducers: varProducers.value,
            "onUpdate:modelValue": (v: string) => {
              model.value = v;
              editorHost.setValue(v);
            },
            onToggle: () => toggleCollapsed(),
          });
      }

      return () =>
        h(RichTextInput, {
          ref: editorRef,
          modelValue: model.value,
          // The engine resolves `$var` reads here and nothing else: no
          // `@{uuid}` refs (the assembler has no catalog to resolve them
          // against) and no wildcard syntax. Booru tag suggestions ride
          // along on every surface that takes free prompt text.
          surface: "assembler",
          multiline: true,
          rows: 5,
          fill: true,
          placeholder: linkDriven.value
            ? "Driven by the connected input — disconnect it to edit here."
            : PLACEHOLDER,
          disabled: linkDriven.value,
          varSuggestions: varNames.value,
          varProducers: varProducers.value,
          // We walked a graph, so an unattributed `$var` means "nothing
          // upstream writes this" — actionable — rather than "this host
          // cannot know", which is the SPA's situation.
          graphAware: true,
          ariaLabel: variant.ariaLabel,
          "onUpdate:modelValue": (v: string) => {
            model.value = v;
            editorHost.setValue(v);
          },
        });
    },
  };

  /** Open/close the negative box and move the node's height by exactly the
   *  box's change, so a node the user sized keeps its prompt editor size. */
  function toggleCollapsed(): void {
    const sized = node as unknown as {
      size?: number[];
      computeSize?: () => number[];
      setSize?: (s: number[]) => void;
      setDirtyCanvas?: (a: boolean, b: boolean) => void;
    };
    const startH = sized.size?.[1];
    const next = !collapsed.value;
    collapsed.value = next;
    nodeProps()[NEGATIVE_COLLAPSED_PROP] = next;
    const delta = next ? NEG_BOX_COLLAPSED_H - NEG_BOX_OPEN_H : NEG_BOX_OPEN_H - NEG_BOX_COLLAPSED_H;
    // After the DOM settles AND the host's ResizeObserver has re-measured the
    // box (it updates the minimum the node's computeSize reports).
    void nextTick(() => {
      setTimeout(() => {
        if (startH == null || !sized.size || !sized.setSize) return;
        const min = sized.computeSize?.()?.[1] ?? 0;
        sized.setSize([sized.size[0], Math.max(min, startH + delta)]);
        sized.setDirtyCanvas?.(true, true);
      }, 50);
    });
  }

  const editorHost = variant.negative
    ? createDomWidgetHost(node, inputName, wrapper, {
        // Keeps its socket like the prompt template: a STRING link can drive
        // the negative too.
        socketed: true,
        minHeight: NEG_BOX_COLLAPSED_H,
        minWidth: 300,
        // Content-sized (the box's height is fixed per state) and capped at
        // that size, so spare node height flows to the prompt editor.
        fitContent: true,
        onValueRestored: (v: string) => { model.value = v; },
      })
    : createDomWidgetHost(node, inputName, wrapper, {
    // The one widget on the node that keeps its socket — see the file
    // header. Without this the template input could no longer be driven
    // by another node's STRING output.
    socketed: true,
    minHeight: 96,
    minWidth: 300,
    /* The NODE's corner is the only resize control.
     *
     * There used to be a second one — a drag grip inside the editor — and two
     * authorities over one box is what produced both reported failures: a drag
     * that never ended and stayed glued to the cursor, and a node that fought
     * the editor over its height. Three rounds of arbitrating between them
     * (dropping `autoHeight`, gating grip-follow, re-arming the height cap)
     * each fixed a real defect and none fixed the symptom.
     *
     * `fillHost` removes the second authority instead: the node owns the
     * height, the editor fills whatever box it is given, and the text scrolls.
     * It also skips the content-size ResizeObserver entirely and takes our
     * subtree out of flow, so the template can no longer push the node taller —
     * the auto-scaling that made a deliberately-sized node spring back.
     *
     * `minHeight` is still the floor a node can be dragged down to: out-of-flow
     * content measures zero, so without a declared minimum the node collapses.
     */
    fillHost: true,
    // Fired by ComfyUI's own value setter, i.e. workflow load and undo.
    onValueRestored: (v: string) => { model.value = v; },
  });

  model.value = editorHost.getValue();
  collapsed.value = initialNegativeCollapsed(
    (node as { properties?: Record<string, unknown> }).properties,
    model.value,
  );
  attachThemeDetector(editorHost.widget.element, app);

  // Published for the assembler helper's chip strip, which is a different
  // widget and has no other way to insert at this editor's caret. The chips
  // insert into the PROMPT template only.
  if (!variant.negative) {
    templateInsertAtCaret.set(node, (token: string) => {
      editorRef.value?.insertTextAtCaret?.(token);
    });
  }

  // ComfyUI destructures `{widget, minHeight}` off whatever the factory
  // returns, so hand back the whole host — same contract every other WP
  // widget's `create` follows.
  return editorHost;
}
