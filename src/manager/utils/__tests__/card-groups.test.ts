import { describe, expect, it } from "vitest";
import type { AiChatProposal } from "../../api/types";
import { cardGroups, groupKey, groupOf, groupTitle, MIN_GROUP } from "../card-groups";

function create(pid: string, type = "wildcard"): AiChatProposal {
  return {
    pid, tool: `create_${type}`, title: `Create ${type} ${pid}`, summary: "", preview: [], warnings: [], after: null,
    op: { op: "create", kind: "module", new_category: "", body: { type, name: pid, category_id: null, tags: [], payload: {} } },
  } as unknown as AiChatProposal;
}

function update(pid: string, tool: string): AiChatProposal {
  return {
    pid, tool, title: `${tool} ${pid}`, summary: "", preview: [], warnings: [], after: null,
    op: { op: "update", kind: "module", type: "wildcard", id: pid, name: pid, body: {}, before: {} },
  } as unknown as AiChatProposal;
}

function other(pid: string, op: string): AiChatProposal {
  return { pid, tool: op, title: op, summary: "", preview: [], warnings: [], after: null, op: { op } } as unknown as AiChatProposal;
}

describe("card groups", () => {
  it("keys cards by what they do and leaves links, deletes and library-wide cards alone", () => {
    expect(groupKey(create("a"))).toBe("create:wildcard");
    expect(groupKey(create("b", "constraint"))).toBe("create:constraint");
    expect(groupKey(update("c", "add_options"))).toBe("update:add_options");
    for (const op of ["open", "delete", "categories", "bulk", "tags"]) expect(groupKey(other("x", op))).toBeNull();
    const tpl = { ...create("t"), op: { op: "create", kind: "template", new_category: "", body: {} } } as unknown as AiChatProposal;
    expect(groupKey(tpl)).toBe("create:template");
  });

  it("groups a kind only from MIN_GROUP cards, in the order its first card comes", () => {
    const cards = [
      update("u1", "add_options"), create("w1"), create("w2"), update("u2", "add_options"),
      create("c1", "constraint"), create("w3"), update("u3", "add_options"), other("o", "open"),
    ];
    const groups = cardGroups(cards);
    expect(MIN_GROUP).toBe(3);
    expect(groups.map((g) => g.key)).toEqual(["update:add_options", "create:wildcard"]);
    expect(groups[1].pids).toEqual(["w1", "w2", "w3"]);
    const by = groupOf(groups);
    expect(by.get("w2")?.key).toBe("create:wildcard");
    expect(by.has("c1")).toBe(false);
    expect(cardGroups(cards.slice(0, 3))).toEqual([]);
  });

  it("titles a group", () => {
    expect(groupTitle("create:wildcard", 14)).toBe("Create 14 wildcards");
    expect(groupTitle("create:fixed_values", 3)).toBe("Create 3 fixed values");
    expect(groupTitle("create:widget", 3)).toBe("Create 3 widgets");
    expect(groupTitle("update:add_options", 8)).toBe("Add options to 8 items");
    expect(groupTitle("update:update_info", 1)).toBe("Describe 1 item");
    expect(groupTitle("update:mystery", 4)).toBe("Change 4 items");
  });
});
