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
  graph: unknown;
}

export interface ComfyApi {
  addEventListener(type: string, callback: (event: CustomEvent) => void): void;
  fetchApi(route: string, options?: RequestInit): Promise<Response>;
}

export interface ComfyNode {
  id: number;
  comfyClass?: string;
  widgets?: ComfyWidget[];
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
}

export interface ComfyWidget {
  name: string;
  type: string;
  value: unknown;
  options?: Record<string, unknown>;
  serializeValue?: (
    node: ComfyNode,
    index: number
  ) => Promise<string> | string;
  computeSize?: (width: number) => [number, number];
  onRemove?: () => void;
  beforeQueued?: () => void;
  afterQueued?: () => void;
}

export interface DOMWidgetOptions {
  serialize: boolean;
  getValue: () => string;
  setValue: (v: string) => void;
}

export interface ComfyNodeType {
  prototype: {
    onNodeCreated?: (...args: unknown[]) => void;
  };
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
