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
 *      is preloaded by `main.ts` like every other widget chunk.
 */
import { computed, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import RichTextInput from "../manager/components/RichTextInput.vue";
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

type EditorNode = LiteNodeLike & MountTargetNode;

const PLACEHOLDER = "A $style portrait of $subject";

export function create(node: EditorNode, inputName: string) {
  // Mirrors ComfyUI's stored value into something Vue tracks. `host.setValue`
  // alone is not enough: it writes the plain `state` string the widget
  // serializes from, and nothing would re-render.
  const model = ref("");

  const editorRef = ref<{ insertTextAtCaret?: (t: string) => void } | null>(null);

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
        if (!g) return new Map<string, VarProducer>();
        return new Map(Object.entries(collectUpstreamProducers(g, node)));
      });

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
          ariaLabel: "Prompt template",
          "onUpdate:modelValue": (v: string) => {
            model.value = v;
            editorHost.setValue(v);
          },
        });
    },
  };

  const editorHost = createDomWidgetHost(node, inputName, wrapper, {
    // The one widget on the node that keeps its socket — see the file
    // header. Without this the template input could no longer be driven
    // by another node's STRING output.
    socketed: true,
    minHeight: 96,
    minWidth: 300,
    // Deliberately NOT `autoHeight`. That flag means "always follow content
    // height, ignore the user's drag", and it was copied here from the Context
    // and Injector widgets without their reason for it: those need it because a
    // node stuck at a manually-set tall height breaks their collapse animation.
    // This widget has no collapse animation, and the flag was actively hostile
    // — it is the branch that makes `pushSize` discard a user height:
    //
    //   const userControlsHeight = !options.autoHeight && …
    //   const rawTargetH = userControlsHeight ? Math.max(cur[1], min[1]) : min[1];
    //
    // With it off, the default path already does what a template editor wants:
    // preserve whatever height the user settled on, and grow only when the
    // content genuinely needs more room.
    // Fired by ComfyUI's own value setter, i.e. workflow load and undo.
    onValueRestored: (v: string) => { model.value = v; },
  });

  model.value = editorHost.getValue();
  attachThemeDetector(editorHost.widget.element, app);

  // Published for the assembler helper's chip strip, which is a different
  // widget and has no other way to insert at this editor's caret.
  templateInsertAtCaret.set(node, (token: string) => {
    editorRef.value?.insertTextAtCaret?.(token);
  });

  // ComfyUI destructures `{widget, minHeight}` off whatever the factory
  // returns, so hand back the whole host — same contract every other WP
  // widget's `create` follows.
  return editorHost;
}
