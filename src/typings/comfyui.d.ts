// Stubs for ComfyUI's frontend globals, extended as needed. We keep our
// hand-rolled shim instead of re-exporting `@comfyorg/comfyui-frontend-types`
// directly because the upstream types insist on `NodeId = string | number`
// and `LGraphNode` shape, while our internal `LiteNodeLike` uses `id: number`
// throughout (subgraphs aside, our walkers handle string IDs explicitly via
// the locator helper). The official types live in node_modules as a
// reference for new hook signatures — copy fields in here as needed.
declare module "#comfyui/app" {
  export interface ComfyApp {
    graph: unknown;
    canvas?: { graph?: unknown };
    /** Runtime-only — surfaced when ComfyUI mounts the Vue settings panel. */
    extensionManager?: {
      setting?: {
        get(id: string): unknown;
        /** Programmatically update a setting value. Fires the registered
         * onChange handler, which lets us live-bind UI controls (e.g.
         * the Display Playground modal's selects) into the same store
         * the panel writes to. Available since ComfyUI v1.33+. */
        set?(id: string, value: unknown): void | Promise<void>;
      };
    };
    /** Top toolbar/menu surface — exposes `settingsGroup` (the cog
     *  button group) which we anchor our SPA-launcher button to. Older
     *  ComfyUI builds may not expose this; access defensively. */
    menu?: {
      settingsGroup?: { element: HTMLElement };
    };
    registerExtension(ext: {
      name: string;
      getCustomWidgets?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
      beforeRegisterNodeDef?: (nodeType: unknown, nodeData: { name: string }) => Promise<void> | void;
      /** Called after ComfyUI restores all widget values on workflow load. */
      afterConfigureGraph?: (...args: unknown[]) => void;
      /** Fires for every node when instantiated, including SubgraphNodes that
       *  bypass beforeRegisterNodeDef. */
      nodeCreated?: (node: unknown) => Promise<void> | void;
      /** Fires for every node restored from a saved workflow. */
      loadedGraphNode?: (node: unknown, app: unknown) => Promise<void> | void;
      /** Badges shown in the "About" panel under our extension row. */
      aboutPageBadges?: Array<{ label: string; url: string; icon: string }>;
      /** Entries in the ComfyUI Settings panel.
       *
       * `type` accepts either a string from the 12-value union (the
       * docs at docs.comfy.org list 8 — `knob`, `radio`, `url`,
       * `backgroundImage` are documented only in the frontend type
       * contract `Comfy-Org/ComfyUI_frontend/src/platform/settings/types.ts`)
       * or a custom-renderer function that returns an HTMLElement.
       *
       * The function form replaces the entire input cell with whatever
       * DOM you return. Wire `setter(value)` to persist changes. Used
       * by rgthree-comfy (launcher button → custom dialog) and
       * ComfyUI-KJNodes (one-shot action button) — patterns we can
       * mirror for richer settings UI than the native types support. */
      settings?: Array<{
        id: string;
        name: string;
        type:
          | "boolean"
          | "text"
          | "number"
          | "slider"
          | "combo"
          | "color"
          | "image"
          | "hidden"
          | "knob"
          | "radio"
          | "url"
          | "backgroundImage"
          | ((
              name: string,
              setter: (value: unknown) => void,
              value: unknown,
              attrs?: Record<string, unknown>,
            ) => HTMLElement);
        defaultValue: unknown;
        tooltip?: string;
        options?: Array<{ text: string; value: string }>;
        category?: string[];
        onChange?: (newVal: unknown, oldVal: unknown) => void;
      }>;
      /** Topbar dropdown commands — `menuCommands` references these by id. */
      commands?: Array<{
        id: string;
        label: string;
        function: (...args: unknown[]) => unknown;
      }>;
      /** Maps command ids into the topbar dropdown menu hierarchy. */
      menuCommands?: Array<{
        path: string[];
        commands: string[];
      }>;
      /** Modern actionbar buttons (ComfyUI frontend ≥ 1.33.9). Each
       *  entry renders as a button inside the rounded actionbar
       *  container next to other extensions' buttons. `icon` is an
       *  Iconify class string ComfyUI's Vue button component renders
       *  as `<i class="...">`. */
      actionBarButtons?: Array<{
        icon: string;
        tooltip: string;
        onClick: (event?: MouseEvent | KeyboardEvent) => void;
      }>;
      /** Lifecycle hook fired after ComfyUI core has initialised — safe
       *  point to mount DOM that depends on `app.menu`. */
      setup?: () => Promise<void> | void;
    }): void;
  }
  export const app: ComfyApp;
}
