/**
 * Our buttons in ComfyUI's selection toolbar (the bar over a selected node):
 *
 *   - "?" opens the node's docs page in a dialog over the canvas, for every
 *     WP node (`NodeHelpDialog.vue`, mounted by `main.ts` on first use);
 *   - a pencil opens the node's edit view, for nodes that have one
 *     (registered in `nodeEditors` by their widget glue).
 *
 * Both are drawn as a filled accent-coloured dot (`node-toolbar.css`) so
 * they read as Wildcard Pipeline's and not ComfyUI's. The toolbar shows a
 * command once for the whole selection; it acts on the first selected node
 * it applies to. Works the same in classic LiteGraph and Nodes 2.0.
 */
import { ref } from "vue";
import { nodeEditors } from "./_stashes";

export const HELP_COMMAND = "wildcardPipeline.node.help";
export const EDIT_COMMAND = "wildcardPipeline.node.edit";

/** Node type → its page in the manager docs (`/wp/docs/<page>`). Kept in
 *  step with `manager/docs/registry.ts` (`node-toolbar.test.ts`). */
export const NODE_DOC_PAGES: Readonly<Record<string, string>> = {
  WP_Context: "wp-context",
  WP_ContextLoop: "wp-context-loop",
  WP_SeedList: "wp-seed-list",
  WP_ContextInjector: "wp-context-injector",
  WP_ModelInfo: "wp-model-info",
  WP_Toggles: "wp-toggles",
  WP_NodeGroup: "wp-node-group",
  WP_ModeRelay: "wp-mode-relay",
  WP_Bookmark: "wp-bookmark",
  WP_PromptAssembler: "wp-prompt-assembler",
  WP_PromptCleaner: "wp-prompt-cleaner",
  WP_ImageFilter: "wp-image-filter",
  WP_LabelGrid: "wp-label-grid",
  WP_Debug: "wp-debug",
  WP_VarToInt: "wp-var-to-int",
  WP_VarToFloat: "wp-var-to-float",
  WP_VarToBool: "wp-var-to-bool",
  WP_VarToChoice: "wp-var-to-choice",
  WP_Note: "wp-note",
};

interface ToolbarNode {
  type?: string;
  title?: string;
}

/** The docs page for a node, or null when it isn't one of ours. */
export function docPageFor(item: unknown): string | null {
  const type = (item as ToolbarNode | null)?.type;
  return typeof type === "string" ? NODE_DOC_PAGES[type] ?? null : null;
}

/** Whether a node has an edit view the pencil can open. */
export function canEdit(item: unknown): boolean {
  return typeof item === "object" && item !== null && nodeEditors.has(item);
}

/** `getSelectionToolboxCommands`: the pencil first (when it applies), then "?". */
export function toolboxCommandsFor(item: unknown): string[] {
  const out: string[] = [];
  if (canEdit(item)) out.push(EDIT_COMMAND);
  if (docPageFor(item)) out.push(HELP_COMMAND);
  return out;
}

/** What the help dialog shows; null while it is closed. */
export interface HelpTarget {
  page: string;
  title: string;
}
export const helpTarget = ref<HelpTarget | null>(null);

/** Open the help dialog on `page` (a manager docs page id). */
export function openHelp(page: string, title: string): void {
  helpTarget.value = { page, title };
}

interface SelectionCanvas {
  selected_nodes?: Record<string, unknown> | null;
  selectedItems?: Iterable<unknown> | null;
}

/** The selected items, in selection order, from either canvas API. */
export function selectedItems(canvas: SelectionCanvas | null | undefined): unknown[] {
  if (!canvas) return [];
  if (canvas.selectedItems) return [...canvas.selectedItems];
  return Object.values(canvas.selected_nodes ?? {});
}

/** Run "?" on the selection: the first node with a docs page. */
export function helpForSelection(canvas: SelectionCanvas | null | undefined): boolean {
  const node = selectedItems(canvas).find((n) => docPageFor(n));
  const page = docPageFor(node);
  if (!page) return false;
  const n = node as ToolbarNode;
  openHelp(page, n.title || n.type || "Help");
  return true;
}

/** Run the pencil on the selection: the first node with an edit view. */
export function editSelection(canvas: SelectionCanvas | null | undefined): boolean {
  const node = selectedItems(canvas).find(canEdit);
  if (!node) return false;
  nodeEditors.get(node as object)?.();
  return true;
}

/** Icon classes: a PrimeIcons glyph on our accent dot (`node-toolbar.css`). */
export const HELP_ICON = "pi pi-question wp-tb-icon wp-tb-icon--help";
export const EDIT_ICON = "pi pi-pencil wp-tb-icon wp-tb-icon--edit";

/** The two commands, registered with the extension's `commands`. */
export function toolbarCommands(getCanvas: () => SelectionCanvas | null | undefined) {
  return [
    { id: HELP_COMMAND, label: "Wildcard Pipeline help for this node", icon: HELP_ICON, function: () => void helpForSelection(getCanvas()) },
    { id: EDIT_COMMAND, label: "Edit this Wildcard Pipeline node", icon: EDIT_ICON, function: () => void editSelection(getCanvas()) },
  ];
}
