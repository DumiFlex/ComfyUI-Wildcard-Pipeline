/**
 * Run errors of WP nodes, shown on the node itself.
 *
 * When a WP node raises during a run (Var → Choice set to "Stop the run",
 * a broken modules JSON …), ComfyUI sends `execution_error` over the
 * websocket. Some frontends only flash "Job failed" for a few seconds and
 * show the reason nowhere, so we keep the message per node here:
 *
 *  - `installRunErrors(api, resolve)` listens once (from `main.ts`):
 *    `execution_error` for a `WP_*` node stores its message and pushes one
 *    error toast; `executing` / `execution_cached` for that node (the next
 *    run reaching it) clears it again.
 *  - `runErrorOf(node)` is reactive: the widget host draws a strip for it
 *    (`widgets/_shared.ts`), Var → Choice paints its last-execute row red
 *    (`widgets/var_picker.ts`).
 *
 * Pure apart from the toast store: no ComfyUI imports, so it is tested
 * with a fake api and the manager build can import it through `_shared`.
 */
import { ref } from "vue";
import { pushToast } from "../components/shared/toast-store";

export interface RunError {
  /** The exception message without the node-name prefix. */
  message: string;
  /** The message as the toast showed it (node name in front). */
  full: string;
}

const errors: WeakMap<object, RunError> = new WeakMap();
/** Nodes holding an error, so `executing` can find them by id. */
const holders: Set<object> = new Set();
/** Bumped on every change; `runErrorOf` reads it so callers re-render. */
const revision = ref(0);

export function runErrorOf(node: object | null | undefined): RunError | null {
  void revision.value;
  if (!node) return null;
  return errors.get(node) ?? null;
}

/** "WP Var → Choice: The variable is empty" → "The variable is empty". */
export function stripNodePrefix(message: string): string {
  const m = /^WP [^:\n]{1,40}:\s*/.exec(message);
  return m ? message.slice(m[0].length) : message;
}

export function setRunError(node: object, message: string, title = ""): RunError {
  const text = message.trim() || "The node stopped the run.";
  const full = /^WP [^:\n]{1,40}:/.test(text) || !title ? text : `${title}: ${text}`;
  const err: RunError = { message: stripNodePrefix(text), full };
  errors.set(node, err);
  holders.add(node);
  revision.value++;
  return err;
}

export function clearRunError(node: object | null | undefined): void {
  if (!node || !errors.has(node)) return;
  errors.delete(node);
  holders.delete(node);
  revision.value++;
}

/** Forget every error (tests). */
export function resetRunErrors(): void {
  for (const n of holders) errors.delete(n);
  holders.clear();
  revision.value++;
}

type Listener = (e: Event) => void;
export interface RunErrorApi {
  addEventListener?: (name: string, fn: Listener) => void;
}

interface NodeLike {
  type?: string;
  comfyClass?: string;
  title?: string;
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void;
}

/** Finds a node from its execution id ("12", or "12:5" inside a subgraph). */
export type ResolveNode = (executionId: string) => NodeLike | null;

interface ErrorDetail {
  node_id?: unknown;
  node_type?: unknown;
  exception_message?: unknown;
}

let installed = false;

/** Listen to ComfyUI's run events once. `resolve` maps an execution id to
 *  the node on the canvas. */
export function installRunErrors(api: RunErrorApi | undefined, resolve: ResolveNode): void {
  if (installed || !api?.addEventListener) return;
  installed = true;
  const clearId = (id: unknown): void => {
    if (holders.size === 0 || (typeof id !== "string" && typeof id !== "number")) return;
    const node = resolve(String(id));
    if (node && errors.has(node)) {
      clearRunError(node);
      node.setDirtyCanvas?.(true, false);
    }
  };
  api.addEventListener("executing", (e) => {
    const d = (e as CustomEvent).detail as unknown;
    // Older frontends send the id itself, newer ones `{ node }`.
    clearId(d && typeof d === "object" ? (d as { node?: unknown }).node : d);
  });
  api.addEventListener("execution_cached", (e) => {
    const nodes = ((e as CustomEvent).detail as { nodes?: unknown } | undefined)?.nodes;
    if (Array.isArray(nodes)) for (const id of nodes) clearId(id);
  });
  api.addEventListener("execution_error", (e) => {
    const d = (e as CustomEvent).detail as ErrorDetail | undefined;
    if (!d || (typeof d.node_id !== "string" && typeof d.node_id !== "number")) return;
    const type = typeof d.node_type === "string" ? d.node_type : "";
    if (!type.startsWith("WP_")) return;
    const node = resolve(String(d.node_id));
    const message = typeof d.exception_message === "string" ? d.exception_message : "";
    const title = node?.title || type;
    const err = node ? setRunError(node, message, title) : { full: message.trim() || `${title} stopped the run.` };
    node?.setDirtyCanvas?.(true, false);
    pushToast(err.full, { severity: "error", singletonKey: `wp-run-error-${String(d.node_id)}` });
  });
}

interface GraphLike {
  getNodeById?: (id: string | number) => unknown;
}

/** The node an execution id names, walking into subgraphs: "12:5" is node
 *  5 inside the subgraph of root node 12. */
export function nodeForExecutionId(root: GraphLike | null | undefined, id: string): NodeLike | null {
  let graph: GraphLike | null | undefined = root;
  let node: unknown = null;
  for (const part of id.split(":")) {
    if (!graph?.getNodeById) return null;
    node = graph.getNodeById(part) ?? (/^\d+$/.test(part) ? graph.getNodeById(Number(part)) : null);
    if (!node || typeof node !== "object") return null;
    graph = (node as { subgraph?: GraphLike }).subgraph;
  }
  return node as NodeLike;
}

/** Test hook: let `installRunErrors` run again. */
export function _resetInstalled(): void {
  installed = false;
}
