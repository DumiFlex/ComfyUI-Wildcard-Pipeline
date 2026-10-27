// The token names a shared component may use: both the canvas theme
// (components/shared/theme.css) and the manager (manager/styles/tokens.css)
// define every one, so a component in components/shared/ reads the same
// names on both sides and wears each side's colours. Add a name here only
// when both files define it; a name only one side has must not appear in a
// shared component (docs/component-standard.md, rule 5).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SHARED_TOKENS = [
  // Surfaces and text
  "--wp-bg", "--wp-bg-1", "--wp-bg-2", "--wp-bg-3", "--wp-bg-4",
  "--wp-text", "--wp-text-muted", "--wp-text-dim",
  "--wp-border", "--wp-border-strong", "--wp-border-soft", "--wp-border-focus",
  "--wp-overlay-bg", "--wp-row-hover", "--wp-input-shade", "--wp-scrollbar-thumb",
  // Accent and states
  "--wp-accent", "--wp-accent-glow", "--wp-accent-text", "--wp-accent-text-strong",
  "--wp-accent-300", "--wp-accent-400", "--wp-accent-500", "--wp-accent-600",
  "--wp-focus-ring",
  "--wp-success", "--wp-warn", "--wp-danger", "--wp-info", "--wp-danger-text",
  "--wp-error-border", "--wp-error-text",
  "--wp-red", "--wp-red-bg", "--wp-green", "--wp-green-bg", "--wp-amber", "--wp-amber-bg",
  "--wp-teal", "--wp-teal-bg", "--wp-violet", "--wp-violet-bg", "--wp-rose", "--wp-rose-bg",
  // Kinds and variables
  "--wp-kind-wildcard", "--wp-kind-fixed", "--wp-kind-combine", "--wp-kind-derivation", "--wp-kind-constraint",
  "--wp-var-1", "--wp-var-2", "--wp-var-3", "--wp-var-4", "--wp-var-5", "--wp-var-6", "--wp-var-7", "--wp-var-8",
  // Shape, depth and type
  "--wp-radius-sm", "--wp-radius", "--wp-radius-md", "--wp-radius-lg", "--wp-radius-xl",
  "--wp-shadow-sm", "--wp-shadow", "--wp-shadow-md", "--wp-shadow-lg", "--wp-shadow-xl",
  "--wp-font-sans", "--wp-font-mono",
  "--wp-text-xs", "--wp-text-sm", "--wp-text-base", "--wp-text-md", "--wp-text-lg", "--wp-text-xl",
  "--wp-space-0", "--wp-space-1", "--wp-space-2", "--wp-space-3", "--wp-space-4",
  "--wp-space-5", "--wp-space-6", "--wp-space-7", "--wp-space-8",
  "--wp-control-h-sm", "--wp-control-h-md", "--wp-control-h-lg",
  // Motion
  "--wp-motion-quick", "--wp-motion-hover", "--wp-motion-fade", "--wp-motion-swap", "--wp-motion-flip",
  "--wp-motion-curve-collapse", "--wp-motion-curve-flip", "--wp-motion-curve-linear",
] as const;

const read = (p: string): string => readFileSync(resolve(__dirname, p), "utf8");
const defined = (css: string): Set<string> =>
  new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--wp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

describe("shared token names", () => {
  const canvas = defined(read("./theme.css"));
  const manager = defined(read("../../manager/styles/tokens.css"));

  it("are defined by the canvas theme", () => {
    expect(SHARED_TOKENS.filter((t) => !canvas.has(t))).toEqual([]);
  });

  it("are defined by the manager", () => {
    expect(SHARED_TOKENS.filter((t) => !manager.has(t))).toEqual([]);
  });

  it("are the only --wp names the shared overlays and controls read", () => {
    const shared = new Set<string>(SHARED_TOKENS);
    const files = [
      "./Popover.vue", "./ContextMenu.vue", "./tooltip.css", "./DropdownMenu.vue", "./ModalShell.vue",
      "./_modal-motion.css", "./ConfirmDialog.vue", "./SearchInput.vue", "./ToastCard.vue", "./WpNumber.vue",
      "./WpTabs.vue", "./WpSegmented.vue", "./Disclosure.vue", "./Banner.vue", "./CopyButton.vue", "./CloseButton.vue",
      "./WpSwitch.vue",
    ];
    const stray = files.flatMap((f) =>
      [...read(f).matchAll(/var\((--wp-[a-z0-9-]+)/g)].map((m) => m[1]).filter((n) => !shared.has(n)).map((n) => `${f}: ${n}`),
    );
    expect(stray).toEqual([]);
  });
});
