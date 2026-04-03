/**
 * Type declarations for ComfyUI frontend scripts.
 *
 * At runtime, `../../../scripts/app.js` resolves to ComfyUI's bundled frontend.
 * This file provides type definitions for TypeScript tooling via tsconfig paths.
 */

export interface ComfyExtensionDef {
  name: string;
  getCustomWidgets?: (
    app: ComfyApp
  ) => Record<string, WidgetFactory>;
  beforeRegisterNodeDef?: (
    nodeType: ComfyNodeType,
    nodeData: ComfyNodeData,
    app: ComfyApp
  ) => Promise<void> | void;
  setup?: (app: ComfyApp) => Promise<void> | void;
  init?: (app: ComfyApp) => Promise<void> | void;
  nodeCreated?: (node: ComfyNode, app: ComfyApp) => void;
  loadedGraphNode?: (node: ComfyNode, app: ComfyApp) => void;
}

export type WidgetFactory = (
  node: ComfyNode,
  inputName: string,
  inputData: unknown,
  app: ComfyApp
) => { widget: ComfyWidget };

export interface ComfyApp {
  registerExtension(extension: ComfyExtensionDef): void;
  extensionManager: {
    toast: {
      add(options: {
        severity: "success" | "info" | "warn" | "error";
        summary: string;
        detail: string;
        life?: number;
      }): void;
    };
  };
  api: ComfyApi;
  graph: LGraph;
}

/** LiteGraph graph instance */
export interface LGraph {
  links: Record<number, LLink>;
  getNodeById(id: number): ComfyNode | null;
  _nodes: ComfyNode[];
  _nodes_by_id: Record<number, ComfyNode>;
  setDirtyCanvas(foreground: boolean, background: boolean): void;
}

/** LiteGraph link between two node slots */
export interface LLink {
  id: number;
  origin_id: number;
  origin_slot: number;
  target_id: number;
  target_slot: number;
  type: string;
}

/** LiteGraph node input slot */
export interface LNodeInput {
  name: string;
  type: string;
  link: number | null;
}

/** LiteGraph node output slot */
export interface LNodeOutput {
  name: string;
  type: string;
  links: number[] | null;
}

export interface ExecutedEventDetail {
  node: number | string;
  display_node?: number | string;
  output: Record<string, unknown[]>;
}

export interface ComfyApi {
  addEventListener(type: string, callback: (event: CustomEvent) => void): void;
  removeEventListener(type: string, callback: (event: CustomEvent) => void): void;
  fetchApi(route: string, options?: RequestInit): Promise<Response>;
}

export interface ComfyNode {
  id: number;
  type?: string;
  comfyClass?: string;
  widgets?: ComfyWidget[];
  inputs: LNodeInput[];
  outputs: LNodeOutput[];
  graph: LGraph;
  addDOMWidget(
    name: string,
    type: string,
    element: HTMLElement,
    options: DOMWidgetOptions
  ): ComfyWidget;
  addWidget(
    type: string,
    name: string,
    value: unknown,
    callback?: (...args: unknown[]) => void,
    options?: Record<string, unknown>
  ): ComfyWidget;
  getInputNode(slotIndex: number): ComfyNode | null;
  getInputLink(slotIndex: number): LLink | null;
  findInputSlot(name: string): number;
  setSize(size: [number, number]): void;
  computeSize(outSize?: [number, number]): [number, number];
  onConnectionsChange?: (
    type: number,
    slotIndex: number,
    isConnected: boolean,
    linkInfo: LLink,
    ioSlot: LNodeInput | LNodeOutput
  ) => void;
  onRemoved?: () => void;
}

export interface ComfyWidget {
  name: string;
  type: string;
  value: unknown;
  callback?: (...args: unknown[]) => void;
  hidden?: boolean;
  options?: Record<string, unknown>;
  serializeValue?: (
    node: ComfyNode,
    index: number
  ) => Promise<string> | string;
  computeSize?: (width: number) => [number, number];
  computeLayoutSize?: () => { minWidth?: number; minHeight?: number; maxHeight?: number };
  onRemove?: () => void;
  beforeQueued?: () => void;
  afterQueued?: () => void;
}

export interface DOMWidgetOptions {
  serialize: boolean;
  hideOnZoom?: boolean;
  getValue: () => string;
  setValue: (v: string) => void;
  getMinHeight?: () => number;
  getMaxHeight?: () => number;
}

export interface ComfyNodeType {
  prototype: {
    onNodeCreated?: (...args: unknown[]) => void;
    onConnectionsChange?: ComfyNode["onConnectionsChange"];
  };
  comfyClass?: string;
}

export interface ComfyNodeData {
  name: string;
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
  output?: string[];
  output_name?: string[];
}

export declare const app: ComfyApp;
