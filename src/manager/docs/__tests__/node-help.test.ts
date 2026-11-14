/**
 * ComfyUI's Node Info panel shows `docs/help/WP_*.md`. Their field lists come
 * from `docs/node-fields.ts` (the same list the docs pages draw), written
 * between the `fields` markers. Fails when a file is stale; rewrite them with
 * `pnpm docs:help`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sockets from "../../../../tests/fixtures/node-sockets.json";
import { GROUP_TITLES, NODE_FIELDS, type NodeField, type NodeFieldGroups } from "../node-fields";
import { NODE_VIDEOS, findSection, findVideo, playlistUrl, videoUrl } from "../videos";

type Socket = { name: string; type: string };
const SOCKETS: Record<string, { inputs: Socket[]; outputs: Socket[] }> = sockets;

const HELP = resolve(__dirname, "../../../../docs/help");
const START = "<!-- fields:start -->";
const END = "<!-- fields:end -->";
const VIDEO_START = "<!-- video:start -->";
const VIDEO_END = "<!-- video:end -->";

/** The node's own video and the Nodes playlist, under its intro. */
export function videoBlock(node: string): string {
  const v = findVideo(NODE_VIDEOS[node] ?? "");
  const nodes = findSection("nodes");
  if (!v || !nodes) return `${VIDEO_START}\n${VIDEO_END}`;
  return `${VIDEO_START}\n▶ **Video:** [${v.title}](${videoUrl(v)}) · [All node videos](${playlistUrl(nodes)})\n${VIDEO_END}`;
}

/** The socket types a field covers (`STRING`, `INT` …), from the schema dump. */
function typesOf(node: string, f: NodeField): string[] {
  const spec = SOCKETS[node];
  if (!spec || !f.sockets) return [];
  const found = f.sockets.map((key) => {
    const [side, name] = key.split(":") as [string, string];
    const list = side === "in" ? spec.inputs : spec.outputs;
    const hit = list.find((s) => (name.endsWith("*") ? s.name.startsWith(name.slice(0, -1)) : s.name === name));
    return hit?.type === "*" ? "any" : hit?.type === "WP_VAR_PICKER" ? "variable" : hit?.type === "PIPELINE_CONTEXT" ? "context" : hit?.type;
  });
  return [...new Set(found.filter((t): t is string => !!t))];
}

export function fieldsBlock(node: string, groups: NodeFieldGroups): string {
  const parts = Object.entries(groups).map(([key, list]) => {
    const lines = list.map((f) => {
      const types = typesOf(node, f);
      const tail = `${f.kbd ? ` (${f.kbd})` : ""}${types.length ? ` \`${types.join(" / ")}\`` : ""}`;
      return `- **${f.term}**${tail}: ${f.desc}`;
    });
    return `## ${GROUP_TITLES[key] ?? key}\n\n${lines.join("\n")}\n`;
  });
  return `${START}\n${parts.join("\n")}${END}`;
}

describe("native help pages", () => {
  for (const [node, groups] of Object.entries(NODE_FIELDS as Record<string, NodeFieldGroups>)) {
    it(`${node}.md has the current field list`, () => {
      const file = resolve(HELP, `${node}.md`);
      const md = readFileSync(file, "utf8");
      const at = md.indexOf(START);
      const end = md.indexOf(END);
      expect(at, `${node}.md needs ${START} … ${END}`).toBeGreaterThanOrEqual(0);
      const withFields = `${md.slice(0, at)}${fieldsBlock(node, groups)}${md.slice(end + END.length)}`;
      const vAt = withFields.indexOf(VIDEO_START);
      const vEnd = withFields.indexOf(VIDEO_END);
      expect(vAt, `${node}.md needs ${VIDEO_START} … ${VIDEO_END}`).toBeGreaterThanOrEqual(0);
      const next = `${withFields.slice(0, vAt)}${videoBlock(node)}${withFields.slice(vEnd + VIDEO_END.length)}`;
      if (process.env.WP_WRITE_NODE_HELP) writeFileSync(file, next);
      else expect(md, "run pnpm docs:help").toBe(next);
    });
  }

  it("links a video for every node", () => {
    for (const node of Object.keys(NODE_FIELDS)) expect(findVideo(NODE_VIDEOS[node] ?? ""), node).toBeTruthy();
  });

  it("has a heading for every group", () => {
    const keys = new Set(Object.values(NODE_FIELDS as Record<string, NodeFieldGroups>).flatMap((g) => Object.keys(g)));
    for (const k of keys) expect(GROUP_TITLES[k], k).toBeTruthy();
  });
});
