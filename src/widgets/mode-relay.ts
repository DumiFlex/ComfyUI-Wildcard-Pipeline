import { defineAsyncComponent, h, onScopeDispose, ref, watch, type Component } from "vue";
import { createDomWidgetHost, type MountTargetNode } from "./_shared";
import { reactiveFromGraph, watchModes } from "../extension/reactive";
import { nextInputName, stabilizeInputs } from "../extension/node-group";
import {
  MODE_RELAY_TYPE,
  RELAY_PROP,
  combinedState,
  parseRelayMap,
  relay,
  relayTargets,
  watched,
  type RelayMap,
  type RelayNode,
} from "../extension/mode-relay";
import { NODE_GROUP_OUTPUT } from "../extension/node-group";

const ModeRelayWidget = defineAsyncComponent(() => import("../components/mode-relay/ModeRelayWidget.vue"));

interface RelayHostNode extends MountTargetNode, RelayNode {
  size: [number, number] | number[];
  properties?: Record<string, unknown>;
  addOutput?: (name: string, type: string) => unknown;
  setDirtyCanvas?: (fg: boolean, bg?: boolean) => void;
}

type NodeBase = new (title?: string) => RelayHostNode;

interface LiteGraphStatic {
  LGraphNode?: NodeBase;
  registerNodeType?: (type: string, ctor: unknown) => void;
}

/** Relays a workflow load just configured: the first state seen is the
 *  saved one, not a change to pass on. */
const justLoaded = new WeakSet<RelayHostNode>();

export function mountModeRelay(node: RelayHostNode) {
  const map = ref<RelayMap>(parseRelayMap(node.properties?.[RELAY_PROP]));
  const wrapper: Component = {
    setup() {
      const graphNode = node as unknown as Parameters<typeof reactiveFromGraph>[0];
      const state = reactiveFromGraph(graphNode, () => combinedState(watched(node).map((n) => n.mode)), Object.is);
      const counts = reactiveFromGraph(
        graphNode,
        () => `${watched(node).length}:${relayTargets(node).length}`,
        Object.is,
      );
      // A saved map arrives with the workflow, after the node is built.
      const saved = reactiveFromGraph(graphNode, () => JSON.stringify(node.properties?.[RELAY_PROP] ?? null), Object.is);
      watch(saved, () => {
        map.value = parseRelayMap(node.properties?.[RELAY_PROP]);
      });
      // Hear the watched nodes' mode changes at once (not on the poll), and
      // follow the wires as they change.
      const modes = watchModes(() => watched(node), () => {
        state.value = combinedState(watched(node).map((n) => n.mode));
      });
      watch(counts, () => modes.sync());
      onScopeDispose(() => modes.stop());
      watch(state, (now) => {
        if (justLoaded.has(node)) {
          justLoaded.delete(node);
          return;
        }
        if (relay(node, now, map.value)) node.setDirtyCanvas?.(true, true);
      }, { flush: "sync" });
      function setMap(next: RelayMap): void {
        map.value = next;
        node.properties = { ...(node.properties ?? {}), [RELAY_PROP]: next };
        // A new rule applies to what the watched nodes do now, not only to
        // their next change.
        if (relay(node, state.value, next)) node.setDirtyCanvas?.(true, true);
      }
      return () => {
        const [watching, driving] = counts.value.split(":").map(Number);
        return h(ModeRelayWidget, {
          map: map.value,
          watching: watching ?? 0,
          driving: driving ?? 0,
          state: state.value,
          "onUpdate:map": setMap,
        });
      };
    },
  };
  return createDomWidgetHost(node, "wp_mode_relay", wrapper, {
    initialValue: "",
    minHeight: 40,
    minWidth: 300,
    autoHeight: true,
  });
}

/**
 * Registers WP Mode Relay (see `extension/mode-relay.ts`): frontend only,
 * never runs, left out of the prompt.
 */
export function registerModeRelayNode(): void {
  const lg = (globalThis as { LiteGraph?: LiteGraphStatic }).LiteGraph;
  const Base = lg?.LGraphNode;
  if (!lg?.registerNodeType || !Base) return;

  class WPModeRelayNode extends Base {
    static title = "WP Mode Relay";
    static category = "wildcard-pipeline";
    isVirtualNode = true;
    serialize_widgets = false;

    constructor(title?: string) {
      super(title ?? "WP Mode Relay");
      this.addInput?.(nextInputName(this), "*");
      this.addOutput?.("drives", NODE_GROUP_OUTPUT);
      mountModeRelay(this);
      this.size = [320, 150];
    }

    getInputLink(): null {
      return null;
    }

    onConfigure(): void {
      justLoaded.add(this);
      setTimeout(() => justLoaded.delete(this), 1500);
    }

    onConnectionsChange(): void {
      queueMicrotask(() => {
        if (this.graph && stabilizeInputs(this)) this.setDirtyCanvas?.(true, true);
      });
    }
  }
  lg.registerNodeType(MODE_RELAY_TYPE, WPModeRelayNode);
}

export { MODE_RELAY_TYPE };
