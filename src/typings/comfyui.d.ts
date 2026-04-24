// Stubs for ComfyUI's frontend globals, extended as needed.
declare module "#comfyui/app" {
  export interface ComfyApp {
    graph: unknown;
    registerExtension(ext: {
      name: string;
      getCustomWidgets?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
      beforeRegisterNodeDef?: (nodeType: unknown, nodeData: unknown) => Promise<void> | void;
    }): void;
  }
  export const app: ComfyApp;
}
