import { defineAsyncComponent, h, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type MountTargetNode } from "./_shared";
import {
  collectUpstreamVariables,
  collectUpstreamValues,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { reactiveFromGraph, stringArrayEqual } from "../extension/reactive";

const AssemblerHelper = defineAsyncComponent(() => import("../components/assembler/AssemblerHelper.vue"));

interface AssemblerNode extends LiteNodeLike, MountTargetNode {
  widgets?: { name: string; value: unknown }[];
}

function templateOf(node: AssemblerNode): string {
  const w = node.widgets?.find((x) => x.name === "template");
  return typeof w?.value === "string" ? w.value : "";
}

interface UpstreamSnapshot {
  vars: string[];
  values: Record<string, string>;
  template: string;
}

function snapshotEqual(a: UpstreamSnapshot, b: UpstreamSnapshot): boolean {
  if (a.template !== b.template) return false;
  if (!stringArrayEqual(a.vars, b.vars)) return false;
  for (const k of a.vars) if (a.values[k] !== b.values[k]) return false;
  return true;
}

export function mountHelper(node: AssemblerNode) {
  const wrapper: Component = {
    setup() {
      // Bundle vars + values + template into one snapshot — they all change
      // together (graph edits, module edits, template typing) and the polling
      // fallback covers all three uniformly.
      const snapshot = reactiveFromGraph<UpstreamSnapshot>(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          const g = app.graph as unknown as LiteGraphLike;
          return {
            vars: collectUpstreamVariables(g, node),
            values: collectUpstreamValues(g, node),
            template: templateOf(node),
          };
        },
        snapshotEqual,
      );
      return () => h(AssemblerHelper, {
        upstreamVars: snapshot.value.vars,
        upstreamValues: snapshot.value.values,
        template: snapshot.value.template,
        onInsert: (token: string) => insertIntoTemplate(node, token),
      });
    },
  };
  createDomWidgetHost(node, "assembler-helper", wrapper, {
    minHeight: 80,
    minWidth: 280,
  });
}

function insertIntoTemplate(node: AssemblerNode, token: string) {
  const w = node.widgets?.find((x) => x.name === "template") as
    | { name: string; value: unknown; inputEl?: HTMLTextAreaElement | HTMLInputElement }
    | undefined;
  if (!w || typeof w.value !== "string") return;

  // Multiline STRING widgets in ComfyUI back the input with a real <textarea>
  // exposed at widget.inputEl. If we can find it, splice the token at the
  // current caret. If not (collapsed canvas mode, etc.), fall back to a
  // smart-append.
  const el = w.inputEl;
  if (el && typeof el.selectionStart === "number") {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const needsLeadingSpace = start > 0 && !/\s$/.test(el.value.slice(0, start));
    const insert = `${needsLeadingSpace ? " " : ""}${token}`;
    el.value = el.value.slice(0, start) + insert + el.value.slice(end);
    w.value = el.value;
    // Restore focus + place caret immediately after the inserted token.
    el.focus();
    const caret = start + insert.length;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // Fallback: append with a single-space separator.
  const cur = w.value;
  w.value = `${cur}${cur.endsWith(" ") || !cur ? "" : " "}${token}`;
}
