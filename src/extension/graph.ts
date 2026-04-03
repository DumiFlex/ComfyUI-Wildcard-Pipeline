import { app } from "#comfyui/app";
import type { ComfyNode } from "#comfyui/app";
import type { PipelineModule } from "@/types";

export interface UpstreamContext {
  variables: string[];
  constraintTargets: string[];
}

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
      if ("enabled" in mod && mod.enabled === false) continue;
      if ("capture_as" in mod && mod.capture_as) {
        addUnique(variables, mod.capture_as.replace(/^\$/, ""));
      }
    }
  } catch {
    /* malformed JSON */
  }
}

const INJECT_SLOT_NAMES = ["input_1", "input_2", "input_3"];

function extractInjectVars(node: ComfyNode, variables: string[]): void {
  const configWidget = node.widgets?.find((w) => w.name === "inject_config");
  if (!configWidget?.value) return;
  try {
    const mapping: Record<string, string> = JSON.parse(String(configWidget.value));
    for (const [slotName, varName] of Object.entries(mapping)) {
      if (!INJECT_SLOT_NAMES.includes(slotName)) continue;
      if (!isSlotConnected(node, slotName)) continue;
      const cleaned = varName.trim().replace(/^\$/, "");
      addUnique(variables, cleaned);
    }
  } catch {
    /* malformed JSON */
  }
}

function isSlotConnected(node: ComfyNode, slotName: string): boolean {
  if (!node.inputs) return false;
  for (const inp of node.inputs) {
    if (inp.name === slotName && inp.link != null) return true;
  }
  return false;
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

/**
 * Find all downstream WP_WildcardPipeline and WP_ContextInject nodes
 * (direct and transitive) connected via pipeline_context outputs.
 */
export function findDownstreamPipelineNodes(node: ComfyNode, visited = new Set<number>()): ComfyNode[] {
  const nodes: ComfyNode[] = [];
  const graph = app.graph;
  if (!graph) return nodes;

  for (const output of node.outputs) {
    if (!output.links) continue;
    for (const linkId of output.links) {
      const link = graph.links[linkId];
      if (!link) continue;
      const target = graph.getNodeById(link.target_id);
      if (!target) continue;
      if (visited.has(target.id)) continue;
      visited.add(target.id);
      if (
        target.comfyClass === PIPELINE_NODE_CLASS ||
        target.comfyClass === CONTEXT_INJECT_CLASS
      ) {
        nodes.push(target);
        nodes.push(...findDownstreamPipelineNodes(target, visited));
      }
    }
  }
  return nodes;
}

/**
 * Find all upstream WP_WildcardPipeline and WP_ContextInject nodes
 * (direct and transitive) connected via pipeline_context inputs.
 */
export function findUpstreamPipelineNodes(node: ComfyNode, visited = new Set<number>()): ComfyNode[] {
  const nodes: ComfyNode[] = [];
  if (visited.has(node.id)) return nodes;
  visited.add(node.id);

  const upstream = getUpstreamByInputName(node, "pipeline_context");
  if (!upstream) return nodes;
  if (visited.has(upstream.id)) return nodes;

  if (
    upstream.comfyClass === PIPELINE_NODE_CLASS ||
    upstream.comfyClass === CONTEXT_INJECT_CLASS
  ) {
    nodes.push(upstream);
    nodes.push(...findUpstreamPipelineNodes(upstream, visited));
  }

  return nodes;
}

/**
 * Collect variables defined in all downstream pipeline/inject nodes
 * (everything AFTER this node in the execution chain).
 */
export function collectDownstreamVariables(node: ComfyNode): string[] {
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

    const graph = app.graph;
    if (!graph || !current.outputs) return;
    for (const output of current.outputs) {
      if (!output.links) continue;
      for (const linkId of output.links) {
        const link = graph.links[linkId];
        if (!link) continue;
        const target = graph.getNodeById(link.target_id);
        if (target) walk(target);
      }
    }
  }

  const graph = app.graph;
  if (graph && node.outputs) {
    for (const output of node.outputs) {
      if (!output.links) continue;
      for (const linkId of output.links) {
        const link = graph.links[linkId];
        if (!link) continue;
        const target = graph.getNodeById(link.target_id);
        if (target) walk(target);
      }
    }
  }

  return variables;
}

/**
 * Collect all pipeline modules from upstream WP_WildcardPipeline nodes
 * in execution order (topmost ancestor first).  ContextInject nodes are
 * skipped because their values come from wires unavailable at preview time.
 */
export function collectUpstreamModules(node: ComfyNode): PipelineModule[] {
  const chain: PipelineModule[][] = [];
  const visited = new Set<number>();

  function walk(current: ComfyNode) {
    if (visited.has(current.id)) return;
    visited.add(current.id);

    // Recurse deeper first so ancestors appear earlier in the output
    const upstream = getUpstreamByInputName(current, "pipeline_context");
    if (upstream) walk(upstream);

    if (current.comfyClass === PIPELINE_NODE_CLASS) {
      const configWidget = current.widgets?.find((w) => w.name === "module_config");
      if (configWidget?.value) {
        try {
          const modules: PipelineModule[] = JSON.parse(String(configWidget.value));
          chain.push(modules);
        } catch {
          /* malformed JSON */
        }
      }
    }
  }

  const upstream = getUpstreamByInputName(node, "pipeline_context");
  if (upstream) walk(upstream);

  return chain.flat();
}

export function collectUpstreamContext(node: ComfyNode): UpstreamContext {
  const variables: string[] = [];
  const constraintTargets: string[] = [];
  const visited = new Set<number>();

  function walk(current: ComfyNode) {
    if (visited.has(current.id)) return;
    visited.add(current.id);

    if (current.comfyClass === PIPELINE_NODE_CLASS) {
      const configWidget = current.widgets?.find((w) => w.name === "module_config");
      if (configWidget?.value) {
        try {
          const modules: PipelineModule[] = JSON.parse(String(configWidget.value));
          for (const mod of modules) {
            if ("enabled" in mod && mod.enabled === false) continue;
            if ("capture_as" in mod && mod.capture_as) {
              addUnique(variables, mod.capture_as.replace(/^\$/, ""));
            }
            if (mod.type === "constrain" && typeof mod.target === "string") {
              const target = mod.target.trim();
              if (target) addUnique(constraintTargets, target);
            }
          }
        } catch {
          /* malformed JSON */
        }
      }
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

  return { variables, constraintTargets };
}
