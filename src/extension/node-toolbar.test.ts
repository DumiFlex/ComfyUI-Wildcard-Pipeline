import { describe, expect, it, beforeEach } from "vitest";
import { DOC_PAGES } from "../manager/docs/registry";
import { nodeEditors } from "./_stashes";
import {
  EDIT_COMMAND,
  SHOW_COMMAND,
  HELP_COMMAND,
  NODE_DOC_PAGES,
  docPageFor,
  editSelection,
  helpForSelection,
  helpTarget,
  selectedItems,
  toolbarCommands,
  toolboxCommandsFor,
} from "./node-toolbar";

describe("node toolbar", () => {
  beforeEach(() => {
    helpTarget.value = null;
  });

  it("maps every node page in the docs, and nothing else", () => {
    const fromDocs = Object.fromEntries(
      DOC_PAGES.filter((p) => p.nodeId).map((p) => [p.nodeId as string, p.id]),
    );
    expect(NODE_DOC_PAGES).toEqual(fromDocs);
  });

  it("gives a WP node the help button, and a native node nothing", () => {
    expect(toolboxCommandsFor({ type: "WP_Context" })).toEqual([HELP_COMMAND]);
    expect(toolboxCommandsFor({ type: "KSampler" })).toEqual([]);
    expect(toolboxCommandsFor(null)).toEqual([]);
    expect(docPageFor({ type: "WP_VarToChoice" })).toBe("wp-var-to-choice");
  });

  it("puts the pencil first on a node with an edit view", () => {
    const node = { type: "WP_Toggles" };
    nodeEditors.set(node, () => undefined);
    expect(toolboxCommandsFor(node)).toEqual([EDIT_COMMAND, HELP_COMMAND]);
  });

  it("opens help for the first WP node in the selection", () => {
    const canvas = { selected_nodes: { 1: { type: "KSampler", title: "K" }, 2: { type: "WP_Toggles", title: "Lights" } } };
    expect(helpForSelection(canvas)).toBe(true);
    expect(helpTarget.value).toEqual({ page: "wp-toggles", title: "Lights" });
  });

  it("does nothing when the selection has no WP node", () => {
    expect(helpForSelection({ selected_nodes: { 1: { type: "KSampler" } } })).toBe(false);
    expect(helpForSelection(null)).toBe(false);
    expect(helpTarget.value).toBeNull();
  });

  it("runs the editor of the first editable node", () => {
    let opened = 0;
    const node = { type: "WP_Note" };
    nodeEditors.set(node, () => {
      opened += 1;
    });
    expect(editSelection({ selectedItems: new Set([{ type: "WP_Context" }, node]) })).toBe(true);
    expect(opened).toBe(1);
    expect(editSelection({ selected_nodes: { 1: { type: "WP_Context" } } })).toBe(false);
  });

  it("reads either selection API", () => {
    const a = { type: "A" };
    expect(selectedItems({ selectedItems: [a] })).toEqual([a]);
    expect(selectedItems({ selected_nodes: { 3: a } })).toEqual([a]);
    expect(selectedItems(undefined)).toEqual([]);
  });

  it("registers its commands with coloured icons that call through", () => {
    const node = { type: "WP_Bookmark", title: "Start" };
    const cmds = toolbarCommands(() => ({ selected_nodes: { 1: node } }));
    expect(cmds.map((c) => c.id)).toEqual([HELP_COMMAND, EDIT_COMMAND, SHOW_COMMAND]);
    for (const c of cmds) expect(typeof c.icon === "function" ? c.icon() : c.icon).toContain("wp-tb-icon");
    cmds[0]?.function();
    expect(helpTarget.value?.page).toBe("wp-bookmark");
  });
});
