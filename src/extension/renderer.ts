/**
 * Which node renderer ComfyUI is currently using.
 *
 * ComfyUI 0.28 ships two: the legacy canvas painter and "Nodes 2.0", a Vue
 * renderer that draws each node as real DOM. They differ in ways that matter
 * to us — `computeSize` is never consulted, `node.size[0]` is a floor rather
 * than a width, and slots are DOM rows instead of canvas paint — so a handful
 * of places need to branch.
 *
 * Read live, never cache: the setting (`Comfy.VueNodes.Enabled`) is
 * user-togglable, and while the switch currently forces a reload, nothing
 * about our code should depend on that staying true.
 */
export function isVueNodes(): boolean {
  return (globalThis as { LiteGraph?: { vueNodesMode?: boolean } })
    .LiteGraph?.vueNodesMode === true;
}
