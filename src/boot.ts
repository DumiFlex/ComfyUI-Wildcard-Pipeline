// Everything `main.ts` needs before it can call `registerExtension`, gathered
// behind ONE dynamic import so it ships as one chunk.
//
// WHY ONE CHUNK. `main.ts` used to `await Promise.all([...])` nineteen separate
// `import()`s. Each became its own chunk, and every module two of them shared
// (vue, `_shared`, `graph`, `reactive`, `graph-events`, …) became a chunk of
// its own too, so an empty canvas fetched 43 files before the extension could
// register. All of them were awaited up front anyway: nothing was actually
// deferred, it was just split. Importing them from here lets Rollup put them in
// a single chunk, and the lazy chunks (the widget SFCs, modals) import from it
// because it is guaranteed to be loaded before they are.
//
// WHY IT STILL HAS TO BE AWAITED. `getCustomWidgets` factories must return
// synchronously, so the widget glue has to be loaded before the first node is
// built. ComfyUI does accept a Promise from `getCustomWidgets`, but it does not
// wait for it (`extensionService.registerExtension` fires it and moves on,
// marked for deprecation), so a workflow restored at startup could build its
// nodes first. And `init`, the earliest hook ComfyUI does await, runs right
// after extension loading, so moving the await there would buy nothing.
//
// Keep this list to what registration or node creation needs. Anything only a
// user action reaches (a modal, the toast stack, the subgraph badge) belongs in
// its own `import()` so it stays off the startup path. The widget SFCs are
// already lazy through `defineAsyncComponent` in each `widgets/*.ts`.
// Webfonts. The module only appends a <link> for the @font-face rules and
// `font-display: swap` renders text in the system stack until they land, so
// nothing here waits on a font. It resolves the stylesheet against its own
// chunk's URL, which is `assets/` whether it ships alone or inside this chunk.
import "./extension/fonts";

export * as ctxMod from "./widgets/context";
export * as dbgMod from "./widgets/debug";
export * as asmMod from "./widgets/assembler";
export * as tmplMod from "./widgets/templateEditor";
export * as injMod from "./widgets/injector";
export * as cleanerMod from "./widgets/cleaner";
export * as varPickerMod from "./widgets/var_picker";
export * as ctxLoopMod from "./widgets/context_loop";
export * as seedListMod from "./widgets/seed_list";
export * as graphEventsMod from "./extension/graph-events";
export * as graphMod from "./extension/graph";
export * as negativesMod from "./extension/negatives";
export * as toastStoreMod from "./components/shared/toast-store";
export * as settingsMod from "./extension/settings";
export * as aboutMod from "./extension/about-badges";
export * as topbarMod from "./extension/topbar";
export * as playgroundStoreMod from "./components/settings/playground-store";
export { installClipboardShield } from "./widgets/clipboard-shield";
export { createApp, watch } from "vue";

// Off the startup path, but imported from here rather than from `main.ts`: a
// chunk loaded from this one can reuse everything this one already holds (vue,
// the stores, `reactive`), whereas one loaded from `main.ts` makes Rollup split
// those shared modules back out into files of their own.
export const loadToast = () => import("./components/shared/Toast.vue");
export const loadPlayground = () => import("./components/settings/DisplayPlaygroundModal.vue");
export const loadSubgraphBadge = () => import("./extension/subgraph-badge");
