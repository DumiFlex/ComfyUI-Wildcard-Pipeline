import { describe, expect, it } from "vitest";
import sockets from "../../../../tests/fixtures/node-sockets.json";
import { NODE_FIELDS, type NodeFieldGroups } from "../node-fields";
import { DOC_PAGES } from "../registry";

type Sockets = Record<string, { inputs: { name: string; type: string }[]; outputs: { name: string; type: string }[] }>;
const SOCKETS: Sockets = sockets;

/** A node's own widget input (its body) is documented by its other groups. */
const BODY_WIDGET = /^WP_(?!VAR_PICKER$|CONTEXT_LOOP_CONFIG$)/;

function covered(node: string): string[] {
  const groups: NodeFieldGroups = (NODE_FIELDS as Record<string, NodeFieldGroups>)[node] ?? {};
  return Object.values(groups).flatMap((list) => list.flatMap((f) => f.sockets ?? []));
}

function matches(pattern: string, key: string): boolean {
  if (!pattern.endsWith("*")) return pattern === key;
  return key.startsWith(pattern.slice(0, -1));
}

describe("node field lists", () => {
  it("has a field list for every node page", () => {
    const nodeIds = DOC_PAGES.flatMap((p) => (p.nodeId ? [p.nodeId] : []));
    expect(Object.keys(NODE_FIELDS).sort()).toEqual([...nodeIds].sort());
  });

  for (const [node, spec] of Object.entries(SOCKETS)) {
    it(`${node}: every socket has a field`, () => {
      const pats = covered(node);
      const keys = [
        ...spec.inputs.filter((i) => !BODY_WIDGET.test(i.type)).map((i) => `in:${i.name}`),
        ...spec.outputs.map((o) => `out:${o.name}`),
      ];
      const missing = keys.filter((k) => !pats.some((p) => matches(p, k)));
      expect(missing, `add these to src/manager/docs/node-fields.ts (${node})`).toEqual([]);
    });

    it(`${node}: every field names a real socket`, () => {
      const keys = [...spec.inputs.map((i) => `in:${i.name}`), ...spec.outputs.map((o) => `out:${o.name}`)];
      const stale = covered(node).filter((p) => !keys.some((k) => matches(p, k)));
      expect(stale).toEqual([]);
    });
  }

  it("lists sockets only for nodes the Python side declares", () => {
    const withSockets = Object.entries(NODE_FIELDS as Record<string, NodeFieldGroups>)
      .filter(([, groups]) => Object.values(groups).some((l) => l.some((f) => f.sockets?.length)))
      .map(([id]) => id);
    for (const id of withSockets) expect(SOCKETS[id], id).toBeDefined();
  });
});
