import { app } from "#comfyui/app";
import type { ComfyNode } from "#comfyui/app";
import type { PipelineModule } from "@/types";

const PIPELINE_NODE_CLASS = "WP_WildcardPipeline";
const CONTEXT_INJECT_CLASS = "WP_ContextInject";

function addUnique(variables: string[], name: string): void {
  if (name && !variables.includes(name)) {
    variables.push(name);
  }
}

function extractPipelineVars(node: ComfyNode, variables: string[]): void {
  const configWidget = node.widgets?.find((w) => w.name === "module_config");
  if (!configWidget?.value) return;
  try {
    const modules: PipelineModule[] = JSON.parse(String(configWidget.value));
    for (const mod of modules) {
      if ("capture_as" in mod && mod.capture_as) {
        addUnique(variables, mod.capture_as.replace(/^\$/, ""));
      }
    }
  } catch {
    /* malformed JSON */
  }
}

function extractInjectVars(node: ComfyNode, variables: string[]): void {
  const configWidget = node.widgets?.find((w) => w.name === "inject_config");
  if (!configWidget?.value) return;
  try {
    const mapping: Record<string, string> = JSON.parse(String(configWidget.value));
    for (const varName of Object.values(mapping)) {
      const cleaned = varName.trim().replace(/^\$/, "");
      addUnique(variables, cleaned);
    }
  } catch {
    /* malformed JSON */
  }
}

// getInputNode() is unreliable in ComfyUI's LiteGraph fork — use inputs[].link instead
function getUpstreamByInputName(node: ComfyNode, inputName: string): ComfyNode | null {
  const graph = app.graph;
  if (!graph || !node.inputs) return null;

  for (const inp of node.inputs) {
    if (inp.name === inputName && inp.link != null) {
      const link = graph.links[inp.link];
      if (link) {
        return graph.getNodeById(link.origin_id);
      }
    }
  }
  return null;
}

export function collectUpstreamVariables(node: ComfyNode): string[] {
  const variables: string[] = [];
  const visited = new Set<number>();

  function walk(current: ComfyNode) {
    if (visited.has(current.id)) return;
    visited.add(current.id);

    if (current.comfyClass === PIPELINE_NODE_CLASS) {
      extractPipelineVars(current, variables);
    } else if (current.comfyClass === CONTEXT_INJECT_CLASS) {
      extractInjectVars(current, variables);
    } else {
      return;
    }

    const upstream = getUpstreamByInputName(current, "pipeline_context");
    if (upstream) walk(upstream);
  }

  const upstream = getUpstreamByInputName(node, "pipeline_context");
  if (upstream) walk(upstream);

  return variables;
}

export function findDownstreamAssemblers(node: ComfyNode, visited = new Set<number>()): ComfyNode[] {
  const assemblers: ComfyNode[] = [];
  const graph = app.graph;
  if (!graph) return assemblers;

  for (const output of node.outputs) {
    if (!output.links) continue;
    for (const linkId of output.links) {
      const link = graph.links[linkId];
      if (!link) continue;
      const target = graph.getNodeById(link.target_id);
      if (!target) continue;
      if (visited.has(target.id)) continue;
      visited.add(target.id);
      if (target.comfyClass === "WP_PromptAssembler") {
        assemblers.push(target);
      } else if (
        target.comfyClass === PIPELINE_NODE_CLASS ||
        target.comfyClass === CONTEXT_INJECT_CLASS
      ) {
        assemblers.push(...findDownstreamAssemblers(target, visited));
      }
    }
  }
  return assemblers;
}
