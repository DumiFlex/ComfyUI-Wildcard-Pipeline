import { defineAsyncComponent, h, onScopeDispose, watch, type Component } from "vue";
import { createDomWidgetHost, type MountTargetNode } from "./_shared";
import { reactiveFromGraph, watchModes } from "../extension/reactive";
import {
  NODE_GROUP_OUTPUT,
  NODE_GROUP_TYPE,
  members,
  modeName,
  nextInputName,
  setMembersMode,
  stabilizeInputs,
  type GroupHostNode,
  type MemberMode,
} from "../extension/node-group";
import { MODE_ALWAYS, MODE_BYPASS, MODE_NEVER, setMode } from "../extension/toggle-control";
import type { MemberView } from "../components/node-group/NodeGroupWidget.vue";

const NodeGroupWidget = defineAsyncComponent(() => import("../components/node-group/NodeGroupWidget.vue"));

interface GroupNode extends MountTargetNode, GroupHostNode {
  size: [number, number] | number[];
  addOutput?: (name: string, type: string) => unknown;
  setDirtyCanvas?: (fg: boolean, bg?: boolean) => void;
}

type NodeBase = new (title?: string) => GroupNode;

interface LiteGraphStatic {
  LGraphNode?: NodeBase;
  registerNodeType?: (type: string, ctor: unknown) => void;
}

/** Groups whose mode a workflow load just set: that is not a change to
 *  repeat. Cleared by the first change seen, or soon after the load. */
const justLoaded = new WeakSet<GroupNode>();

const MODE_OF: Record<MemberMode, number> = { on: MODE_ALWAYS, muted: MODE_NEVER, bypassed: MODE_BYPASS };

function view(node: GroupNode): MemberView[] {
  return members(node).map((m) => ({ id: m.id, title: m.title || `#${m.id}`, mode: modeName(m.mode) }));
}

function sameView(a: MemberView[], b: MemberView[]): boolean {
  return a.length === b.length && a.every((m, i) => m.id === b[i]?.id && m.title === b[i]?.title && m.mode === b[i]?.mode);
}

/** Mount the members panel; the node itself holds no value. */
export function mountNodeGroup(node: GroupNode) {
  const wrapper: Component = {
    setup() {
      const graphNode = node as unknown as Parameters<typeof reactiveFromGraph>[0];
      const list = reactiveFromGraph(graphNode, () => view(node), sameView);
      const own = reactiveFromGraph(graphNode, () => modeName(node.mode), Object.is);
      // Repeater: muting / bypassing this node repeats to its members, and
      // setting it back lets them run. Only a change does (never a load).
      watch(own, (mode) => {
        if (justLoaded.has(node)) {
          justLoaded.delete(node);
          return;
        }
        setMembersMode(node, MODE_OF[mode]);
        list.value = view(node);
      }, { flush: "sync" });
      // A member muted or bypassed from anywhere (a relay, a toggle, Ctrl+M)
      // shows at once, not on the next poll.
      const modes = watchModes(() => members(node), () => {
        const next = view(node);
        if (!sameView(list.value, next)) list.value = next;
      });
      watch(list, () => modes.sync());
      onScopeDispose(() => modes.stop());
      function setMember(id: number | string, mode: MemberMode): void {
        const m = members(node).find((x) => x.id === id);
        if (m) setMode(m, MODE_OF[mode]);
        list.value = view(node);
        node.setDirtyCanvas?.(true, true);
      }
      function setAll(mode: MemberMode): void {
        setMembersMode(node, MODE_OF[mode]);
        list.value = view(node);
        node.setDirtyCanvas?.(true, true);
      }
      return () => h(NodeGroupWidget, {
        members: list.value,
        groupMode: own.value,
        onSetMember: setMember,
        onSetAll: setAll,
      });
    },
  };
  return createDomWidgetHost(node, "wp_node_group", wrapper, {
    initialValue: "",
    minHeight: 40,
    minWidth: 240,
    autoHeight: true,
  });
}

/**
 * Registers WP Node Group: a frontend-only node (see
 * `extension/node-group.ts`). Virtual, so it never runs and is left out of
 * the prompt; its links are saved with the workflow.
 */
export function registerNodeGroupNode(): void {
  const lg = (globalThis as { LiteGraph?: LiteGraphStatic }).LiteGraph;
  const Base = lg?.LGraphNode;
  if (!lg?.registerNodeType || !Base) return;

  class WPNodeGroupNode extends Base {
    static title = "WP Node Group";
    static category = "wildcard-pipeline";
    isVirtualNode = true;
    serialize_widgets = false;

    constructor(title?: string) {
      super(title ?? "WP Node Group");
      this.addInput?.(nextInputName(this), "*");
      this.addOutput?.("nodes", NODE_GROUP_OUTPUT);
      mountNodeGroup(this);
      this.size = [280, 90];
    }

    // The prompt builder asks a virtual node what feeds an output: nothing,
    // so a toggle's control link never pulls a member into the prompt.
    getInputLink(): null {
      return null;
    }

    onConfigure(): void {
      justLoaded.add(this);
      setTimeout(() => justLoaded.delete(this), 1500);
    }

    onConnectionsChange(): void {
      // After the host finishes the change (and after a load's configure).
      queueMicrotask(() => {
        if (this.graph && stabilizeInputs(this)) this.setDirtyCanvas?.(true, true);
      });
    }
  }
  lg.registerNodeType(NODE_GROUP_TYPE, WPNodeGroupNode);
}

export { NODE_GROUP_TYPE };
